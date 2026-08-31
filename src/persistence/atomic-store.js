import { mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  ATOMIC_SNAPSHOT_RECEIPT_SCHEMA,
  AtomicSnapshotError,
  atomicSnapshotPaths,
  invokeSnapshotStage,
  invokeWriteAuthorityGuard,
} from './atomic-types.js';
import {
  createAtomicSnapshotEnvelope,
  serializeAtomicSnapshotEnvelope,
} from './snapshot-envelope.js';
import {
  inspectAtomicSnapshotStore,
  readSnapshotCandidate,
  snapshotCandidateSummary,
} from './snapshot-candidates.js';
import {
  cleanupTransientSnapshotPaths,
  renameReplacing,
  syncDirectory,
  writeFileWithSync,
} from './fs-durability.js';
import { recoverAtomicWorldSnapshot } from './recovery.js';
import {
  reconcileSnapshotLineageCandidates,
  recordSnapshotLineage,
} from './snapshot-lineage.js';

async function copyPrimaryToBackup(paths, {
  onStage,
  requireDirectorySync,
  context,
  authorityGuard,
}) {
  await invokeWriteAuthorityGuard(authorityGuard, 'BEFORE_BACKUP_COPY', context);
  try {
    const primaryText = await readFile(paths.primary, 'utf8');
    await rm(paths.backupTemp, { force: true });
    await writeFileWithSync(paths.backupTemp, primaryText);
    await renameReplacing(paths.backupTemp, paths.backup);
    await invokeSnapshotStage(onStage, 'AFTER_BACKUP_RENAME', context);
    const directorySync = await syncDirectory(path.dirname(paths.primary), { requireDirectorySync });
    await invokeSnapshotStage(onStage, 'AFTER_BACKUP_DIRECTORY_FSYNC', {
      ...context,
      directorySync,
    });
    await invokeWriteAuthorityGuard(
      authorityGuard,
      'AFTER_BACKUP_DIRECTORY_FSYNC',
      { ...context, directorySync },
    );
    return directorySync;
  } catch (error) {
    if (error?.code === 'ENOENT') return { synced: false, unsupportedCode: null };
    throw error;
  }
}

function assertExpectedBase(previous, { expectedBaseGeneration, expectedBaseSnapshotId }) {
  if (expectedBaseGeneration !== undefined && previous.generation !== expectedBaseGeneration) {
    throw new AtomicSnapshotError(
      'CHECKPOINT_BASE_CHANGED',
      'The durable base generation changed before checkpoint admission.',
      {
        expectedBaseGeneration,
        actualBaseGeneration: previous.generation,
        expectedBaseSnapshotId,
        actualBaseSnapshotId: previous.snapshotId,
      },
    );
  }
  if (expectedBaseSnapshotId !== undefined && previous.snapshotId !== expectedBaseSnapshotId) {
    throw new AtomicSnapshotError(
      'CHECKPOINT_BASE_CHANGED',
      'The durable base snapshot changed before checkpoint admission.',
      {
        expectedBaseGeneration,
        actualBaseGeneration: previous.generation,
        expectedBaseSnapshotId,
        actualBaseSnapshotId: previous.snapshotId,
      },
    );
  }
}

async function reconcileCurrentLineage({
  directory,
  name,
  generation,
  candidatePolicy,
  requireDirectorySync,
}) {
  if (generation === 0) return null;
  const inspection = await inspectAtomicSnapshotStore({ directory, name, candidatePolicy });
  if (!inspection.selected) {
    throw new AtomicSnapshotError('SNAPSHOT_LINEAGE_HEAD_UNAVAILABLE', 'Selected snapshot is unavailable for lineage reconciliation.');
  }
  return reconcileSnapshotLineageCandidates({
    directory,
    name,
    candidates: inspection.candidates,
    selectedEnvelope: inspection.selected.envelope,
    requireDirectorySync,
  });
}

