import { createHash } from 'node:crypto';
import path from 'node:path';

export const ATOMIC_SNAPSHOT_SCHEMA = 'axm.echoworld.atomic-snapshot/v0.02';
export const LEGACY_ATOMIC_SNAPSHOT_SCHEMA = 'axm.echoworld.atomic-snapshot/v0.01';
export const SUPPORTED_ATOMIC_SNAPSHOT_SCHEMAS = Object.freeze([
  LEGACY_ATOMIC_SNAPSHOT_SCHEMA,
  ATOMIC_SNAPSHOT_SCHEMA,
]);
export const ATOMIC_SNAPSHOT_RECEIPT_SCHEMA = 'axm.echoworld.atomic-snapshot-receipt/v0.03';

export const ATOMIC_SNAPSHOT_STAGES = Object.freeze([
  'AFTER_TEMP_WRITE',
  'AFTER_TEMP_FSYNC',
  'AFTER_BACKUP_RENAME',
  'AFTER_BACKUP_DIRECTORY_FSYNC',
  'AFTER_PRIMARY_RENAME',
  'AFTER_PRIMARY_DIRECTORY_FSYNC',
  'AFTER_PRIMARY_VERIFY',
  'AFTER_LINEAGE_RECORD_FSYNC',
  'AFTER_RECOVERY_TEMP_FSYNC',
  'AFTER_RECOVERY_PRIMARY_RENAME',
  'AFTER_RECOVERY_DIRECTORY_FSYNC',
]);

export const ATOMIC_WRITE_AUTHORITY_BOUNDARIES = Object.freeze([
  'AFTER_BASE_RECOVERY',
  'BEFORE_TEMP_WRITE',
  'AFTER_TEMP_FSYNC',
  'BEFORE_BACKUP_COPY',
  'AFTER_BACKUP_DIRECTORY_FSYNC',
  'BEFORE_PRIMARY_RENAME',
  'AFTER_PRIMARY_DIRECTORY_FSYNC',
  'AFTER_PRIMARY_VERIFY',
  'AFTER_LINEAGE_RECORD_FSYNC',
]);

export class AtomicSnapshotError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AtomicSnapshotError';
    this.code = code;
    this.details = details;
  }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function atomicSnapshotPaths(directory, name = 'world') {
  if (typeof name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new AtomicSnapshotError(
      'INVALID_STORE_NAME',
      'Snapshot store name may contain only letters, numbers, dot, underscore, and hyphen.',
      { name },
    );
  }
  const prefix = path.join(directory, name);
  return {
    primary: `${prefix}.snapshot.json`,
    backup: `${prefix}.snapshot.backup.json`,
    temp: `${prefix}.snapshot.tmp.json`,
    recoveryTemp: `${prefix}.snapshot.recover.tmp.json`,
    backupTemp: `${prefix}.snapshot.backup.tmp.json`,
  };
}

export async function invokeSnapshotStage(onStage, stage, context) {
  if (!ATOMIC_SNAPSHOT_STAGES.includes(stage)) {
    throw new AtomicSnapshotError('UNKNOWN_STAGE', `Unknown snapshot stage: ${stage}`);
  }
  if (onStage) await onStage(stage, context);
}

export async function invokeWriteAuthorityGuard(guard, boundary, context) {
  if (!ATOMIC_WRITE_AUTHORITY_BOUNDARIES.includes(boundary)) {
    throw new AtomicSnapshotError(
      'UNKNOWN_WRITE_AUTHORITY_BOUNDARY',
      `Unknown write authority boundary: ${boundary}`,
    );
  }
  if (guard) await guard(boundary, context);
}
