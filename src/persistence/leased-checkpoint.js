import {
  AtomicSnapshotError,
  atomicSnapshotPaths,
} from './atomic-types.js';
import {
  checkpointSourceMutationEvidence,
  createImmutableCheckpointSession,
} from './checkpoint-session.js';
import {
  loadAtomicWorldSnapshot,
  saveAtomicWorldSnapshot,
} from './atomic-store.js';
import {
  acquirePlatformWriteLock,
  assertPlatformWriteLock,
  releasePlatformWriteLock,
} from './platform-lock.js';
import { readSnapshotCandidate } from './snapshot-candidates.js';
import { recoverAtomicWorldSnapshot } from './recovery.js';
import {
  assertWriterLease,
  renewWriterLease,
  writerLeaseCandidatePolicy,
} from './writer-lease.js';

function nowFrom(clock) {
  const value = clock();
  if (!Number.isFinite(value)) {
    throw new AtomicSnapshotError('INVALID_LEASE_CLOCK', 'clock must return a finite millisecond value.');
  }
  return value;
}

function assertExpectedBase(base, expectedBaseGeneration, expectedBaseSnapshotId) {
  if (base.generation !== expectedBaseGeneration || base.snapshotId !== expectedBaseSnapshotId) {
    throw new AtomicSnapshotError(
      'CHECKPOINT_BASE_CHANGED',
      'The durable base changed after the lease handle was issued.',
      {
        expectedBaseGeneration,
        actualBaseGeneration: base.generation,
        expectedBaseSnapshotId,
        actualBaseSnapshotId: base.snapshotId,
      },
    );
  }
}

async function assertPrimaryStillMatchesBase({
  directory,
  name,
  expectedBaseGeneration,
  expectedBaseSnapshotId,
}) {
  const paths = atomicSnapshotPaths(directory, name);
  const primary = await readSnapshotCandidate('primary', paths.primary);
  if (expectedBaseGeneration === 0 && expectedBaseSnapshotId === null) {
    if (primary.exists) {
      throw new AtomicSnapshotError(
        'CHECKPOINT_PRIMARY_BASE_CHANGED',
        'A primary snapshot appeared after checkpoint admission.',
        { expectedBaseGeneration, expectedBaseSnapshotId },
      );
    }
    return;
  }
  if (
    !primary.valid
    || primary.envelope.generation !== expectedBaseGeneration
    || primary.envelope.snapshotId !== expectedBaseSnapshotId
  ) {
    throw new AtomicSnapshotError(
      'CHECKPOINT_PRIMARY_BASE_CHANGED',
      'The installed primary changed after checkpoint admission.',
      {
        expectedBaseGeneration,
        expectedBaseSnapshotId,
        actualGeneration: primary.envelope?.generation ?? null,
        actualSnapshotId: primary.envelope?.snapshotId ?? null,
        primaryValid: primary.valid,
        primaryReason: primary.reason,
      },
    );
  }
}

