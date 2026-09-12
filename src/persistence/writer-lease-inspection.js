import {
  archiveLeaseClock,
  inspectLeaseClock,
  observeLeaseClock,
} from './lease-clock.js';
import {
  highestLeaseFencingToken,
  readLeaseLedgerArchiveState,
} from './lease-ledger-archive.js';
import {
  WRITER_LEASE_SCHEMAS,
  ensureWriterLeaseStore,
  loadWriterLeaseRecords,
  parseWriterLeaseHeartbeat,
  parseWriterLeaseToken,
  readWriterLeaseRecord,
  writerLeaseExpiryLogical,
  writerLeaseIdFor,
  writerLeaseProvisionalExpiryLogical,
  writerLeaseRecordPaths,
  writeExclusiveWriterLeaseRecord,
} from './writer-lease-records.js';

function candidateSummary(candidate, logicalNowMs) {
  return {
    fencingToken: candidate.fencingToken,
    writerId: candidate.writerId,
    leaseId: candidate.leaseId,
    activated: candidate.activated,
    released: candidate.released,
    provisionalExpiresAtMs: candidate.provisionalExpiresAtMs,
    provisionalExpiresAtLogicalMs: candidate.provisionalExpiresAtLogicalMs,
    effectiveExpiresAtMs: candidate.effectiveExpiresAtMs,
    effectiveExpiresAtLogicalMs: candidate.effectiveExpiresAtLogicalMs,
    active: candidate.activated
      && !candidate.released
      && candidate.effectiveExpiresAtLogicalMs > logicalNowMs,
    provisional: !candidate.activated
      && !candidate.released
      && candidate.provisionalExpiresAtLogicalMs > logicalNowMs,
    heartbeatSequence: candidate.heartbeatSequence,
    baseGeneration: candidate.base?.baseGeneration ?? null,
    baseSnapshotId: candidate.base?.baseSnapshotId ?? null,
    clockObservationId: candidate.clockObservationId ?? null,
  };
}

export async function resolveWriterLeaseTime({
  directory,
  name,
  nowMs,
  logicalNowMs,
  clockObservationId,
  rollbackToleranceMs,
  operation,
  requireDirectorySync,
}) {
  if (Number.isFinite(logicalNowMs) && typeof clockObservationId === 'string') {
    return {
      wallTimeMs: nowMs,
      logicalMs: logicalNowMs,
      observationId: clockObservationId,
    };
  }
  const observation = await observeLeaseClock({
    directory,
    name,
    wallTimeMs: nowMs,
    rollbackToleranceMs,
    operation,
    requireDirectorySync,
  });
  return {
    wallTimeMs: observation.wallTimeMs,
    logicalMs: observation.logicalMs,
    observationId: observation.observationId,
  };
}

