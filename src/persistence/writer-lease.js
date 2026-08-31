import { randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  readdir,
} from 'node:fs/promises';
import path from 'node:path';

import {
  AtomicSnapshotError,
  sha256,
} from './atomic-types.js';
import { syncDirectory } from './fs-durability.js';
import { recoverAtomicWorldSnapshot } from './recovery.js';

export const WRITER_LEASE_SCHEMAS = Object.freeze({
  claim: 'axm.echoworld.writer-lease-claim/v0.01',
  activation: 'axm.echoworld.writer-lease-activation/v0.01',
  heartbeat: 'axm.echoworld.writer-lease-heartbeat/v0.01',
  base: 'axm.echoworld.writer-lease-base/v0.01',
  release: 'axm.echoworld.writer-lease-release/v0.01',
  handle: 'axm.echoworld.writer-lease-handle/v0.01',
  inspection: 'axm.echoworld.writer-lease-inspection/v0.01',
});

export const WRITER_LEASE_STAGES = Object.freeze([
  'AFTER_CLAIM_FSYNC',
  'AFTER_ACTIVATION_FSYNC',
  'AFTER_BASE_RECORD_FSYNC',
  'AFTER_HEARTBEAT_FSYNC',
  'AFTER_RELEASE_FSYNC',
]);

const DEFAULTS = Object.freeze({
  leaseDurationMs: 30_000,
  provisionalDurationMs: 5_000,
});

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

function sealRecord(record) {
  return {
    ...record,
    recordHash: sha256(JSON.stringify(stable(record))),
  };
}

function validateRecord(record, schema) {
  if (!record || record.schema !== schema || typeof record.recordHash !== 'string') {
    return { valid: false, reason: 'SCHEMA_OR_HASH_MISSING' };
  }
  const { recordHash, ...identity } = record;
  if (sha256(JSON.stringify(stable(identity))) !== recordHash) {
    return { valid: false, reason: 'RECORD_HASH_MISMATCH' };
  }
  return { valid: true, reason: null };
}

function tokenPart(token) {
  return String(token).padStart(20, '0');
}

function sequencePart(sequence) {
  return String(sequence).padStart(10, '0');
}

export function writerLeasePaths(directory, name = 'world') {
  const root = path.join(directory, `${name}.writer-lease`);
  return {
    root,
    claimsDir: path.join(root, 'claims'),
    activationsDir: path.join(root, 'activations'),
    heartbeatsDir: path.join(root, 'heartbeats'),
    basesDir: path.join(root, 'bases'),
    releasesDir: path.join(root, 'releases'),
  };
}

export function writerLeaseRecordPaths(directory, name, fencingToken) {
  const paths = writerLeasePaths(directory, name);
  const token = tokenPart(fencingToken);
  return {
    claim: path.join(paths.claimsDir, `claim-${token}.json`),
    activation: path.join(paths.activationsDir, `activation-${token}.json`),
    base: path.join(paths.basesDir, `base-${token}.json`),
    release: path.join(paths.releasesDir, `release-${token}.json`),
    heartbeatPrefix: `heartbeat-${token}-`,
  };
}

async function ensureStore(directory, name, { requireDirectorySync = true } = {}) {
  const paths = writerLeasePaths(directory, name);
  await mkdir(paths.root, { recursive: true });
  for (const directoryPath of [
    paths.claimsDir,
    paths.activationsDir,
    paths.heartbeatsDir,
    paths.basesDir,
    paths.releasesDir,
  ]) {
    await mkdir(directoryPath, { recursive: true });
  }
  await syncDirectory(paths.root, { requireDirectorySync });
  return paths;
}

async function invokeLeaseStage(onStage, stage, context) {
  if (!WRITER_LEASE_STAGES.includes(stage)) {
    throw new AtomicSnapshotError('UNKNOWN_WRITER_LEASE_STAGE', `Unknown writer lease stage: ${stage}`);
  }
  if (onStage) await onStage(stage, context);
}

async function writeExclusiveRecord(filePath, record, { requireDirectorySync = true } = {}) {
  const sealed = sealRecord(record);
  const handle = await open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(sealed, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close().catch(() => {});
  }
  await syncDirectory(path.dirname(filePath), { requireDirectorySync });
  return sealed;
}

