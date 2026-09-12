import { randomUUID } from 'node:crypto';

import { AtomicSnapshotError } from './atomic-types.js';
import { recoverAtomicWorldSnapshot } from './recovery.js';
import {
  WRITER_LEASE_DEFAULTS,
  WRITER_LEASE_SCHEMAS,
  invokeWriterLeaseStage,
  writerLeaseRecordPaths,
  writeExclusiveWriterLeaseRecord,
} from './writer-lease-records.js';
import {
  allocateWriterLeaseClaim,
  createWriterLeaseHandle,
  inspectWriterLeaseStore,
  resolveWriterLeaseTime,
  writeWriterLeaseReleaseRecord,
  writerLeaseCandidatePolicy,
} from './writer-lease-inspection.js';

export async function acquireWriterLease({
  directory,
  name = 'world',
  writerId = randomUUID(),
  leaseDurationMs = WRITER_LEASE_DEFAULTS.leaseDurationMs,
  provisionalDurationMs = WRITER_LEASE_DEFAULTS.provisionalDurationMs,
  nowMs = Date.now(),
  rollbackToleranceMs = WRITER_LEASE_DEFAULTS.rollbackToleranceMs,
  onStage = null,
  requireDirectorySync = true,
} = {}) {
  if (typeof writerId !== 'string' || writerId.length === 0) {
    throw new AtomicSnapshotError('INVALID_WRITER_ID', 'writerId must be a non-empty string.');
  }
  for (const [value, label] of [
    [leaseDurationMs, 'leaseDurationMs'],
    [provisionalDurationMs, 'provisionalDurationMs'],
  ]) {
    if (!Number.isInteger(value) || value < 1) {
      throw new AtomicSnapshotError('INVALID_LEASE_DURATION', `${label} must be a positive integer.`);
    }
  }

  const time = await resolveWriterLeaseTime({
    directory,
    name,
    nowMs,
    rollbackToleranceMs,
    operation: 'ACQUIRE_WRITER_LEASE',
    requireDirectorySync,
  });
  const preflight = await inspectWriterLeaseStore({
    directory,
    name,
    nowMs: time.wallTimeMs,
    logicalNowMs: time.logicalMs,
    clockObservationId: time.observationId,
    observeClock: false,
    requireDirectorySync,
  });
  if (preflight.active) {
    throw new AtomicSnapshotError('WRITER_LEASE_HELD', 'Another writer lease is active.', {
      active: preflight.active,
    });
  }

  const claim = await allocateWriterLeaseClaim({
    directory,
    name,
    writerId,
    wallTimeMs: time.wallTimeMs,
    logicalNowMs: time.logicalMs,
    clockObservationId: time.observationId,
    provisionalDurationMs,
    requireDirectorySync,
  });
  await invokeWriterLeaseStage(onStage, 'AFTER_CLAIM_FSYNC', { claim });

  const election = await inspectWriterLeaseStore({
    directory,
    name,
    nowMs: time.wallTimeMs,
    logicalNowMs: time.logicalMs,
    clockObservationId: time.observationId,
    observeClock: false,
    requireDirectorySync,
  });
  const lowestContender = election.candidates
    .filter((candidate) => candidate.active || candidate.provisional)
    .sort((a, b) => a.fencingToken - b.fencingToken)[0];
  if (!lowestContender || lowestContender.fencingToken !== claim.fencingToken) {
    await writeWriterLeaseReleaseRecord({
      directory,
      name,
      lease: claim,
      wallTimeMs: time.wallTimeMs,
      logicalNowMs: time.logicalMs,
      clockObservationId: time.observationId,
      reason: 'LEASE_CONTENDED',
      requireDirectorySync,
    });
    throw new AtomicSnapshotError('WRITER_LEASE_CONTENDED', 'A lower fencing claim won acquisition.', {
      claim,
      lowestContender,
    });
  }

  const activationPath = writerLeaseRecordPaths(directory, name, claim.fencingToken).activation;
  const activation = await writeExclusiveWriterLeaseRecord(activationPath, {
    schema: WRITER_LEASE_SCHEMAS.activation,
    fencingToken: claim.fencingToken,
    writerId: claim.writerId,
    leaseId: claim.leaseId,
    activatedAtMs: time.wallTimeMs,
    activatedAtLogicalMs: time.logicalMs,
    leaseDurationMs,
    expiresAtMs: time.logicalMs + leaseDurationMs,
    expiresAtLogicalMs: time.logicalMs + leaseDurationMs,
    clockObservationId: time.observationId,
  }, { requireDirectorySync });
  await invokeWriterLeaseStage(onStage, 'AFTER_ACTIVATION_FSYNC', { claim, activation });

  const activated = await inspectWriterLeaseStore({
    directory,
    name,
    nowMs: time.wallTimeMs,
    logicalNowMs: time.logicalMs,
    clockObservationId: time.observationId,
    observeClock: false,
    requireDirectorySync,
  });
  if (
    !activated.active
    || activated.active.fencingToken !== claim.fencingToken
    || activated.active.leaseId !== claim.leaseId
  ) {
    await writeWriterLeaseReleaseRecord({
      directory,
      name,
      lease: claim,
      wallTimeMs: time.wallTimeMs,
      logicalNowMs: time.logicalMs,
      clockObservationId: time.observationId,
      reason: 'FENCED_DURING_ACQUIRE',
      requireDirectorySync,
    });
    throw new AtomicSnapshotError('WRITER_FENCED', 'The writer lost lease election during acquisition.', {
      claim,
      active: activated.active,
    });
  }

  let base;
  try {
    base = await recoverAtomicWorldSnapshot({
      directory,
      name,
      allowMissing: true,
      promote: true,
      cleanupTransient: true,
      requireDirectorySync,
      candidatePolicy: writerLeaseCandidatePolicy(claim.fencingToken),
    });
  } catch (error) {
    await writeWriterLeaseReleaseRecord({
      directory,
      name,
      lease: claim,
      wallTimeMs: time.wallTimeMs,
      logicalNowMs: time.logicalMs,
      clockObservationId: time.observationId,
      reason: 'ACQUIRE_BASE_RECOVERY_FAILED',
      requireDirectorySync,
    });
    throw error;
  }

  const basePath = writerLeaseRecordPaths(directory, name, claim.fencingToken).base;
  const baseRecord = await writeExclusiveWriterLeaseRecord(basePath, {
    schema: WRITER_LEASE_SCHEMAS.base,
    fencingToken: claim.fencingToken,
    writerId: claim.writerId,
    leaseId: claim.leaseId,
    recordedAtMs: time.wallTimeMs,
    recordedAtLogicalMs: time.logicalMs,
    clockObservationId: time.observationId,
    baseGeneration: base.generation,
    baseSnapshotId: base.snapshotId,
    baseCanonicalHash: base.canonicalHash,
  }, { requireDirectorySync });
  await invokeWriterLeaseStage(onStage, 'AFTER_BASE_RECORD_FSYNC', {
    claim,
    activation,
    base: baseRecord,
  });

  return createWriterLeaseHandle({
    ...claim,
    activation,
    effectiveExpiresAtMs: activation.expiresAtMs,
    effectiveExpiresAtLogicalMs: activation.expiresAtLogicalMs,
    clockObservationId: time.observationId,
  }, base, leaseDurationMs);
}
