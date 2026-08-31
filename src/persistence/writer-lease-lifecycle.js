import path from 'node:path';

import { AtomicSnapshotError } from './atomic-types.js';
import { archiveLeaseClock } from './lease-clock.js';
import { archiveLeaseLedgerRecords } from './lease-ledger-archive.js';
import {
  WRITER_LEASE_DEFAULTS,
  WRITER_LEASE_SCHEMAS,
  ensureWriterLeaseStore,
  invokeWriterLeaseStage,
  parseWriterLeaseHeartbeat,
  writerLeaseFileNames,
  writerLeaseSequencePart,
  writerLeaseTokenPart,
  writeExclusiveWriterLeaseRecord,
} from './writer-lease-records.js';
import {
  inspectWriterLeaseStore,
  ownWriterLeaseCandidate,
  resolveWriterLeaseTime,
  writeWriterLeaseReleaseRecord,
} from './writer-lease-inspection.js';
import { acquireWriterLease } from './writer-lease-acquire.js';

export async function assertWriterLease({
  directory,
  name = 'world',
  lease,
  nowMs = Date.now(),
  rollbackToleranceMs = WRITER_LEASE_DEFAULTS.rollbackToleranceMs,
  minimumRemainingMs = 0,
  requireDirectorySync = true,
} = {}) {
  if (!lease || lease.schema !== WRITER_LEASE_SCHEMAS.handle) {
    throw new AtomicSnapshotError('INVALID_WRITER_LEASE_HANDLE', 'A valid writer lease handle is required.');
  }
  const time = await resolveWriterLeaseTime({
    directory,
    name,
    nowMs,
    rollbackToleranceMs,
    operation: 'ASSERT_WRITER_LEASE',
    requireDirectorySync,
  });
  const inspection = await inspectWriterLeaseStore({
    directory,
    name,
    nowMs: time.wallTimeMs,
    logicalNowMs: time.logicalMs,
    clockObservationId: time.observationId,
    observeClock: false,
    requireDirectorySync,
  });
  const own = ownWriterLeaseCandidate(inspection, lease);

  if (own?.released) {
    throw new AtomicSnapshotError('WRITER_LEASE_RELEASED', 'The writer lease has been released.', {
      lease,
      own,
    });
  }
  if (
    inspection.active
    && (
      inspection.active.fencingToken !== lease.fencingToken
      || inspection.active.leaseId !== lease.leaseId
    )
  ) {
    throw new AtomicSnapshotError('WRITER_FENCED', 'A different fencing token owns the writer lease.', {
      lease,
      active: inspection.active,
    });
  }
  if (!inspection.active || !own?.active) {
    const expired = own && own.effectiveExpiresAtLogicalMs <= time.logicalMs;
    throw new AtomicSnapshotError(
      expired ? 'WRITER_LEASE_EXPIRED' : 'WRITER_LEASE_NOT_ACTIVE',
      expired ? 'The writer lease has expired.' : 'The writer lease is not active.',
      { lease, own, active: inspection.active, logicalNowMs: time.logicalMs },
    );
  }

  const remainingMs = own.effectiveExpiresAtLogicalMs - time.logicalMs;
  if (remainingMs < minimumRemainingMs) {
    throw new AtomicSnapshotError(
      'WRITER_LEASE_INSUFFICIENT_REMAINING_TIME',
      'The writer lease does not have enough remaining logical time for checkpoint admission.',
      { remainingMs, minimumRemainingMs, lease },
    );
  }

  return {
    schema: 'axm.echoworld.writer-lease-assertion/v0.02',
    status: 'CURRENT_OWNER',
    writerId: lease.writerId,
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken,
    nowMs: time.wallTimeMs,
    logicalNowMs: time.logicalMs,
    clockObservationId: time.observationId,
    expiresAtMs: own.effectiveExpiresAtMs,
    expiresAtLogicalMs: own.effectiveExpiresAtLogicalMs,
    remainingMs,
  };
}