export async function saveAtomicWorldSnapshot({
  directory,
  name = 'world',
  world,
  checkpoint = null,
  expectedBaseGeneration = undefined,
  expectedBaseSnapshotId = undefined,
  candidatePolicy = null,
  authorityGuard = null,
  onStage = null,
  requireDirectorySync = true,
} = {}) {
  if (!world || typeof world !== 'object') {
    throw new AtomicSnapshotError('INVALID_WORLD', 'world must be an object.');
  }
  await mkdir(directory, { recursive: true });

  const previous = await recoverAtomicWorldSnapshot({
    directory,
    name,
    allowMissing: true,
    promote: true,
    cleanupTransient: true,
    requireDirectorySync,
    candidatePolicy,
  });
  assertExpectedBase(previous, { expectedBaseGeneration, expectedBaseSnapshotId });
  const lineageBefore = await reconcileCurrentLineage({
    directory,
    name,
    generation: previous.generation,
    candidatePolicy,
    requireDirectorySync,
  });

  const generation = previous.generation + 1;
  const envelope = createAtomicSnapshotEnvelope(world, {
    generation,
    parentSnapshotId: previous.snapshotId,
    checkpoint,
  });
  const text = serializeAtomicSnapshotEnvelope(envelope);
  const paths = atomicSnapshotPaths(directory, name);
  const stageContext = {
    operation: 'SAVE',
    generation,
    snapshotId: envelope.snapshotId,
    parentSnapshotId: envelope.parentSnapshotId,
    canonicalHash: envelope.canonicalHash,
    payloadHash: envelope.payloadHash,
    checkpointId: envelope.checkpoint?.checkpointId ?? null,
    checkpointSessionId: envelope.checkpoint?.checkpointSessionId ?? null,
    fencingToken: envelope.checkpoint?.fencingToken ?? null,
    writerId: envelope.checkpoint?.writerId ?? null,
  };

  await invokeWriteAuthorityGuard(authorityGuard, 'AFTER_BASE_RECOVERY', {
    ...stageContext,
    previousGeneration: previous.generation,
    previousSnapshotId: previous.snapshotId,
  });
  await invokeWriteAuthorityGuard(authorityGuard, 'BEFORE_TEMP_WRITE', stageContext);

  await rm(paths.temp, { force: true });
  const tempHandle = await open(paths.temp, 'w', 0o600);
  try {
    await tempHandle.writeFile(text, 'utf8');
    await invokeSnapshotStage(onStage, 'AFTER_TEMP_WRITE', stageContext);
    await tempHandle.sync();
    await invokeSnapshotStage(onStage, 'AFTER_TEMP_FSYNC', stageContext);
  } finally {
    await tempHandle.close().catch(() => {});
  }
  await invokeWriteAuthorityGuard(authorityGuard, 'AFTER_TEMP_FSYNC', stageContext);

  const backupDirectorySync = await copyPrimaryToBackup(paths, {
    onStage,
    requireDirectorySync,
    context: stageContext,
    authorityGuard,
  });

  await invokeWriteAuthorityGuard(authorityGuard, 'BEFORE_PRIMARY_RENAME', stageContext);
  await renameReplacing(paths.temp, paths.primary);
  await invokeSnapshotStage(onStage, 'AFTER_PRIMARY_RENAME', stageContext);
  const primaryDirectorySync = await syncDirectory(directory, { requireDirectorySync });
  await invokeSnapshotStage(onStage, 'AFTER_PRIMARY_DIRECTORY_FSYNC', {
    ...stageContext,
    directorySync: primaryDirectorySync,
  });
  await invokeWriteAuthorityGuard(
    authorityGuard,
    'AFTER_PRIMARY_DIRECTORY_FSYNC',
    { ...stageContext, directorySync: primaryDirectorySync },
  );

  const primary = await readSnapshotCandidate('primary', paths.primary);
  if (!primary.valid || primary.envelope.snapshotId !== envelope.snapshotId) {
    throw new AtomicSnapshotError(
      'PRIMARY_VERIFICATION_FAILED',
      'The newly installed primary snapshot did not pass integrity verification.',
      { primary: snapshotCandidateSummary(primary), expectedSnapshotId: envelope.snapshotId },
    );
  }
  await invokeSnapshotStage(onStage, 'AFTER_PRIMARY_VERIFY', stageContext);
  await invokeWriteAuthorityGuard(authorityGuard, 'AFTER_PRIMARY_VERIFY', stageContext);

  const lineage = await recordSnapshotLineage({
    directory,
    name,
    envelope: primary.envelope,
    requireDirectorySync,
  });
  await invokeSnapshotStage(onStage, 'AFTER_LINEAGE_RECORD_FSYNC', {
    ...stageContext,
    lineageHead: lineage.headSnapshotId,
  });
  await invokeWriteAuthorityGuard(authorityGuard, 'AFTER_LINEAGE_RECORD_FSYNC', {
    ...stageContext,
    lineageHead: lineage.headSnapshotId,
  });

  await cleanupTransientSnapshotPaths(paths);

  return {
    schema: ATOMIC_SNAPSHOT_RECEIPT_SCHEMA,
    operation: 'SAVE',
    status: 'COMMITTED',
    directory,
    name,
    generation,
    snapshotId: envelope.snapshotId,
    parentSnapshotId: envelope.parentSnapshotId,
    canonicalHash: envelope.canonicalHash,
    payloadHash: envelope.payloadHash,
    checkpoint: envelope.checkpoint,
    previousStatus: previous.status,
    previousGeneration: previous.generation,
    previousSnapshotId: previous.snapshotId,
    backupDirectorySync,
    primaryDirectorySync,
    lineageBefore,
    lineage,
    paths,
  };
}

export async function loadAtomicWorldSnapshot(options = {}) {
  const recovered = await recoverAtomicWorldSnapshot({
    ...options,
    allowMissing: false,
    promote: true,
    cleanupTransient: true,
  });
  const inspection = await inspectAtomicSnapshotStore({
    directory: options.directory,
    name: options.name ?? 'world',
    candidatePolicy: options.candidatePolicy ?? null,
  });
  const lineage = await reconcileSnapshotLineageCandidates({
    directory: options.directory,
    name: options.name ?? 'world',
    candidates: inspection.candidates,
    selectedEnvelope: inspection.selected.envelope,
    requireDirectorySync: options.requireDirectorySync ?? true,
  });
  return { ...recovered, lineage };
}

export {
  ATOMIC_SNAPSHOT_RECEIPT_SCHEMA,
  ATOMIC_SNAPSHOT_SCHEMA,
  ATOMIC_SNAPSHOT_STAGES,
  ATOMIC_WRITE_AUTHORITY_BOUNDARIES,
  LEGACY_ATOMIC_SNAPSHOT_SCHEMA,
  AtomicSnapshotError,
  atomicSnapshotPaths,
} from './atomic-types.js';
export {
  createAtomicSnapshotEnvelope,
  serializeAtomicSnapshotEnvelope,
  validateAtomicSnapshotText,
} from './snapshot-envelope.js';
export { inspectAtomicSnapshotStore } from './snapshot-candidates.js';
export { recoverAtomicWorldSnapshot } from './recovery.js';
export {
  inspectSnapshotLineage,
  reconcileSnapshotLineageCandidates,
  recordSnapshotLineage,
  verifySnapshotLineage,
  verifySnapshotLineageRecords,
} from './snapshot-lineage.js';