export async function inspectWriterLeaseStore({
  directory,
  name = 'world',
  nowMs = Date.now(),
  logicalNowMs = undefined,
  clockObservationId = undefined,
  rollbackToleranceMs = 0,
  observeClock = true,
  requireDirectorySync = true,
} = {}) {
  let time;
  if (observeClock) {
    time = await resolveWriterLeaseTime({
      directory,
      name,
      nowMs,
      logicalNowMs,
      clockObservationId,
      rollbackToleranceMs,
      operation: 'INSPECT_WRITER_LEASE',
      requireDirectorySync,
    });
  } else {
    time = {
      wallTimeMs: nowMs,
      logicalMs: logicalNowMs,
      observationId: clockObservationId ?? null,
    };
  }

  const paths = await ensureWriterLeaseStore(directory, name, { requireDirectorySync });
  const [claims, activations, heartbeats, bases, releases, archiveState, clockState] = await Promise.all([
    loadWriterLeaseRecords(paths.claimsDir, WRITER_LEASE_SCHEMAS.claim, (value) => {
      const token = parseWriterLeaseToken(value, 'claim');
      return token === null ? null : { fencingToken: token };
    }),
    loadWriterLeaseRecords(paths.activationsDir, WRITER_LEASE_SCHEMAS.activation, (value) => {
      const token = parseWriterLeaseToken(value, 'activation');
      return token === null ? null : { fencingToken: token };
    }),
    loadWriterLeaseRecords(paths.heartbeatsDir, WRITER_LEASE_SCHEMAS.heartbeat, parseWriterLeaseHeartbeat),
    loadWriterLeaseRecords(paths.basesDir, WRITER_LEASE_SCHEMAS.base, (value) => {
      const token = parseWriterLeaseToken(value, 'base');
      return token === null ? null : { fencingToken: token };
    }),
    loadWriterLeaseRecords(paths.releasesDir, WRITER_LEASE_SCHEMAS.release, (value) => {
      const token = parseWriterLeaseToken(value, 'release');
      return token === null ? null : { fencingToken: token };
    }),
    readLeaseLedgerArchiveState({ directory, name, requireDirectorySync }),
    inspectLeaseClock({ directory, name, requireDirectorySync }),
  ]);

  const candidates = [];
  for (const claimFile of claims) {
    if (!claimFile.valid) continue;
    const claim = claimFile.record;
    const activationFile = activations.find(
      (item) => item.valid && item.parsed.fencingToken === claim.fencingToken,
    );
    const matchingHeartbeats = heartbeats
      .filter((item) => (
        item.valid
        && item.parsed.fencingToken === claim.fencingToken
        && item.record.leaseId === claim.leaseId
        && item.record.writerId === claim.writerId
      ))
      .sort((a, b) => b.parsed.sequence - a.parsed.sequence);
    const latestHeartbeat = matchingHeartbeats[0]?.record ?? null;
    const baseFile = bases.find((item) => (
      item.valid
      && item.parsed.fencingToken === claim.fencingToken
      && item.record.leaseId === claim.leaseId
    ));
    const releaseFile = releases.find((item) => (
      item.valid
      && item.parsed.fencingToken === claim.fencingToken
      && item.record.leaseId === claim.leaseId
    ));
    const activation = activationFile?.record ?? null;
    const expiryRecord = latestHeartbeat ?? activation;
    candidates.push({
      fencingToken: claim.fencingToken,
      writerId: claim.writerId,
      leaseId: claim.leaseId,
      claimedAtMs: claim.claimedAtMs,
      claimedAtLogicalMs: claim.claimedAtLogicalMs ?? claim.claimedAtMs,
      provisionalExpiresAtMs: claim.provisionalExpiresAtMs,
      provisionalExpiresAtLogicalMs: writerLeaseProvisionalExpiryLogical(claim),
      activated: Boolean(activation),
      activation,
      heartbeatSequence: latestHeartbeat?.sequence ?? 0,
      latestHeartbeat,
      effectiveExpiresAtMs: expiryRecord?.expiresAtMs ?? null,
      effectiveExpiresAtLogicalMs: writerLeaseExpiryLogical(expiryRecord),
      released: Boolean(releaseFile),
      release: releaseFile?.record ?? null,
      base: baseFile?.record ?? null,
      clockObservationId: latestHeartbeat?.clockObservationId
        ?? activation?.clockObservationId
        ?? claim.clockObservationId
        ?? null,
    });
  }

  const activeCandidates = candidates
    .filter((candidate) => (
      candidate.activated
      && !candidate.released
      && candidate.effectiveExpiresAtLogicalMs > time.logicalMs
    ))
    .sort((a, b) => b.fencingToken - a.fencingToken);
  const active = activeCandidates[0] ?? null;
  const provisionalCandidates = candidates
    .filter((candidate) => (
      !candidate.activated
      && !candidate.released
      && candidate.provisionalExpiresAtLogicalMs > time.logicalMs
    ))
    .sort((a, b) => a.fencingToken - b.fencingToken);

  const rawTokens = claims.map((item) => item.parsed.fencingToken);
  const invalidRecords = [...claims, ...activations, ...heartbeats, ...bases, ...releases]
    .filter((item) => item.exists && !item.valid)
    .map((item) => ({ name: item.name, reason: item.reason, parsed: item.parsed }));

  return {
    schema: WRITER_LEASE_SCHEMAS.inspection,
    directory,
    name,
    nowMs: time.wallTimeMs,
    logicalNowMs: time.logicalMs,
    clockObservationId: time.observationId,
    paths,
    archive: archiveState.archive,
    leaseClock: {
      latestSequence: clockState.latestSequence,
      latestObservationId: clockState.latestObservationId,
      latestWallTimeMs: clockState.latestWallTimeMs,
      latestLogicalMs: clockState.latestLogicalMs,
      rawObservationCount: clockState.rawObservationCount,
      archive: clockState.archive,
    },
    highestAllocatedToken: Math.max(
      archiveState.highestAllocatedToken,
      rawTokens.at(-1) ?? 0,
    ),
    active: active ? candidateSummary(active, time.logicalMs) : null,
    candidates: candidates
      .sort((a, b) => a.fencingToken - b.fencingToken)
      .map((candidate) => candidateSummary(candidate, time.logicalMs)),
    provisionalCandidates: provisionalCandidates.map(
      (candidate) => candidateSummary(candidate, time.logicalMs),
    ),
    invalidRecords,
  };
}

