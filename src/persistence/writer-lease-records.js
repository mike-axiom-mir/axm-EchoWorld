import {
  mkdir,
  open,
  readFile,
  readdir,
} from 'node:fs/promises';
import path from 'node:path';

import { AtomicSnapshotError, sha256 } from './atomic-types.js';
import { syncDirectory } from './fs-durability.js';

export const WRITER_LEASE_SCHEMAS = Object.freeze({
  claim: 'axm.echoworld.writer-lease-claim/v0.01',
  activation: 'axm.echoworld.writer-lease-activation/v0.01',
  heartbeat: 'axm.echoworld.writer-lease-heartbeat/v0.01',
  base: 'axm.echoworld.writer-lease-base/v0.01',
  release: 'axm.echoworld.writer-lease-release/v0.01',
  handle: 'axm.echoworld.writer-lease-handle/v0.01',
  inspection: 'axm.echoworld.writer-lease-inspection/v0.02',
});

export const WRITER_LEASE_STAGES = Object.freeze([
  'AFTER_CLAIM_FSYNC',
  'AFTER_ACTIVATION_FSYNC',
  'AFTER_BASE_RECORD_FSYNC',
  'AFTER_HEARTBEAT_FSYNC',
  'AFTER_RELEASE_FSYNC',
]);

export const WRITER_LEASE_DEFAULTS = Object.freeze({
  leaseDurationMs: 30_000,
  provisionalDurationMs: 5_000,
  rollbackToleranceMs: 0,
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
  return { ...record, recordHash: sha256(JSON.stringify(stable(record))) };
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

export function writerLeaseTokenPart(token) {
  return String(token).padStart(20, '0');
}

export function writerLeaseSequencePart(sequence) {
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
  const token = writerLeaseTokenPart(fencingToken);
  return {
    claim: path.join(paths.claimsDir, `claim-${token}.json`),
    activation: path.join(paths.activationsDir, `activation-${token}.json`),
    base: path.join(paths.basesDir, `base-${token}.json`),
    release: path.join(paths.releasesDir, `release-${token}.json`),
    heartbeatPrefix: `heartbeat-${token}-`,
  };
}

export async function ensureWriterLeaseStore(
  directory,
  name,
  { requireDirectorySync = true } = {},
) {
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

export async function invokeWriterLeaseStage(onStage, stage, context) {
  if (!WRITER_LEASE_STAGES.includes(stage)) {
    throw new AtomicSnapshotError(
      'UNKNOWN_WRITER_LEASE_STAGE',
      `Unknown writer lease stage: ${stage}`,
    );
  }
  if (onStage) await onStage(stage, context);
}

export async function writeExclusiveWriterLeaseRecord(
  filePath,
  record,
  { requireDirectorySync = true } = {},
) {
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

export async function readWriterLeaseRecord(filePath, schema) {
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

export async function writerLeaseFileNames(directoryPath) {
  try {
    return await readdir(directoryPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export function parseWriterLeaseToken(name, prefix) {
  const match = name.match(new RegExp(`^${prefix}-(\\d{20})\\.json$`));
  return match ? Number(match[1]) : null;
}

export function parseWriterLeaseHeartbeat(name) {
  const match = name.match(/^heartbeat-(\d{20})-(\d{10})\.json$/);
  return match ? { fencingToken: Number(match[1]), sequence: Number(match[2]) } : null;
}

export async function loadWriterLeaseRecords(directoryPath, schema, parser) {
  const names = await writerLeaseFileNames(directoryPath);
  const results = [];
  for (const name of names.sort()) {
    const parsed = parser(name);
    if (!parsed) continue;
    const result = await readWriterLeaseRecord(path.join(directoryPath, name), schema);
    results.push({ name, parsed, ...result });
  }
  return results;
}

export function writerLeaseIdFor({ writerId, fencingToken, claimedAtLogicalMs }) {
  return `WL_${sha256(`${writerId}|${fencingToken}|${claimedAtLogicalMs}`).slice(0, 24)}`;
}

export function writerLeaseExpiryLogical(record) {
  return record?.expiresAtLogicalMs ?? record?.expiresAtMs ?? Number.NEGATIVE_INFINITY;
}

export function writerLeaseProvisionalExpiryLogical(record) {
  return record?.provisionalExpiresAtLogicalMs
    ?? record?.provisionalExpiresAtMs
    ?? Number.NEGATIVE_INFINITY;
}
