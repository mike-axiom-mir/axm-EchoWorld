import {
  AtomicSnapshotError,
  atomicSnapshotPaths,
} from './atomic-types.js';
import {
  createCheckpointAdmission,
  inspectCheckpointBarrier,
} from './checkpoint.js';
import {
  loadAtomicWorldSnapshot,
  saveAtomicWorldSnapshot,
} from './atomic-store.js';
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
  if (
    base.generation !== expectedBaseGeneration
    || base.snapshotId !== expectedBaseSnapshotId
  ) {
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
  onAuthorityBoundary = null,
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
  const assertion = await assertWriterLease({
    directory,
    name,
    lease: currentLease,
    nowMs: startNow,
    minimumRemainingMs,
    requireDirectorySync,
  });

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

  const barrier = inspectCheckpointBarrier(world, { requireQuiescent });
  if (!barrier.admitted) {
    throw new AtomicSnapshotError(
      'CHECKPOINT_BARRIER_REJECTED',
      'The world is not quiescent enough for a leased checkpoint.',
      { barrier },
    );
  }
  const admissionNow = nowFrom(clock);
  const checkpoint = createCheckpointAdmission({
    world,
    lease: currentLease,
    baseGeneration: base.generation,
    baseSnapshotId: base.snapshotId,
    admittedAtMs: admissionNow,
    requireQuiescent,
  });

  const authorityGuard = async (boundary, context) => {
    const boundaryNow = nowFrom(clock);
    const leaseAssertion = await assertWriterLease({
      directory,
      name,
      lease: currentLease,
      nowMs: boundaryNow,
      minimumRemainingMs: boundary === 'BEFORE_PRIMARY_RENAME' ? minimumRemainingMs : 0,
      requireDirectorySync,
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
        checkpoint,
      });
    }
  };

  const snapshot = await saveAtomicWorldSnapshot({
    directory,
    name,
    world,
    checkpoint,
    expectedBaseGeneration: base.generation,
    expectedBaseSnapshotId: base.snapshotId,
    candidatePolicy,
    authorityGuard,
    onStage,
    requireDirectorySync,
  });

  return {
    ...snapshot,
    leaseAssertion: assertion,
    checkpointBarrier: barrier,
    nextLease: {
      ...currentLease,
      baseGeneration: snapshot.generation,
      baseSnapshotId: snapshot.snapshotId,
      baseCanonicalHash: snapshot.canonicalHash,
    },
  };
}

export async function loadFencedAtomicWorldSnapshot({
  directory,
  name = 'world',
  lease,
  nowMs = Date.now(),
  requireDirectorySync = true,
} = {}) {
  await assertWriterLease({
    directory,
    name,
    lease,
    nowMs,
    requireDirectorySync,
  });
  return loadAtomicWorldSnapshot({
    directory,
    name,
    requireDirectorySync,
    candidatePolicy: writerLeaseCandidatePolicy(lease.fencingToken),
  });
}
