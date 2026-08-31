import { randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';

import { AtomicSnapshotError, sha256 } from './atomic-types.js';
import { syncDirectory } from './fs-durability.js';

export const PLATFORM_LOCK_SCHEMAS = Object.freeze({
  owner: 'axm.echoworld.platform-write-lock-owner/v0.01',
  handle: 'axm.echoworld.platform-write-lock-handle/v0.01',
});

export const PLATFORM_LOCK_STAGES = Object.freeze([
  'AFTER_LOCK_DIRECTORY_CREATE',
  'AFTER_LOCK_OWNER_FSYNC',
  'AFTER_STALE_LOCK_RENAME',
  'AFTER_LOCK_RELEASE_RENAME',
]);

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

function hashIdentity(record, omitted = []) {
  return sha256(JSON.stringify(stable(Object.fromEntries(
    Object.entries(record).filter(([key]) => !omitted.includes(key)),
  ))));
}

function seal(record) {
  return { ...record, recordHash: hashIdentity(record) };
}

function validateOwner(owner) {
  if (
    !owner
    || owner.schema !== PLATFORM_LOCK_SCHEMAS.owner
    || typeof owner.recordHash !== 'string'
  ) {
    return { valid: false, reason: 'SCHEMA_OR_HASH_MISSING' };
  }
  if (hashIdentity(owner, ['recordHash']) !== owner.recordHash) {
    return { valid: false, reason: 'RECORD_HASH_MISMATCH' };
  }
  const expectedId = `PWL_${hashIdentity(owner, ['lockId', 'recordHash']).slice(0, 24)}`;
  if (owner.lockId !== expectedId) {
    return { valid: false, reason: 'LOCK_ID_MISMATCH' };
  }
  return { valid: true, reason: null };
}

export function platformWriteLockPaths(directory, name = 'world') {
  const lockDirectory = path.join(directory, `${name}.platform-write-lock`);
  return {
    lockDirectory,
    ownerFile: path.join(lockDirectory, 'owner.json'),
    parentDirectory: directory,
  };
}

async function invokeStage(onStage, stage, context) {
  if (!PLATFORM_LOCK_STAGES.includes(stage)) {
    throw new AtomicSnapshotError('UNKNOWN_PLATFORM_LOCK_STAGE', `Unknown platform lock stage: ${stage}`);
  }
  if (onStage) await onStage(stage, context);
}

async function writeOwner(filePath, owner) {
  const sealed = seal(owner);
  const handle = await open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(sealed, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close().catch(() => {});
  }
  return sealed;
}

async function readOwner(paths) {
  try {
    const text = await readFile(paths.ownerFile, 'utf8');
    const owner = JSON.parse(text);
    return { exists: true, owner, ...validateOwner(owner) };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { exists: false, owner: null, valid: false, reason: 'OWNER_MISSING' };
    }
    return {
      exists: true,
      owner: null,
      valid: false,
      reason: error instanceof SyntaxError ? 'OWNER_JSON_INVALID' : 'OWNER_READ_FAILED',
      details: { code: error?.code ?? null, message: error.message },
    };
  }
}

export async function inspectPlatformWriteLock({
  directory,
  name = 'world',
  logicalNowMs,
} = {}) {
  if (!Number.isFinite(logicalNowMs)) {
    throw new AtomicSnapshotError('INVALID_PLATFORM_LOCK_TIME', 'logicalNowMs must be finite.');
  }
  const paths = platformWriteLockPaths(directory, name);
  const result = await readOwner(paths);
  return {
    schema: 'axm.echoworld.platform-write-lock-inspection/v0.01',
    directory,
    name,
    paths,
    exists: result.exists,
    valid: result.valid,
    reason: result.reason,
    owner: result.owner,
    active: Boolean(result.valid && result.owner.expiresAtLogicalMs > logicalNowMs),
    stale: Boolean(result.valid && result.owner.expiresAtLogicalMs <= logicalNowMs),
  };
}

