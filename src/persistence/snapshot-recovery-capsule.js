import {
  access,
  mkdir,
} from 'node:fs/promises';

import {
  AtomicSnapshotError,
  atomicSnapshotPaths,
  invokeSnapshotStage,
  sha256,
} from './atomic-types.js';
import {
  cleanupTransientSnapshotPaths,
  renameReplacing,
  syncDirectory,
  writeFileWithSync,
} from './fs-durability.js';
import {
  inspectAtomicSnapshotStore,
  readSnapshotCandidate,
} from './snapshot-candidates.js';
import {
  serializeAtomicSnapshotEnvelope,
  validateAtomicSnapshotText,
} from './snapshot-envelope.js';
import {
  inspectSnapshotLineage,
  restoreSnapshotLineageRecords,
  validateSnapshotLineageRecord,
  verifySnapshotLineageRecords,
} from './snapshot-lineage.js';

export const SNAPSHOT_RECOVERY_CAPSULE_SCHEMA = 'axm.echoworld.snapshot-recovery-capsule/v0.01';
export const SNAPSHOT_RECOVERY_RECEIPT_SCHEMA = 'axm.echoworld.snapshot-recovery-receipt/v0.01';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function capsuleIdentity(capsule) {
  return stable(Object.fromEntries(
    Object.entries(capsule).filter(([key]) => key !== 'capsuleId'),
  ));
}

function capsuleIdFor(capsule) {
  return `SRC_${sha256(JSON.stringify(stable(capsuleIdentity(capsule)))).slice(0, 24)}`;
}

function invalid(reason, details = {}) {
  return { valid: false, reason, details, capsule: null, world: null, lineage: null };
}

export function serializeSnapshotRecoveryCapsule(capsule) {
  return `${JSON.stringify(capsule, null, 2)}\n`;
}

export function validateSnapshotRecoveryCapsuleText(text, { expectedCapsuleId = null } = {}) {
  let capsule;
  try {
    capsule = JSON.parse(text);
  } catch (error) {
    return invalid('RECOVERY_CAPSULE_JSON_PARSE_FAILED', { message: error.message });
  }
  if (
    !capsule
    || capsule.schema !== SNAPSHOT_RECOVERY_CAPSULE_SCHEMA
    || typeof capsule.capsuleId !== 'string'
    || !Array.isArray(capsule.lineageRecords)
    || !capsule.headEnvelope
  ) {
    return invalid('RECOVERY_CAPSULE_SCHEMA_MISMATCH');
  }
  if (capsuleIdFor(capsule) !== capsule.capsuleId) {
    return invalid('RECOVERY_CAPSULE_ID_MISMATCH');
  }
  if (expectedCapsuleId !== null && capsule.capsuleId !== expectedCapsuleId) {
    return invalid('RECOVERY_CAPSULE_PIN_MISMATCH', {
      expectedCapsuleId,
      actualCapsuleId: capsule.capsuleId,
    });
  }

  const snapshot = validateAtomicSnapshotText(serializeAtomicSnapshotEnvelope(capsule.headEnvelope));
  if (!snapshot.valid) {
    return invalid('RECOVERY_CAPSULE_SNAPSHOT_INVALID', { snapshotReason: snapshot.reason });
  }
  for (const record of capsule.lineageRecords) {
    const recordValidation = validateSnapshotLineageRecord(record);
    if (!recordValidation.valid) {
      return invalid('RECOVERY_CAPSULE_LINEAGE_INVALID', {
        generation: record?.generation ?? null,
        snapshotId: record?.snapshotId ?? null,
        lineageReason: recordValidation.reason,
      });
    }
  }

  let lineage;
  try {
    lineage = verifySnapshotLineageRecords(capsule.lineageRecords, {
      headEnvelope: capsule.headEnvelope,
    });
  } catch (error) {
    return invalid('RECOVERY_CAPSULE_LINEAGE_INVALID', {
      lineageReason: error?.code ?? error.message,
    });
  }
  if (lineage.branchRecordCount !== 0) {
    return invalid('RECOVERY_CAPSULE_LINEAGE_NOT_LINEAR', {
      branchRecordCount: lineage.branchRecordCount,
    });
  }
  return { valid: true, reason: null, details: {}, capsule, world: snapshot.world, lineage };
}

