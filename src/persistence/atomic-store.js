import { mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  ATOMIC_SNAPSHOT_RECEIPT_SCHEMA,
  AtomicSnapshotError,
  atomicSnapshotPaths,
  invokeSnapshotStage,
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

async function copyPrimaryToBackup(paths, { onStage, requireDirectorySync, context }) {
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
    return directorySync;
  } catch (error) {
    if (error?.code === 'ENOENT') return { synced: false, unsupportedCode: null };
    throw error;
  }
}

export async function saveAtomicWorldSnapshot({
  directory,
  name = 'world',
  world,
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
  });
  const generation = previous.generation + 1;
  const envelope = createAtomicSnapshotEnvelope(world, {
    generation,
    parentSnapshotId: previous.snapshotId,
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
  };

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

  const backupDirectorySync = await copyPrimaryToBackup(paths, {
    onStage,
    requireDirectorySync,
    context: stageContext,
  });

  await renameReplacing(paths.temp, paths.primary);
  await invokeSnapshotStage(onStage, 'AFTER_PRIMARY_RENAME', stageContext);
  const primaryDirectorySync = await syncDirectory(directory, { requireDirectorySync });
  await invokeSnapshotStage(onStage, 'AFTER_PRIMARY_DIRECTORY_FSYNC', {
    ...stageContext,
    directorySync: primaryDirectorySync,
  });

  const primary = await readSnapshotCandidate('primary', paths.primary);
  if (!primary.valid || primary.envelope.snapshotId !== envelope.snapshotId) {
    throw new AtomicSnapshotError(
      'PRIMARY_VERIFICATION_FAILED',
      'The newly installed primary snapshot did not pass integrity verification.',
      { primary: snapshotCandidateSummary(primary), expectedSnapshotId: envelope.snapshotId },
    );
  }

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
    previousStatus: previous.status,
    previousGeneration: previous.generation,
    previousSnapshotId: previous.snapshotId,
    backupDirectorySync,
    primaryDirectorySync,
    paths,
  };
}

export async function loadAtomicWorldSnapshot(options = {}) {
  return recoverAtomicWorldSnapshot({
    ...options,
    allowMissing: false,
    promote: true,
    cleanupTransient: true,
  });
}

export {
  ATOMIC_SNAPSHOT_RECEIPT_SCHEMA,
  ATOMIC_SNAPSHOT_SCHEMA,
  ATOMIC_SNAPSHOT_STAGES,
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