export async function acquirePlatformWriteLock({
  directory,
  name = 'world',
  ownerId,
  fencingToken,
  leaseId,
  logicalNowMs,
  lockDurationMs = 30_000,
  onStage = null,
  requireDirectorySync = true,
} = {}) {
  if (typeof ownerId !== 'string' || ownerId.length === 0) {
    throw new AtomicSnapshotError('INVALID_PLATFORM_LOCK_OWNER', 'ownerId must be non-empty.');
  }
  if (!Number.isInteger(fencingToken) || fencingToken < 1) {
    throw new AtomicSnapshotError('INVALID_FENCING_TOKEN', 'fencingToken must be positive.');
  }
  if (!Number.isFinite(logicalNowMs)) {
    throw new AtomicSnapshotError('INVALID_PLATFORM_LOCK_TIME', 'logicalNowMs must be finite.');
  }
  if (!Number.isInteger(lockDurationMs) || lockDurationMs < 1) {
    throw new AtomicSnapshotError('INVALID_PLATFORM_LOCK_DURATION', 'lockDurationMs must be positive.');
  }
  await mkdir(directory, { recursive: true });
  const paths = platformWriteLockPaths(directory, name);

  for (;;) {
    try {
      await mkdir(paths.lockDirectory, { mode: 0o700 });
      await invokeStage(onStage, 'AFTER_LOCK_DIRECTORY_CREATE', {
        ownerId,
        fencingToken,
        logicalNowMs,
      });
      const owner = {
        schema: PLATFORM_LOCK_SCHEMAS.owner,
        ownerId,
        leaseId,
        fencingToken,
        nonce: randomUUID(),
        acquiredAtLogicalMs: logicalNowMs,
        expiresAtLogicalMs: logicalNowMs + lockDurationMs,
      };
      owner.lockId = `PWL_${hashIdentity(owner).slice(0, 24)}`;
      const sealedOwner = await writeOwner(paths.ownerFile, owner);
      await syncDirectory(paths.lockDirectory, { requireDirectorySync });
      await syncDirectory(paths.parentDirectory, { requireDirectorySync });
      await invokeStage(onStage, 'AFTER_LOCK_OWNER_FSYNC', { owner: sealedOwner });
      return {
        schema: PLATFORM_LOCK_SCHEMAS.handle,
        directory,
        name,
        lockId: sealedOwner.lockId,
        ownerId,
        leaseId,
        fencingToken,
        acquiredAtLogicalMs: sealedOwner.acquiredAtLogicalMs,
        expiresAtLogicalMs: sealedOwner.expiresAtLogicalMs,
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        await rm(paths.lockDirectory, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    }

    const inspection = await inspectPlatformWriteLock({ directory, name, logicalNowMs });
    if (!inspection.valid) {
      throw new AtomicSnapshotError(
        'PLATFORM_LOCK_CORRUPT',
        'The platform write-lock directory exists without a trustworthy owner record.',
        { inspection },
      );
    }
    if (inspection.active) {
      throw new AtomicSnapshotError('PLATFORM_LOCK_HELD', 'Another platform write lock is active.', {
        owner: inspection.owner,
      });
    }

    const stalePath = `${paths.lockDirectory}.stale-${inspection.owner.lockId}-${randomUUID()}`;
    try {
      await rename(paths.lockDirectory, stalePath);
      await syncDirectory(paths.parentDirectory, { requireDirectorySync });
      await invokeStage(onStage, 'AFTER_STALE_LOCK_RENAME', {
        staleOwner: inspection.owner,
        stalePath,
      });
      await rm(stalePath, { recursive: true, force: true });
      await syncDirectory(paths.parentDirectory, { requireDirectorySync });
    } catch (error) {
      if (['ENOENT', 'EEXIST'].includes(error?.code)) continue;
      throw error;
    }
  }
}

export async function assertPlatformWriteLock({
  directory,
  name = 'world',
  lock,
  logicalNowMs,
} = {}) {
  if (!lock || lock.schema !== PLATFORM_LOCK_SCHEMAS.handle) {
    throw new AtomicSnapshotError('INVALID_PLATFORM_LOCK_HANDLE', 'A valid platform lock handle is required.');
  }
  const inspection = await inspectPlatformWriteLock({ directory, name, logicalNowMs });
  if (!inspection.valid || !inspection.owner) {
    throw new AtomicSnapshotError('PLATFORM_LOCK_NOT_ACTIVE', 'The platform lock is not active.', {
      inspection,
    });
  }
  if (
    inspection.owner.lockId !== lock.lockId
    || inspection.owner.ownerId !== lock.ownerId
    || inspection.owner.fencingToken !== lock.fencingToken
  ) {
    throw new AtomicSnapshotError('PLATFORM_LOCK_FENCED', 'A different platform lock owns the write gate.', {
      lock,
      owner: inspection.owner,
    });
  }
  if (!inspection.active) {
    throw new AtomicSnapshotError('PLATFORM_LOCK_EXPIRED', 'The platform write lock has expired.', {
      lock,
      owner: inspection.owner,
      logicalNowMs,
    });
  }
  return {
    schema: 'axm.echoworld.platform-write-lock-assertion/v0.01',
    status: 'CURRENT_OWNER',
    lockId: lock.lockId,
    ownerId: lock.ownerId,
    fencingToken: lock.fencingToken,
    logicalNowMs,
    expiresAtLogicalMs: inspection.owner.expiresAtLogicalMs,
  };
}

export async function releasePlatformWriteLock({
  directory,
  name = 'world',
  lock,
  logicalNowMs,
  onStage = null,
  requireDirectorySync = true,
} = {}) {
  await assertPlatformWriteLock({ directory, name, lock, logicalNowMs });
  const paths = platformWriteLockPaths(directory, name);
  const releasedPath = `${paths.lockDirectory}.released-${lock.lockId}-${randomUUID()}`;
  await rename(paths.lockDirectory, releasedPath);
  await syncDirectory(paths.parentDirectory, { requireDirectorySync });
  await invokeStage(onStage, 'AFTER_LOCK_RELEASE_RENAME', { lock, releasedPath });
  await rm(releasedPath, { recursive: true, force: true });
  await syncDirectory(paths.parentDirectory, { requireDirectorySync });
  return {
    schema: 'axm.echoworld.platform-write-lock-release-receipt/v0.01',
    status: 'RELEASED',
    lockId: lock.lockId,
    ownerId: lock.ownerId,
    fencingToken: lock.fencingToken,
    releasedAtLogicalMs: logicalNowMs,
  };
}

export async function withPlatformWriteLock(options, callback) {
  const lock = await acquirePlatformWriteLock(options);
  try {
    return await callback(lock);
  } finally {
    await releasePlatformWriteLock({
      ...options,
      lock,
      logicalNowMs: options.logicalNowMs,
    }).catch(() => {});
  }
}
