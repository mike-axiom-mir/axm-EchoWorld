import {
  mkdir,
  open,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises';
import path from 'node:path';

import { AtomicSnapshotError, sha256 } from './atomic-types.js';
import { syncDirectory } from './fs-durability.js';

export const LEASE_LEDGER_ARCHIVE_SCHEMA = 'axm.echoworld.writer-lease-ledger-archive/v0.01';

const RECORD_SCHEMAS = Object.freeze({
  claim: 'axm.echoworld.writer-lease-claim/v0.01',
  activation: 'axm.echoworld.writer-lease-activation/v0.01',
  heartbeat: 'axm.echoworld.writer-lease-heartbeat/v0.01',
  base: 'axm.echoworld.writer-lease-base/v0.01',
  release: 'axm.echoworld.writer-lease-release/v0.01',
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

function hashIdentity(record, omitted = []) {
  return sha256(JSON.stringify(stable(Object.fromEntries(
    Object.entries(record).filter(([key]) => !omitted.includes(key)),
  ))));
}

function seal(record) {
  return { ...record, recordHash: hashIdentity(record) };
}

function validateSealed(record, schema) {
  if (!record || record.schema !== schema || typeof record.recordHash !== 'string') {
    return { valid: false, reason: 'SCHEMA_OR_HASH_MISSING' };
  }
  if (hashIdentity(record, ['recordHash']) !== record.recordHash) {
    return { valid: false, reason: 'RECORD_HASH_MISMATCH' };
  }
  return { valid: true, reason: null };
}

function tokenPart(token) {
  return String(token).padStart(20, '0');
}

function archivePart(generation) {
  return String(generation).padStart(10, '0');
}

export function leaseLedgerArchivePaths(directory, name = 'world') {
  const leaseRoot = path.join(directory, `${name}.writer-lease`);
  return {
    leaseRoot,
    claimsDir: path.join(leaseRoot, 'claims'),
    activationsDir: path.join(leaseRoot, 'activations'),
    heartbeatsDir: path.join(leaseRoot, 'heartbeats'),
    basesDir: path.join(leaseRoot, 'bases'),
    releasesDir: path.join(leaseRoot, 'releases'),
    archivesDir: path.join(leaseRoot, 'archive'),
  };
}

async function ensureStore(directory, name, { requireDirectorySync = true } = {}) {
  const paths = leaseLedgerArchivePaths(directory, name);
  for (const directoryPath of [
    paths.claimsDir,
    paths.activationsDir,
    paths.heartbeatsDir,
    paths.basesDir,
    paths.releasesDir,
    paths.archivesDir,
  ]) {
    await mkdir(directoryPath, { recursive: true });
  }
  await syncDirectory(paths.leaseRoot, { requireDirectorySync });
  return paths;
}

async function names(directory) {
  try {
    return await readdir(directory);
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

function parseArchive(name) {
  const match = name.match(/^lease-archive-(\d{10})\.json$/);
  return match ? Number(match[1]) : null;
}

async function readJson(filePath, schema) {
  try {
    const text = await readFile(filePath, 'utf8');
    const record = JSON.parse(text);
    return { exists: true, text, record, ...validateSealed(record, schema) };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { exists: false, text: null, record: null, valid: false, reason: 'FILE_MISSING' };
    }
    return {
      exists: true,
      text: null,
      record: null,
      valid: false,
      reason: error instanceof SyntaxError ? 'JSON_PARSE_FAILED' : 'FILE_READ_FAILED',
      details: { code: error?.code ?? null, message: error.message },
    };
  }
}

async function writeExclusive(filePath, record, { requireDirectorySync = true } = {}) {
  const sealed = seal(record);
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

export async function readLeaseLedgerArchiveState({
  directory,
  name = 'world',
  requireDirectorySync = true,
} = {}) {
  const paths = await ensureStore(directory, name, { requireDirectorySync });
  const archiveNames = (await names(paths.archivesDir))
    .map((fileName) => ({ fileName, generation: parseArchive(fileName) }))
    .filter((item) => item.generation !== null)
    .sort((a, b) => b.generation - a.generation);
  if (archiveNames.length === 0) {
    return {
      schema: 'axm.echoworld.writer-lease-ledger-archive-state/v0.01',
      archive: null,
      archiveGeneration: 0,
      archivedThroughToken: 0,
      highestAllocatedToken: 0,
      cumulativeRoot: null,
      paths,
    };
  }

  const latest = archiveNames[0];
  const result = await readJson(
    path.join(paths.archivesDir, latest.fileName),
    LEASE_LEDGER_ARCHIVE_SCHEMA,
  );
  if (!result.valid) {
    throw new AtomicSnapshotError('LEASE_LEDGER_ARCHIVE_CORRUPT', 'Latest lease-ledger archive is invalid.', {
      generation: latest.generation,
      reason: result.reason,
    });
  }
  if (result.record.archiveGeneration !== latest.generation) {
    throw new AtomicSnapshotError('LEASE_LEDGER_ARCHIVE_GENERATION_MISMATCH', 'Archive filename and record disagree.');
  }
  const expectedId = `LLA_${hashIdentity(result.record, ['archiveId', 'recordHash']).slice(0, 24)}`;
  if (result.record.archiveId !== expectedId) {
    throw new AtomicSnapshotError('LEASE_LEDGER_ARCHIVE_ID_MISMATCH', 'Lease-ledger archive identity is invalid.');
  }
  return {
    schema: 'axm.echoworld.writer-lease-ledger-archive-state/v0.01',
    archive: result.record,
    archiveGeneration: result.record.archiveGeneration,
    archivedThroughToken: result.record.archivedThroughToken,
    highestAllocatedToken: result.record.highestAllocatedToken,
    cumulativeRoot: result.record.cumulativeRoot,
    paths,
  };
}

async function rawClaimTokens(paths) {
  return (await names(paths.claimsDir))
    .map((fileName) => parseToken(fileName, 'claim'))
    .filter((token) => token !== null)
    .sort((a, b) => a - b);
}

export async function highestLeaseFencingToken({
  directory,
  name = 'world',
  requireDirectorySync = true,
} = {}) {
  const state = await readLeaseLedgerArchiveState({ directory, name, requireDirectorySync });
  const raw = await rawClaimTokens(state.paths);
  return Math.max(state.highestAllocatedToken, raw.at(-1) ?? 0);
}

async function recordForToken(directoryPath, prefix, token, schema) {
  return readJson(path.join(directoryPath, `${prefix}-${tokenPart(token)}.json`), schema);
}

async function heartbeatRecords(paths, token) {
  const heartbeatNames = (await names(paths.heartbeatsDir))
    .map((fileName) => ({ fileName, parsed: parseHeartbeat(fileName) }))
    .filter((item) => item.parsed?.fencingToken === token)
    .sort((a, b) => a.parsed.sequence - b.parsed.sequence);
  const records = [];
  for (const item of heartbeatNames) {
    records.push({
      relativePath: path.join('heartbeats', item.fileName),
      filePath: path.join(paths.heartbeatsDir, item.fileName),
      result: await readJson(path.join(paths.heartbeatsDir, item.fileName), RECORD_SCHEMAS.heartbeat),
    });
  }
  return records;
}

function logicalExpiry(record, logicalField, legacyField) {
  return record?.[logicalField] ?? record?.[legacyField] ?? Number.NEGATIVE_INFINITY;
}

async function tokenStatus(paths, token, logicalNowMs) {
  const claim = await recordForToken(paths.claimsDir, 'claim', token, RECORD_SCHEMAS.claim);
  if (!claim.valid) return { archivable: false, reason: 'INVALID_OR_MISSING_CLAIM' };
  const activation = await recordForToken(
    paths.activationsDir,
    'activation',
    token,
    RECORD_SCHEMAS.activation,
  );
  const release = await recordForToken(paths.releasesDir, 'release', token, RECORD_SCHEMAS.release);
  const heartbeats = await heartbeatRecords(paths, token);
  const latestHeartbeat = heartbeats
    .filter((item) => item.result.valid)
    .at(-1)?.result.record ?? null;

  if (release.valid) return { archivable: true, reason: 'RELEASED' };
  if (activation.valid) {
    const expiry = logicalExpiry(
      latestHeartbeat ?? activation.record,
      'expiresAtLogicalMs',
      'expiresAtMs',
    );
    return {
      archivable: expiry <= logicalNowMs,
      reason: expiry <= logicalNowMs ? 'EXPIRED' : 'ACTIVE',
    };
  }
  const provisionalExpiry = logicalExpiry(
    claim.record,
    'provisionalExpiresAtLogicalMs',
    'provisionalExpiresAtMs',
  );
  return {
    archivable: provisionalExpiry <= logicalNowMs,
    reason: provisionalExpiry <= logicalNowMs ? 'PROVISIONAL_EXPIRED' : 'PROVISIONAL_ACTIVE',
  };
}

async function tokenFiles(paths, token) {
  const files = [];
  for (const [directoryPath, prefix, schema, relativeDirectory] of [
    [paths.claimsDir, 'claim', RECORD_SCHEMAS.claim, 'claims'],
    [paths.activationsDir, 'activation', RECORD_SCHEMAS.activation, 'activations'],
    [paths.basesDir, 'base', RECORD_SCHEMAS.base, 'bases'],
    [paths.releasesDir, 'release', RECORD_SCHEMAS.release, 'releases'],
  ]) {
    const fileName = `${prefix}-${tokenPart(token)}.json`;
    const filePath = path.join(directoryPath, fileName);
    const result = await readJson(filePath, schema);
    if (result.exists) files.push({ relativePath: path.join(relativeDirectory, fileName), filePath, result });
  }
  files.push(...await heartbeatRecords(paths, token));
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export async function archiveLeaseLedgerRecords({
  directory,
  name = 'world',
  logicalNowMs,
  retainRecentTokens = 4,
  keepArchiveCheckpoints = 2,
  protectedFencingTokens = [],
  requireDirectorySync = true,
} = {}) {
  if (!Number.isFinite(logicalNowMs)) {
    throw new AtomicSnapshotError('INVALID_ARCHIVE_LOGICAL_TIME', 'logicalNowMs must be finite.');
  }
  if (!Number.isInteger(retainRecentTokens) || retainRecentTokens < 1) {
    throw new AtomicSnapshotError('INVALID_LEASE_TOKEN_RETENTION', 'retainRecentTokens must be at least 1.');
  }
  if (!Number.isInteger(keepArchiveCheckpoints) || keepArchiveCheckpoints < 1) {
    throw new AtomicSnapshotError('INVALID_LEASE_ARCHIVE_RETENTION', 'keepArchiveCheckpoints must be at least 1.');
  }

  const state = await readLeaseLedgerArchiveState({ directory, name, requireDirectorySync });
  const rawTokens = await rawClaimTokens(state.paths);
  const highestAllocatedToken = Math.max(state.highestAllocatedToken, rawTokens.at(-1) ?? 0);
  const candidateThrough = Math.max(0, highestAllocatedToken - retainRecentTokens);
  const protectedSet = new Set(protectedFencingTokens);
  const eligibleTokens = [];

  for (let token = state.archivedThroughToken + 1; token <= candidateThrough; token += 1) {
    if (protectedSet.has(token)) break;
    const status = await tokenStatus(state.paths, token, logicalNowMs);
    if (!status.archivable) break;
    eligibleTokens.push(token);
  }

  if (eligibleTokens.length === 0) {
    return {
      schema: 'axm.echoworld.writer-lease-ledger-archive-receipt/v0.01',
      status: 'NOTHING_TO_ARCHIVE',
      archivedTokenCount: 0,
      retainedRecentTokens,
      highestAllocatedToken,
      archive: state.archive,
    };
  }

  const entries = [];
  const filesToDelete = [];
  for (const token of eligibleTokens) {
    const files = await tokenFiles(state.paths, token);
    for (const item of files) {
      if (!item.result.text) continue;
      entries.push({
        fencingToken: token,
        relativePath: item.relativePath,
        byteLength: Buffer.byteLength(item.result.text),
        fileHash: sha256(item.result.text),
        valid: item.result.valid,
        reason: item.result.reason,
      });
      filesToDelete.push(item.filePath);
    }
  }

  const archivedThroughToken = eligibleTokens.at(-1);
  const segmentRoot = sha256(JSON.stringify(entries));
  const archiveGeneration = state.archiveGeneration + 1;
  const cumulativeRoot = sha256(JSON.stringify({
    previousCumulativeRoot: state.cumulativeRoot,
    segmentRoot,
    archivedThroughToken,
    highestAllocatedToken,
  }));
  const archive = {
    schema: LEASE_LEDGER_ARCHIVE_SCHEMA,
    archiveGeneration,
    previousArchiveId: state.archive?.archiveId ?? null,
    previousCumulativeRoot: state.cumulativeRoot,
    cumulativeRoot,
    segmentRoot,
    archivedFromToken: eligibleTokens[0],
    archivedThroughToken,
    archivedTokenCount: eligibleTokens.length,
    archivedFileCount: entries.length,
    highestAllocatedToken,
    logicalNowMs,
    retention: {
      retainRecentTokens,
      keepArchiveCheckpoints,
      rawRecordsRetained: false,
    },
  };
  archive.archiveId = `LLA_${hashIdentity(archive).slice(0, 24)}`;
  const archivePath = path.join(
    state.paths.archivesDir,
    `lease-archive-${archivePart(archiveGeneration)}.json`,
  );
  const writtenArchive = await writeExclusive(archivePath, archive, { requireDirectorySync });

  for (const filePath of filesToDelete) await rm(filePath, { force: true });
  for (const directoryPath of [
    state.paths.claimsDir,
    state.paths.activationsDir,
    state.paths.heartbeatsDir,
    state.paths.basesDir,
    state.paths.releasesDir,
  ]) {
    await syncDirectory(directoryPath, { requireDirectorySync });
  }

  const archiveNames = (await names(state.paths.archivesDir))
    .map((fileName) => ({ fileName, generation: parseArchive(fileName) }))
    .filter((item) => item.generation !== null)
    .sort((a, b) => b.generation - a.generation);
  for (const item of archiveNames.slice(keepArchiveCheckpoints)) {
    await rm(path.join(state.paths.archivesDir, item.fileName), { force: true });
  }
  await syncDirectory(state.paths.archivesDir, { requireDirectorySync });

  return {
    schema: 'axm.echoworld.writer-lease-ledger-archive-receipt/v0.01',
    status: 'ARCHIVED',
    archivedTokenCount: eligibleTokens.length,
    archivedFileCount: entries.length,
    archivedFromToken: eligibleTokens[0],
    archivedThroughToken,
    highestAllocatedToken,
    archive: writtenArchive,
  };
}