export async function createSnapshotRecoveryCapsule({
  directory,
  name = 'world',
  requireDirectorySync = true,
} = {}) {
  const inspection = await inspectAtomicSnapshotStore({ directory, name });
  if (inspection.conflict) {
    throw new AtomicSnapshotError(
      'SNAPSHOT_GENERATION_CONFLICT',
      'Cannot create a recovery capsule from conflicting snapshot candidates.',
      { conflict: inspection.conflict },
    );
  }
  if (!inspection.selected) {
    throw new AtomicSnapshotError(
      inspection.anyValid ? 'NO_ELIGIBLE_SNAPSHOT' : 'NO_VALID_SNAPSHOT',
      'Cannot create a recovery capsule without a valid selected snapshot.',
    );
  }
  if (inspection.selected.role !== 'primary') {
    throw new AtomicSnapshotError(
      'RECOVERY_CAPSULE_PRIMARY_REQUIRED',
      'Recovery capsules may only preserve the installed primary snapshot; recover local candidates first.',
      { selectedRole: inspection.selected.role },
    );
  }
  const lineageInspection = await inspectSnapshotLineage({ directory, name, requireDirectorySync });
  const lineage = verifySnapshotLineageRecords(lineageInspection.records, {
    headEnvelope: inspection.selected.envelope,
  });
  const seed = {
    schema: SNAPSHOT_RECOVERY_CAPSULE_SCHEMA,
    headEnvelope: inspection.selected.envelope,
    lineageRecords: lineage.chain,
  };
  const capsule = { ...seed, capsuleId: capsuleIdFor(seed) };
  const text = serializeSnapshotRecoveryCapsule(capsule);
  const validation = validateSnapshotRecoveryCapsuleText(text, { expectedCapsuleId: capsule.capsuleId });
  if (!validation.valid) {
    throw new AtomicSnapshotError(validation.reason, 'Created recovery capsule did not self-validate.', validation.details);
  }
  return {
    schema: 'axm.echoworld.snapshot-recovery-capsule-creation/v0.01',
    status: 'CREATED',
    capsuleId: capsule.capsuleId,
    generation: capsule.headEnvelope.generation,
    snapshotId: capsule.headEnvelope.snapshotId,
    canonicalHash: capsule.headEnvelope.canonicalHash,
    lineageLength: capsule.lineageRecords.length,
    capsule,
    text,
  };
}

function assertLineageTargetCompatible(existingRecords, proposedRecords) {
  const proposed = new Map(proposedRecords.map((record) => [record.snapshotId, record]));
  for (const existing of existingRecords) {
    const expected = proposed.get(existing.snapshotId);
    if (
      !expected
      || expected.lineageRecordId !== existing.lineageRecordId
      || expected.recordHash !== existing.recordHash
    ) {
      throw new AtomicSnapshotError(
        'RECOVERY_TARGET_NOT_EMPTY',
        'Recovery target contains lineage outside the pinned capsule.',
        { snapshotId: existing.snapshotId },
      );
    }
  }
}