export async function allocateWriterLeaseClaim({
  directory,
  name,
  writerId,
  wallTimeMs,
  logicalNowMs,
  clockObservationId,
  provisionalDurationMs,
  requireDirectorySync,
}) {
  await ensureWriterLeaseStore(directory, name, { requireDirectorySync });
  for (;;) {
    const fencingToken = (await highestLeaseFencingToken({
      directory,
      name,
      requireDirectorySync,
    })) + 1;
    const leaseId = writerLeaseIdFor({ writerId, fencingToken, claimedAtLogicalMs: logicalNowMs });
    const claim = {
      schema: WRITER_LEASE_SCHEMAS.claim,
      fencingToken,
      writerId,
      leaseId,
      claimedAtMs: wallTimeMs,
      claimedAtLogicalMs: logicalNowMs,
      provisionalExpiresAtMs: logicalNowMs + provisionalDurationMs,
      provisionalExpiresAtLogicalMs: logicalNowMs + provisionalDurationMs,
      clockObservationId,
    };
    const filePath = writerLeaseRecordPaths(directory, name, fencingToken).claim;
    try {
      return await writeExclusiveWriterLeaseRecord(filePath, claim, { requireDirectorySync });
    } catch (error) {
      if (error?.code === 'EEXIST') continue;
      throw error;
    }
  }
}

export async function writeWriterLeaseReleaseRecord({
  directory,
  name,
  lease,
  wallTimeMs,
  logicalNowMs,
  clockObservationId,
  reason,
  requireDirectorySync,
}) {
  const filePath = writerLeaseRecordPaths(directory, name, lease.fencingToken).release;
  const record = {
    schema: WRITER_LEASE_SCHEMAS.release,
    fencingToken: lease.fencingToken,
    writerId: lease.writerId,
    leaseId: lease.leaseId,
    releasedAtMs: wallTimeMs,
    releasedAtLogicalMs: logicalNowMs,
    clockObservationId,
    reason,
  };
  try {
    return await writeExclusiveWriterLeaseRecord(filePath, record, { requireDirectorySync });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    return (await readWriterLeaseRecord(filePath, WRITER_LEASE_SCHEMAS.release)).record;
  }
}

export function createWriterLeaseHandle(candidate, base, leaseDurationMs) {
  return {
    schema: WRITER_LEASE_SCHEMAS.handle,
    writerId: candidate.writerId,
    leaseId: candidate.leaseId,
    fencingToken: candidate.fencingToken,
    leaseDurationMs,
    acquiredAtMs: candidate.activation.activatedAtMs,
    acquiredAtLogicalMs: candidate.activation.activatedAtLogicalMs,
    expiresAtMs: candidate.effectiveExpiresAtMs,
    expiresAtLogicalMs: candidate.effectiveExpiresAtLogicalMs,
    clockObservationId: candidate.clockObservationId,
    baseGeneration: base.generation,
    baseSnapshotId: base.snapshotId,
    baseCanonicalHash: base.canonicalHash,
  };
}

export function ownWriterLeaseCandidate(inspection, lease) {
  return inspection.candidates.find((candidate) => (
    candidate.fencingToken === lease.fencingToken
    && candidate.leaseId === lease.leaseId
    && candidate.writerId === lease.writerId
  ));
}

export function writerLeaseCandidatePolicy(fencingToken) {
  return (candidate) => {
    const checkpointToken = candidate.envelope?.checkpoint?.fencingToken;
    if (
      ['temp', 'recoveryTemp'].includes(candidate.role)
      && Number.isInteger(checkpointToken)
      && checkpointToken < fencingToken
    ) {
      return {
        eligible: false,
        reason: 'FENCED_UNCOMMITTED_CANDIDATE',
        details: { checkpointToken, currentFencingToken: fencingToken },
      };
    }
    return { eligible: true, reason: null, details: {} };
  };
}

export { archiveLeaseClock };
