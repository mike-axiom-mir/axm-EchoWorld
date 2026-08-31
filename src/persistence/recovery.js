import { mkdir, rm } from 'node:fs/promises';

import {
  ATOMIC_SNAPSHOT_RECEIPT_SCHEMA,
  AtomicSnapshotError,
  invokeSnapshotStage,
} from './atomic-types.js';
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

function receiptBase(inspection) {
  return {
    schema: ATOMIC_SNAPSHOT_RECEIPT_SCHEMA,
    operation: 'RECOVER',
    directory: inspection.directory,
    name: inspection.name,
    candidates: inspection.candidateSummaries,
  };
}

export async function recoverAtomicWorldSnapshot({
  directory,
  name = 'world',
  allowMissing = false,
  promote = true,
  cleanupTransient = true,
  onStage = null,
  requireDirectorySync = true,
} = {}) {
  await mkdir(directory, { recursive: true });
  const inspection = await inspectAtomicSnapshotStore({ directory, name });

  if (inspection.conflict) {
    throw new AtomicSnapshotError(
      'SNAPSHOT_GENERATION_CONFLICT',
      'Multiple valid snapshots claim the same highest generation with different identities.',
      { ...receiptBase(inspection), status: 'CONFLICT', conflict: inspection.conflict },
    );
  }

  if (!inspection.selected) {
    if (!inspection.anyExisting && allowMissing) {
      return {
        ...receiptBase(inspection),
        status: 'EMPTY',
        promoted: false,
        generation: 0,
        snapshotId: null,
        canonicalHash: null,
        world: null,
      };
    }
    throw new AtomicSnapshotError(
      'NO_VALID_SNAPSHOT',
      'No valid atomic snapshot candidate was available.',
      { ...receiptBase(inspection), status: 'NO_VALID_SNAPSHOT' },
    );
  }

  const selected = inspection.selected;
  let promoted = false;
  let directorySync = { synced: false, unsupportedCode: null };

  if (promote && selected.role !== 'primary') {
    await rm(inspection.paths.recoveryTemp, { force: true });
    await writeFileWithSync(inspection.paths.recoveryTemp, selected.text);
    await invokeSnapshotStage(onStage, 'AFTER_RECOVERY_TEMP_FSYNC', {
      operation: 'RECOVER',
      generation: selected.envelope.generation,
      snapshotId: selected.envelope.snapshotId,
      selectedRole: selected.role,
    });
    await renameReplacing(inspection.paths.recoveryTemp, inspection.paths.primary);
    promoted = true;
    await invokeSnapshotStage(onStage, 'AFTER_RECOVERY_PRIMARY_RENAME', {
      operation: 'RECOVER',
      generation: selected.envelope.generation,
      snapshotId: selected.envelope.snapshotId,
      selectedRole: selected.role,
    });
    directorySync = await syncDirectory(directory, { requireDirectorySync });
    await invokeSnapshotStage(onStage, 'AFTER_RECOVERY_DIRECTORY_FSYNC', {
      operation: 'RECOVER',
      generation: selected.envelope.generation,
      snapshotId: selected.envelope.snapshotId,
      selectedRole: selected.role,
      directorySync,
    });

    const promotedCandidate = await readSnapshotCandidate('primary', inspection.paths.primary);
    if (!promotedCandidate.valid || promotedCandidate.envelope.snapshotId !== selected.envelope.snapshotId) {
      throw new AtomicSnapshotError(
        'RECOVERY_PROMOTION_VERIFICATION_FAILED',
        'Promoted primary snapshot did not verify against the selected candidate.',
        {
          selected: snapshotCandidateSummary(selected),
          promoted: snapshotCandidateSummary(promotedCandidate),
        },
      );
    }
  }

  if (cleanupTransient) {
    await cleanupTransientSnapshotPaths(inspection.paths);
    if (promoted) directorySync = await syncDirectory(directory, { requireDirectorySync });
  }

  return {
    ...receiptBase(inspection),
    status: promoted ? 'RECOVERED_AND_PROMOTED' : 'PRIMARY_VALID',
    promoted,
    selectedRole: selected.role,
    generation: selected.envelope.generation,
    snapshotId: selected.envelope.snapshotId,
    parentSnapshotId: selected.envelope.parentSnapshotId,
    canonicalHash: selected.envelope.canonicalHash,
    payloadHash: selected.envelope.payloadHash,
    directorySync,
    world: selected.world,
  };
}