function recoveryReceipt(status, directory, name, validation, directorySync = null) {
  return {
    schema: SNAPSHOT_RECOVERY_RECEIPT_SCHEMA,
    status,
    directory,
    name,
    capsuleId: validation.capsule.capsuleId,
    generation: validation.capsule.headEnvelope.generation,
    snapshotId: validation.capsule.headEnvelope.snapshotId,
    canonicalHash: validation.capsule.headEnvelope.canonicalHash,
    lineageLength: validation.lineage.chainLength,
    directorySync,
  };
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function restoreSnapshotRecoveryCapsule({
  directory,
  name = 'world',
  capsuleText,
  expectedCapsuleId,
  requireDirectorySync = true,
  onStage = null,
} = {}) {
  if (typeof expectedCapsuleId !== 'string' || expectedCapsuleId.length === 0) {
    throw new AtomicSnapshotError(
      'RECOVERY_CAPSULE_PIN_REQUIRED',
      'Restore requires a caller-owned expected capsule ID.',
    );
  }
  const validation = validateSnapshotRecoveryCapsuleText(capsuleText, { expectedCapsuleId });
  if (!validation.valid) {
    throw new AtomicSnapshotError(validation.reason, 'Recovery capsule admission failed.', validation.details);
  }

  await mkdir(directory, { recursive: true });
  const store = await inspectAtomicSnapshotStore({ directory, name });
  if (await pathExists(store.paths.backupTemp)) {
    throw new AtomicSnapshotError(
      'RECOVERY_TARGET_NOT_EMPTY',
      'Recovery target contains an unfinished backup candidate and will not delete it.',
      { path: store.paths.backupTemp },
    );
  }
  if (store.anyExisting) {
    const existing = store.selected;
    const onlyPinnedHead = (
      !store.conflict
      && existing?.envelope?.snapshotId === validation.capsule.headEnvelope.snapshotId
      && store.candidates.filter((candidate) => candidate.exists).every(
        (candidate) => candidate.valid && candidate.envelope.snapshotId === existing.envelope.snapshotId,
      )
    );
    if (!onlyPinnedHead) {
      throw new AtomicSnapshotError(
        'RECOVERY_TARGET_NOT_EMPTY',
        'Recovery requires an empty store namespace and will not overwrite local candidates.',
        { candidates: store.candidateSummaries },
      );
    }
  }

  const lineageInspection = await inspectSnapshotLineage({ directory, name, requireDirectorySync });
  assertLineageTargetCompatible(lineageInspection.records, validation.capsule.lineageRecords);
  await restoreSnapshotLineageRecords({
    directory,
    name,
    records: validation.capsule.lineageRecords,
    headEnvelope: validation.capsule.headEnvelope,
    requireDirectorySync,
  });

  const stageContext = {
    capsuleId: validation.capsule.capsuleId,
    generation: validation.capsule.headEnvelope.generation,
    snapshotId: validation.capsule.headEnvelope.snapshotId,
  };
  if (
    store.selected?.role === 'primary'
    && store.selected.envelope.snapshotId === validation.capsule.headEnvelope.snapshotId
  ) {
    const directorySync = await syncDirectory(directory, { requireDirectorySync });
    await invokeSnapshotStage(onStage, 'AFTER_RECOVERY_DIRECTORY_FSYNC', {
      ...stageContext,
      directorySync,
      resumed: true,
    });
    return recoveryReceipt('ALREADY_RESTORED', directory, name, validation, directorySync);
  }

  const paths = atomicSnapshotPaths(directory, name);
  await cleanupTransientSnapshotPaths(paths);
  await writeFileWithSync(
    paths.recoveryTemp,
    serializeAtomicSnapshotEnvelope(validation.capsule.headEnvelope),
  );
  await invokeSnapshotStage(onStage, 'AFTER_RECOVERY_TEMP_FSYNC', stageContext);
  await renameReplacing(paths.recoveryTemp, paths.primary);
  await invokeSnapshotStage(onStage, 'AFTER_RECOVERY_PRIMARY_RENAME', stageContext);
  const directorySync = await syncDirectory(directory, { requireDirectorySync });
  await invokeSnapshotStage(onStage, 'AFTER_RECOVERY_DIRECTORY_FSYNC', {
    ...stageContext,
    directorySync,
    resumed: false,
  });
  const primary = await readSnapshotCandidate('primary', paths.primary);
  if (!primary.valid || primary.envelope.snapshotId !== validation.capsule.headEnvelope.snapshotId) {
    throw new AtomicSnapshotError(
      'RECOVERY_CAPSULE_INSTALL_VERIFICATION_FAILED',
      'Installed recovery snapshot did not match the pinned capsule.',
    );
  }
  return recoveryReceipt('RESTORED', directory, name, validation, directorySync);
}