async function readRecord(filePath, schema) {
  try {
    const text = await readFile(filePath, 'utf8');
    const record = JSON.parse(text);
    return { exists: true, record, ...validateRecord(record, schema) };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { exists: false, record: null, valid: false, reason: 'FILE_MISSING' };
    }
    return {
      exists: true,
      record: null,
      valid: false,
      reason: error instanceof SyntaxError ? 'JSON_PARSE_FAILED' : 'FILE_READ_FAILED',
      details: { code: error?.code ?? null, message: error.message },
    };
  }
}

async function fileNames(directoryPath) {
  try {
    return await readdir(directoryPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function parseToken(name, prefix) {
  const match = name.match(new RegExp(`^${prefix}-(\\d{20})\\.json$`));
  return match ? Number(match[1]) : null;
}

function parseHeartbeat(name) {
  const match = name.match(/^heartbeat-(\d{20})-(\d{10})\.json$/);
  return match ? { fencingToken: Number(match[1]), sequence: Number(match[2]) } : null;
}

async function loadRecords(directoryPath, schema, parser) {
  const names = await fileNames(directoryPath);
  const results = [];
  for (const name of names.sort()) {
    const parsed = parser(name);
    if (!parsed) continue;
    const result = await readRecord(path.join(directoryPath, name), schema);
    results.push({ name, parsed, ...result });
  }
  return results;
}

function leaseIdFor({ writerId, fencingToken, claimedAtMs }) {
  return `WL_${sha256(`${writerId}|${fencingToken}|${claimedAtMs}`).slice(0, 24)}`;
}

function candidateSummary(candidate, nowMs) {
  return {
    fencingToken: candidate.fencingToken,
    writerId: candidate.writerId,
    leaseId: candidate.leaseId,
    activated: candidate.activated,
    released: candidate.released,
    provisionalExpiresAtMs: candidate.provisionalExpiresAtMs,
    effectiveExpiresAtMs: candidate.effectiveExpiresAtMs,
    active: candidate.activated && !candidate.released && candidate.effectiveExpiresAtMs > nowMs,
    provisional: !candidate.activated && !candidate.released && candidate.provisionalExpiresAtMs > nowMs,
    heartbeatSequence: candidate.heartbeatSequence,
    baseGeneration: candidate.base?.baseGeneration ?? null,
    baseSnapshotId: candidate.base?.baseSnapshotId ?? null,
  };
}

export async function inspectWriterLeaseStore({
  directory,
  name = 'world',
  nowMs = Date.now(),
  requireDirectorySync = true,
} = {}) {
  if (!Number.isFinite(nowMs)) {
    throw new AtomicSnapshotError('INVALID_LEASE_CLOCK', 'nowMs must be finite.');
  }
  const paths = await ensureStore(directory, name, { requireDirectorySync });
  const [claims, activations, heartbeats, bases, releases] = await Promise.all([
    loadRecords(paths.claimsDir, WRITER_LEASE_SCHEMAS.claim, (value) => {
      const token = parseToken(value, 'claim');
      return token === null ? null : { fencingToken: token };
    }),
    loadRecords(paths.activationsDir, WRITER_LEASE_SCHEMAS.activation, (value) => {
      const token = parseToken(value, 'activation');
      return token === null ? null : { fencingToken: token };
    }),
    loadRecords(paths.heartbeatsDir, WRITER_LEASE_SCHEMAS.heartbeat, parseHeartbeat),
    loadRecords(paths.basesDir, WRITER_LEASE_SCHEMAS.base, (value) => {
      const token = parseToken(value, 'base');
      return token === null ? null : { fencingToken: token };
    }),
    loadRecords(paths.releasesDir, WRITER_LEASE_SCHEMAS.release, (value) => {
      const token = parseToken(value, 'release');
      return token === null ? null : { fencingToken: token };
    }),
  ]);

  const candidates = [];
  for (const claimFile of claims) {
    if (!claimFile.valid) continue;
    const claim = claimFile.record;
    const activationFile = activations.find(
      (item) => item.valid && item.parsed.fencingToken === claim.fencingToken,
    );
    const matchingHeartbeats = heartbeats
      .filter(
        (item) => (
          item.valid
          && item.parsed.fencingToken === claim.fencingToken
          && item.record.leaseId === claim.leaseId
          && item.record.writerId === claim.writerId
        ),
      )
      .sort((a, b) => b.parsed.sequence - a.parsed.sequence);
    const latestHeartbeat = matchingHeartbeats[0]?.record ?? null;
    const baseFile = bases.find(
      (item) => (
        item.valid
        && item.parsed.fencingToken === claim.fencingToken
        && item.record.leaseId === claim.leaseId
      ),
    );
    const releaseFile = releases.find(
      (item) => (
        item.valid
        && item.parsed.fencingToken === claim.fencingToken
        && item.record.leaseId === claim.leaseId
      ),
    );
    const activation = activationFile?.record ?? null;
    const effectiveExpiresAtMs = latestHeartbeat?.expiresAtMs ?? activation?.expiresAtMs ?? null;
    candidates.push({
      fencingToken: claim.fencingToken,
      writerId: claim.writerId,
      leaseId: claim.leaseId,
      claimedAtMs: claim.claimedAtMs,
      provisionalExpiresAtMs: claim.provisionalExpiresAtMs,
      activated: Boolean(activation),
      activation,
      heartbeatSequence: latestHeartbeat?.sequence ?? 0,
      latestHeartbeat,
      effectiveExpiresAtMs: effectiveExpiresAtMs ?? Number.NEGATIVE_INFINITY,
      released: Boolean(releaseFile),
      release: releaseFile?.record ?? null,
      base: baseFile?.record ?? null,
    });
  }

  const activeCandidates = candidates
    .filter(
      (candidate) => (
        candidate.activated
        && !candidate.released
        && candidate.effectiveExpiresAtMs > nowMs
      ),
    )
    .sort((a, b) => b.fencingToken - a.fencingToken);
  const active = activeCandidates[0] ?? null;

  const provisionalCandidates = candidates
    .filter(
      (candidate) => (
        !candidate.activated
        && !candidate.released
        && candidate.provisionalExpiresAtMs > nowMs
      ),
    )
    .sort((a, b) => a.fencingToken - b.fencingToken);

  const parsedTokens = claims.map((item) => item.parsed.fencingToken);
  const invalidRecords = [...claims, ...activations, ...heartbeats, ...bases, ...releases]
    .filter((item) => item.exists && !item.valid)
    .map((item) => ({ name: item.name, reason: item.reason, parsed: item.parsed }));

  return {
    schema: WRITER_LEASE_SCHEMAS.inspection,
    directory,
    name,
    nowMs,
    paths,
    highestAllocatedToken: parsedTokens.length > 0 ? Math.max(...parsedTokens) : 0,
    active: active ? candidateSummary(active, nowMs) : null,
    candidates: candidates
      .sort((a, b) => a.fencingToken - b.fencingToken)
      .map((candidate) => candidateSummary(candidate, nowMs)),
    provisionalCandidates: provisionalCandidates.map((candidate) => candidateSummary(candidate, nowMs)),
    invalidRecords,
  };
}

async function allocateClaim({
  directory,
  name,
  writerId,
  nowMs,
  provisionalDurationMs,
  requireDirectorySync,
}) {
  const paths = await ensureStore(directory, name, { requireDirectorySync });
  for (;;) {
    const names = await fileNames(paths.claimsDir);
    const tokens = names.map((value) => parseToken(value, 'claim')).filter((value) => value !== null);
    const fencingToken = (tokens.length > 0 ? Math.max(...tokens) : 0) + 1;
    const leaseId = leaseIdFor({ writerId, fencingToken, claimedAtMs: nowMs });
    const claim = {
      schema: WRITER_LEASE_SCHEMAS.claim,
      fencingToken,
      writerId,
      leaseId,
      claimedAtMs: nowMs,
      provisionalExpiresAtMs: nowMs + provisionalDurationMs,
    };
    const filePath = writerLeaseRecordPaths(directory, name, fencingToken).claim;
    try {
      const record = await writeExclusiveRecord(filePath, claim, { requireDirectorySync });
      return record;
    } catch (error) {
      if (error?.code === 'EEXIST') continue;
      throw error;
    }
  }
}

async function writeReleaseRecord({
  directory,
  name,
  lease,
  nowMs,
  reason,
  requireDirectorySync,
}) {
  const filePath = writerLeaseRecordPaths(directory, name, lease.fencingToken).release;
  const record = {
    schema: WRITER_LEASE_SCHEMAS.release,
    fencingToken: lease.fencingToken,
    writerId: lease.writerId,
    leaseId: lease.leaseId,
    releasedAtMs: nowMs,
    reason,
  };
  try {
    return await writeExclusiveRecord(filePath, record, { requireDirectorySync });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    return (await readRecord(filePath, WRITER_LEASE_SCHEMAS.release)).record;
  }
}

function leaseHandle(candidate, base, leaseDurationMs) {
  return {
    schema: WRITER_LEASE_SCHEMAS.handle,
    writerId: candidate.writerId,
    leaseId: candidate.leaseId,
    fencingToken: candidate.fencingToken,
    leaseDurationMs,
    acquiredAtMs: candidate.activation.activatedAtMs,
    expiresAtMs: candidate.effectiveExpiresAtMs,
    baseGeneration: base.generation,
    baseSnapshotId: base.snapshotId,
    baseCanonicalHash: base.canonicalHash,
  };
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

export async function acquireWriterLease({
  directory,
  name = 'world',
  writerId = randomUUID(),
  leaseDurationMs = DEFAULTS.leaseDurationMs,
  provisionalDurationMs = DEFAULTS.provisionalDurationMs,
  nowMs = Date.now(),
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

  const preflight = await inspectWriterLeaseStore({
    directory,
    name,
    nowMs,
    requireDirectorySync,
  });
  if (preflight.active) {
    throw new AtomicSnapshotError('WRITER_LEASE_HELD', 'Another writer lease is active.', {
      active: preflight.active,
    });
  }

  const claim = await allocateClaim({
    directory,
    name,
    writerId,
    nowMs,
    provisionalDurationMs,
    requireDirectorySync,
  });
  await invokeLeaseStage(onStage, 'AFTER_CLAIM_FSYNC', { claim });

  const election = await inspectWriterLeaseStore({
    directory,
    name,
    nowMs,
    requireDirectorySync,
  });
  const lowestContender = election.candidates
    .filter((candidate) => candidate.active || candidate.provisional)
    .sort((a, b) => a.fencingToken - b.fencingToken)[0];
  if (!lowestContender || lowestContender.fencingToken !== claim.fencingToken) {
    await writeReleaseRecord({
      directory,
      name,
      lease: claim,
      nowMs,
      reason: 'LEASE_CONTENDED',
      requireDirectorySync,
    });
    throw new AtomicSnapshotError('WRITER_LEASE_CONTENDED', 'A lower fencing claim won acquisition.', {
      claim,
      lowestContender,
    });
  }

  const activationPath = writerLeaseRecordPaths(directory, name, claim.fencingToken).activation;
  const activation = await writeExclusiveRecord(activationPath, {
    schema: WRITER_LEASE_SCHEMAS.activation,
    fencingToken: claim.fencingToken,
    writerId: claim.writerId,
    leaseId: claim.leaseId,
    activatedAtMs: nowMs,
    leaseDurationMs,
    expiresAtMs: nowMs + leaseDurationMs,
  }, { requireDirectorySync });
  await invokeLeaseStage(onStage, 'AFTER_ACTIVATION_FSYNC', { claim, activation });

  const activated = await inspectWriterLeaseStore({
    directory,
    name,
    nowMs,
    requireDirectorySync,
  });
  if (
    !activated.active
    || activated.active.fencingToken !== claim.fencingToken
    || activated.active.leaseId !== claim.leaseId
  ) {
    await writeReleaseRecord({
      directory,
      name,
      lease: claim,
      nowMs,
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
    await writeReleaseRecord({
      directory,
      name,
      lease: claim,
      nowMs,
      reason: 'ACQUIRE_BASE_RECOVERY_FAILED',
      requireDirectorySync,
    });
    throw error;
  }

  const basePath = writerLeaseRecordPaths(directory, name, claim.fencingToken).base;
  const baseRecord = await writeExclusiveRecord(basePath, {
    schema: WRITER_LEASE_SCHEMAS.base,
    fencingToken: claim.fencingToken,
    writerId: claim.writerId,
    leaseId: claim.leaseId,
    recordedAtMs: nowMs,
    baseGeneration: base.generation,
    baseSnapshotId: base.snapshotId,
    baseCanonicalHash: base.canonicalHash,
  }, { requireDirectorySync });
  await invokeLeaseStage(onStage, 'AFTER_BASE_RECORD_FSYNC', {
    claim,
    activation,
    base: baseRecord,
  });

  return leaseHandle(
    {
      ...claim,
      activation,
      effectiveExpiresAtMs: activation.expiresAtMs,
    },
    base,
    leaseDurationMs,
  );
}

function ownCandidate(inspection, lease) {
  return inspection.candidates.find(
    (candidate) => (
      candidate.fencingToken === lease.fencingToken
      && candidate.leaseId === lease.leaseId
      && candidate.writerId === lease.writerId
    ),
  );
}

export async function assertWriterLease({
  directory,
  name = 'world',
  lease,
  nowMs = Date.now(),
  minimumRemainingMs = 0,
  requireDirectorySync = true,
} = {}) {
  if (!lease || lease.schema !== WRITER_LEASE_SCHEMAS.handle) {
    throw new AtomicSnapshotError('INVALID_WRITER_LEASE_HANDLE', 'A valid writer lease handle is required.');
  }
  const inspection = await inspectWriterLeaseStore({
    directory,
    name,
    nowMs,
    requireDirectorySync,
  });
  const own = ownCandidate(inspection, lease);

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
    const expired = own && own.effectiveExpiresAtMs <= nowMs;
    throw new AtomicSnapshotError(
      expired ? 'WRITER_LEASE_EXPIRED' : 'WRITER_LEASE_NOT_ACTIVE',
      expired ? 'The writer lease has expired.' : 'The writer lease is not active.',
      { lease, own, active: inspection.active },
    );
  }

  const remainingMs = own.effectiveExpiresAtMs - nowMs;
  if (remainingMs < minimumRemainingMs) {
    throw new AtomicSnapshotError(
      'WRITER_LEASE_INSUFFICIENT_REMAINING_TIME',
      'The writer lease does not have enough remaining time for checkpoint admission.',
      { remainingMs, minimumRemainingMs, lease },
    );
  }

  return {
    schema: 'axm.echoworld.writer-lease-assertion/v0.01',
    status: 'CURRENT_OWNER',
    writerId: lease.writerId,
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken,
    nowMs,
    expiresAtMs: own.effectiveExpiresAtMs,
    remainingMs,
  };
}

export async function renewWriterLease({
  directory,
  name = 'world',
  lease,
  nowMs = Date.now(),
  leaseDurationMs = lease?.leaseDurationMs ?? DEFAULTS.leaseDurationMs,
  onStage = null,
  requireDirectorySync = true,
} = {}) {
  await assertWriterLease({
    directory,
    name,
    lease,
    nowMs,
    requireDirectorySync,
  });
  if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 1) {
    throw new AtomicSnapshotError('INVALID_LEASE_DURATION', 'leaseDurationMs must be positive.');
  }

  const paths = await ensureStore(directory, name, { requireDirectorySync });
  for (;;) {
    const names = await fileNames(paths.heartbeatsDir);
    const sequences = names
      .map(parseHeartbeat)
      .filter((item) => item?.fencingToken === lease.fencingToken)
      .map((item) => item.sequence);
    const sequence = (sequences.length > 0 ? Math.max(...sequences) : 0) + 1;
    const filePath = path.join(
      paths.heartbeatsDir,
      `heartbeat-${tokenPart(lease.fencingToken)}-${sequencePart(sequence)}.json`,
    );
    try {
      const heartbeat = await writeExclusiveRecord(filePath, {
        schema: WRITER_LEASE_SCHEMAS.heartbeat,
        fencingToken: lease.fencingToken,
        writerId: lease.writerId,
        leaseId: lease.leaseId,
        sequence,
        heartbeatAtMs: nowMs,
        leaseDurationMs,
        expiresAtMs: nowMs + leaseDurationMs,
      }, { requireDirectorySync });
      await invokeLeaseStage(onStage, 'AFTER_HEARTBEAT_FSYNC', { heartbeat });
      return {
        ...lease,
        leaseDurationMs,
        expiresAtMs: heartbeat.expiresAtMs,
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
  reason = 'RELEASED_BY_OWNER',
  onStage = null,
  requireDirectorySync = true,
} = {}) {
  if (!lease || lease.schema !== WRITER_LEASE_SCHEMAS.handle) {
    throw new AtomicSnapshotError('INVALID_WRITER_LEASE_HANDLE', 'A valid writer lease handle is required.');
  }
  const inspection = await inspectWriterLeaseStore({
    directory,
    name,
    nowMs,
    requireDirectorySync,
  });
  const status = (
    inspection.active
    && inspection.active.fencingToken === lease.fencingToken
    && inspection.active.leaseId === lease.leaseId
  ) ? 'RELEASED' : 'STALE_RELEASE_RECORDED';
  const release = await writeReleaseRecord({
    directory,
    name,
    lease,
    nowMs,
    reason,
    requireDirectorySync,
  });
  await invokeLeaseStage(onStage, 'AFTER_RELEASE_FSYNC', { release, status });
  return {
    schema: 'axm.echoworld.writer-lease-release-receipt/v0.01',
    status,
    writerId: lease.writerId,
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken,
    releasedAtMs: release.releasedAtMs,
    reason: release.reason,
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