export async function saveLeasedAtomicWorldSnapshot({
  directory,
  name = 'world',
  world,
  lease,
  expectedBaseGeneration = lease?.baseGeneration,
  expectedBaseSnapshotId = lease?.baseSnapshotId,
  clock = Date.now,
  renewForMs = lease?.leaseDurationMs,
  minimumRemainingMs = 1,
  requireQuiescent = true,
  platformLockDurationMs = null,
  onCheckpointSession = null,
  onAuthorityBoundary = null,
  onPlatformLockStage = null,
  onStage = null,
  requireDirectorySync = true,
} = {}) {
  const startNow = nowFrom(clock);
  let currentLease = lease;
  if (Number.isInteger(renewForMs) && renewForMs > 0) {
    currentLease = await renewWriterLease({
      directory,
      name,
      lease,
      nowMs: startNow,
      leaseDurationMs: renewForMs,
      requireDirectorySync,
    });
  }
  const initialAssertion = await assertWriterLease({
    directory,
    name,
    lease: currentLease,
    nowMs: startNow,
    minimumRemainingMs,
    requireDirectorySync,
  });

  let latestLogicalMs = initialAssertion.logicalNowMs;
  const lockDuration = platformLockDurationMs ?? Math.max(1, initialAssertion.remainingMs);
  const platformLock = await acquirePlatformWriteLock({
    directory,
    name,
    ownerId: `${currentLease.writerId}:${currentLease.leaseId}`,
    fencingToken: currentLease.fencingToken,
    leaseId: currentLease.leaseId,
    logicalNowMs: latestLogicalMs,
    lockDurationMs: lockDuration,
    onStage: onPlatformLockStage,
    requireDirectorySync,
  });

  try {
    const candidatePolicy = writerLeaseCandidatePolicy(currentLease.fencingToken);
    const base = await recoverAtomicWorldSnapshot({
      directory,
      name,
      allowMissing: true,
      promote: true,
      cleanupTransient: true,
      requireDirectorySync,
      candidatePolicy,
    });
    assertExpectedBase(base, expectedBaseGeneration, expectedBaseSnapshotId);

    const admissionAssertion = await assertWriterLease({
      directory,
      name,
      lease: currentLease,
      nowMs: nowFrom(clock),
      minimumRemainingMs,
      requireDirectorySync,
    });
    latestLogicalMs = admissionAssertion.logicalNowMs;
    await assertPlatformWriteLock({
      directory,
      name,
      lock: platformLock,
      logicalNowMs: latestLogicalMs,
    });

    const session = createImmutableCheckpointSession({
      world,
      lease: currentLease,
      baseGeneration: base.generation,
      baseSnapshotId: base.snapshotId,
      admittedAtMs: admissionAssertion.nowMs,
      admittedLogicalMs: admissionAssertion.logicalNowMs,
      clockObservationId: admissionAssertion.clockObservationId,
      requireQuiescent,
    });
    if (onCheckpointSession) await onCheckpointSession(session);

    const authorityGuard = async (boundary, context) => {
      const leaseAssertion = await assertWriterLease({
        directory,
        name,
        lease: currentLease,
        nowMs: nowFrom(clock),
        minimumRemainingMs: boundary === 'BEFORE_PRIMARY_RENAME' ? minimumRemainingMs : 0,
        requireDirectorySync,
      });
      latestLogicalMs = leaseAssertion.logicalNowMs;
      const platformLockAssertion = await assertPlatformWriteLock({
        directory,
        name,
        lock: platformLock,
        logicalNowMs: latestLogicalMs,
      });
      if (boundary === 'BEFORE_PRIMARY_RENAME') {
        await assertPrimaryStillMatchesBase({
          directory,
          name,
          expectedBaseGeneration: base.generation,
          expectedBaseSnapshotId: base.snapshotId,
        });
      }
      if (onAuthorityBoundary) {
        await onAuthorityBoundary(boundary, {
          ...context,
          leaseAssertion,
          platformLockAssertion,
          checkpoint: session.checkpoint,
          checkpointSessionId: session.sessionId,
        });
      }
    };

    const snapshot = await saveAtomicWorldSnapshot({
      directory,
      name,
      world: session.snapshotWorld,
      checkpoint: session.checkpoint,
      expectedBaseGeneration: base.generation,
      expectedBaseSnapshotId: base.snapshotId,
      candidatePolicy,
      authorityGuard,
      onStage,
      requireDirectorySync,
    });
    const sourceMutation = checkpointSourceMutationEvidence(session, world);

    return {
      ...snapshot,
      leaseAssertion: initialAssertion,
      platformLock: {
        lockId: platformLock.lockId,
        fencingToken: platformLock.fencingToken,
      },
      checkpointBarrier: session.checkpointBarrier,
      checkpointSession: {
        sessionId: session.sessionId,
        sourcePayloadHash: session.sourcePayloadHash,
        operationalHash: session.operationalHash,
      },
      sourceMutation,
      nextLease: {
        ...currentLease,
        baseGeneration: snapshot.generation,
        baseSnapshotId: snapshot.snapshotId,
        baseCanonicalHash: snapshot.canonicalHash,
      },
    };
  } finally {
    await releasePlatformWriteLock({
      directory,
      name,
      lock: platformLock,
      logicalNowMs: latestLogicalMs,
      onStage: onPlatformLockStage,
      requireDirectorySync,
    }).catch(() => {});
  }
}

export async function loadFencedAtomicWorldSnapshot({
  directory,
  name = 'world',
  lease,
  nowMs = Date.now(),
  requireDirectorySync = true,
} = {}) {
  await assertWriterLease({ directory, name, lease, nowMs, requireDirectorySync });
  return loadAtomicWorldSnapshot({
    directory,
    name,
    requireDirectorySync,
    candidatePolicy: writerLeaseCandidatePolicy(lease.fencingToken),
  });
}