export async function renewWriterLease({
  directory,
  name = 'world',
  lease,
  nowMs = Date.now(),
  rollbackToleranceMs = WRITER_LEASE_DEFAULTS.rollbackToleranceMs,
  leaseDurationMs = lease?.leaseDurationMs ?? WRITER_LEASE_DEFAULTS.leaseDurationMs,
  onStage = null,
  requireDirectorySync = true,
} = {}) {
  const assertion = await assertWriterLease({
    directory,
    name,
    lease,
    nowMs,
    rollbackToleranceMs,
    requireDirectorySync,
  });
  if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 1) {
    throw new AtomicSnapshotError('INVALID_LEASE_DURATION', 'leaseDurationMs must be positive.');
  }

  const paths = await ensureWriterLeaseStore(directory, name, { requireDirectorySync });
  for (;;) {
    const names = await writerLeaseFileNames(paths.heartbeatsDir);
    const sequences = names
      .map(parseWriterLeaseHeartbeat)
      .filter((item) => item?.fencingToken === lease.fencingToken)
      .map((item) => item.sequence);
    const sequence = (sequences.length > 0 ? Math.max(...sequences) : 0) + 1;
    const filePath = path.join(
      paths.heartbeatsDir,
      `heartbeat-${writerLeaseTokenPart(lease.fencingToken)}-${writerLeaseSequencePart(sequence)}.json`,
    );
    try {
      const heartbeat = await writeExclusiveWriterLeaseRecord(filePath, {
        schema: WRITER_LEASE_SCHEMAS.heartbeat,
        fencingToken: lease.fencingToken,
        writerId: lease.writerId,
        leaseId: lease.leaseId,
        sequence,
        heartbeatAtMs: assertion.nowMs,
        heartbeatAtLogicalMs: assertion.logicalNowMs,
        leaseDurationMs,
        expiresAtMs: assertion.logicalNowMs + leaseDurationMs,
        expiresAtLogicalMs: assertion.logicalNowMs + leaseDurationMs,
        clockObservationId: assertion.clockObservationId,
      }, { requireDirectorySync });
      await invokeWriterLeaseStage(onStage, 'AFTER_HEARTBEAT_FSYNC', { heartbeat });
      return {
        ...lease,
        leaseDurationMs,
        expiresAtMs: heartbeat.expiresAtMs,
        expiresAtLogicalMs: heartbeat.expiresAtLogicalMs,
        clockObservationId: heartbeat.clockObservationId,
      };
    } catch (error) {
      if (error?.code === 'EEXIST') continue;
      throw error;
    }
  }
}

export async function releaseWriterLease({
  directory,
  name = 'world',
  lease,
  nowMs = Date.now(),
  rollbackToleranceMs = WRITER_LEASE_DEFAULTS.rollbackToleranceMs,
  reason = 'RELEASED_BY_OWNER',
  onStage = null,
  requireDirectorySync = true,
} = {}) {
  if (!lease || lease.schema !== WRITER_LEASE_SCHEMAS.handle) {
    throw new AtomicSnapshotError('INVALID_WRITER_LEASE_HANDLE', 'A valid writer lease handle is required.');
  }
  const time = await resolveWriterLeaseTime({
    directory,
    name,
    nowMs,
    rollbackToleranceMs,
    operation: 'RELEASE_WRITER_LEASE',
    requireDirectorySync,
  });
  const inspection = await inspectWriterLeaseStore({
    directory,
    name,
    nowMs: time.wallTimeMs,
    logicalNowMs: time.logicalMs,
    clockObservationId: time.observationId,
    observeClock: false,
    requireDirectorySync,
  });
  const status = (
    inspection.active
    && inspection.active.fencingToken === lease.fencingToken
    && inspection.active.leaseId === lease.leaseId
  ) ? 'RELEASED' : 'STALE_RELEASE_RECORDED';
  const release = await writeWriterLeaseReleaseRecord({
    directory,
    name,
    lease,
    wallTimeMs: time.wallTimeMs,
    logicalNowMs: time.logicalMs,
    clockObservationId: time.observationId,
    reason,
    requireDirectorySync,
  });
  await invokeWriterLeaseStage(onStage, 'AFTER_RELEASE_FSYNC', { release, status });
  return {
    schema: 'axm.echoworld.writer-lease-release-receipt/v0.02',
    status,
    writerId: lease.writerId,
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken,
    releasedAtMs: release.releasedAtMs,
    releasedAtLogicalMs: release.releasedAtLogicalMs,
    clockObservationId: release.clockObservationId,
    reason: release.reason,
  };
}

export async function archiveWriterLeaseLedger({
  directory,
  name = 'world',
  lease,
  nowMs = Date.now(),
  rollbackToleranceMs = WRITER_LEASE_DEFAULTS.rollbackToleranceMs,
  retainRecentTokens = 4,
  retainRecentClockObservations = 16,
  keepArchiveCheckpoints = 2,
  requireDirectorySync = true,
} = {}) {
  const assertion = await assertWriterLease({
    directory,
    name,
    lease,
    nowMs,
    rollbackToleranceMs,
    requireDirectorySync,
  });
  const ledger = await archiveLeaseLedgerRecords({
    directory,
    name,
    logicalNowMs: assertion.logicalNowMs,
    retainRecentTokens,
    keepArchiveCheckpoints,
    protectedFencingTokens: [lease.fencingToken],
    requireDirectorySync,
  });
  const clock = await archiveLeaseClock({
    directory,
    name,
    retainRecentObservations: retainRecentClockObservations,
    keepArchiveCheckpoints,
    requireDirectorySync,
  });
  return {
    schema: 'axm.echoworld.writer-lease-archive-receipt/v0.01',
    status: ledger.status === 'ARCHIVED' || clock.status === 'ARCHIVED'
      ? 'ARCHIVED'
      : 'NOTHING_TO_ARCHIVE',
    fencingToken: lease.fencingToken,
    logicalNowMs: assertion.logicalNowMs,
    ledger,
    clock,
  };
}

export async function withWriterLease(options, callback) {
  const lease = await acquireWriterLease(options);
  try {
    return await callback(lease);
  } finally {
    await releaseWriterLease({
      ...options,
      lease,
      nowMs: typeof options?.clock === 'function' ? options.clock() : Date.now(),
    }).catch(() => {});
  }
}
