import {
  mkdir,
  open,
  readFile,
  readdir,
} from 'node:fs/promises';
import path from 'node:path';

import { AtomicSnapshotError, sha256 } from './atomic-types.js';
import { syncDirectory } from './fs-durability.js';

export const SNAPSHOT_LINEAGE_SCHEMA = 'axm.echoworld.snapshot-lineage-record/v0.01';

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

function generationPart(generation) {
  return String(generation).padStart(20, '0');
}

export function snapshotLineagePaths(directory, name = 'world') {
  const root = path.join(directory, `${name}.snapshot-lineage`);
  return { root, recordsDir: path.join(root, 'records') };
}

function safeSnapshotPart(snapshotId) {
  if (typeof snapshotId !== 'string' || !/^AS_[A-Fa-f0-9]{24}$/.test(snapshotId)) {
    throw new AtomicSnapshotError('INVALID_LINEAGE_SNAPSHOT_ID', 'Snapshot ID cannot be used in lineage filename.');
  }
  return snapshotId;
}

function recordPath(paths, generation, snapshotId) {
  return path.join(
    paths.recordsDir,
    `generation-${generationPart(generation)}-${safeSnapshotPart(snapshotId)}.json`,
  );
}

async function ensureStore(directory, name, { requireDirectorySync = true } = {}) {
  const paths = snapshotLineagePaths(directory, name);
  await mkdir(paths.recordsDir, { recursive: true });
  await syncDirectory(paths.root, { requireDirectorySync });
  return paths;
}

function validateLineageRecord(record) {
  if (!record || record.schema !== SNAPSHOT_LINEAGE_SCHEMA || typeof record.recordHash !== 'string') {
    return { valid: false, reason: 'SCHEMA_OR_HASH_MISSING' };
  }
  if (hashIdentity(record, ['recordHash']) !== record.recordHash) {
    return { valid: false, reason: 'RECORD_HASH_MISMATCH' };
  }
  const expectedId = `SLR_${hashIdentity(record, ['lineageRecordId', 'recordHash']).slice(0, 24)}`;
  if (record.lineageRecordId !== expectedId) {
    return { valid: false, reason: 'LINEAGE_RECORD_ID_MISMATCH' };
  }
  return { valid: true, reason: null };
}

async function readRecord(filePath) {
  try {
    const text = await readFile(filePath, 'utf8');
    const record = JSON.parse(text);
    return { exists: true, text, record, ...validateLineageRecord(record) };
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

export function createSnapshotLineageRecord(envelope, previousLineageRecordId = null) {
  if (!envelope || !Number.isInteger(envelope.generation) || envelope.generation < 1) {
    throw new AtomicSnapshotError('INVALID_LINEAGE_ENVELOPE', 'A valid snapshot envelope is required.');
  }
  const checkpoint = envelope.checkpoint ?? null;
  const record = {
    schema: SNAPSHOT_LINEAGE_SCHEMA,
    generation: envelope.generation,
    snapshotId: envelope.snapshotId,
    parentSnapshotId: envelope.parentSnapshotId,
    canonicalHash: envelope.canonicalHash,
    payloadHash: envelope.payloadHash,
    envelopeSchema: envelope.schema,
    checkpointId: checkpoint?.checkpointId ?? null,
    checkpointSessionId: checkpoint?.checkpointSessionId ?? null,
    writerId: checkpoint?.writerId ?? null,
    leaseId: checkpoint?.leaseId ?? null,
    fencingToken: Number.isInteger(checkpoint?.fencingToken) ? checkpoint.fencingToken : null,
    admittedLogicalMs: checkpoint?.admittedLogicalMs ?? null,
    clockObservationId: checkpoint?.clockObservationId ?? null,
    previousLineageRecordId,
  };
  record.lineageRecordId = `SLR_${hashIdentity(record).slice(0, 24)}`;
  return record;
}

export async function inspectSnapshotLineage({
  directory,
  name = 'world',
  requireDirectorySync = true,
} = {}) {
  const paths = await ensureStore(directory, name, { requireDirectorySync });
  const names = (await readdir(paths.recordsDir))
    .map((fileName) => {
      const match = fileName.match(/^generation-(\d{20})-(AS_[A-Fa-f0-9]{24})\.json$/);
      return match ? { fileName, generation: Number(match[1]), snapshotId: match[2] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.generation - b.generation || a.snapshotId.localeCompare(b.snapshotId));
  const records = [];
  for (const item of names) {
    const result = await readRecord(path.join(paths.recordsDir, item.fileName));
    if (!result.valid) {
      throw new AtomicSnapshotError('SNAPSHOT_LINEAGE_RECORD_CORRUPT', 'A snapshot lineage record is invalid.', {
        generation: item.generation,
        snapshotId: item.snapshotId,
        reason: result.reason,
      });
    }
    if (result.record.generation !== item.generation || result.record.snapshotId !== item.snapshotId) {
      throw new AtomicSnapshotError('SNAPSHOT_LINEAGE_FILENAME_MISMATCH', 'Lineage filename and record disagree.');
    }
    records.push(result.record);
  }
  return {
    schema: 'axm.echoworld.snapshot-lineage-inspection/v0.01',
    directory,
    name,
    paths,
    records,
    recordCount: records.length,
  };
}

function buildSelectedChain(records, headSnapshotId) {
  const bySnapshotId = new Map();
  for (const record of records) {
    const existing = bySnapshotId.get(record.snapshotId);
    if (existing && existing.lineageRecordId !== record.lineageRecordId) {
      throw new AtomicSnapshotError('SNAPSHOT_LINEAGE_IDENTITY_CONFLICT', 'Snapshot ID has conflicting lineage records.', {
        snapshotId: record.snapshotId,
      });
    }
    bySnapshotId.set(record.snapshotId, record);
  }

  const reverse = [];
  const seen = new Set();
  let currentId = headSnapshotId;
  while (currentId !== null) {
    if (seen.has(currentId)) {
      throw new AtomicSnapshotError('SNAPSHOT_LINEAGE_CYCLE', 'Snapshot parent chain contains a cycle.', {
        snapshotId: currentId,
      });
    }
    seen.add(currentId);
    const record = bySnapshotId.get(currentId);
    if (!record) {
      throw new AtomicSnapshotError('SNAPSHOT_LINEAGE_PARENT_MISSING', 'Snapshot parent record is unavailable.', {
        snapshotId: currentId,
      });
    }
    reverse.push(record);
    currentId = record.parentSnapshotId;
  }
  return reverse.reverse();
}

export function verifySnapshotLineageRecords(records, { headEnvelope = null } = {}) {
  if (!headEnvelope) {
    throw new AtomicSnapshotError('SNAPSHOT_LINEAGE_HEAD_REQUIRED', 'A selected head envelope is required.');
  }
  const chain = buildSelectedChain(records, headEnvelope.snapshotId);
  let previous = null;
  let highestFencingToken = null;
  let fencingStarted = false;

  for (const record of chain) {
    if (record.generation === 1) {
      if (record.parentSnapshotId !== null || record.previousLineageRecordId !== null) {
        throw new AtomicSnapshotError('SNAPSHOT_LINEAGE_ROOT_INVALID', 'Generation 1 must have no parent lineage.');
      }
    } else {
      if (!previous || record.generation !== previous.generation + 1) {
        throw new AtomicSnapshotError('SNAPSHOT_LINEAGE_GAP', 'Selected parent chain generations are not contiguous.', {
          generation: record.generation,
          previousGeneration: previous?.generation ?? null,
        });
      }
      if (
        record.parentSnapshotId !== previous.snapshotId
        || record.previousLineageRecordId !== previous.lineageRecordId
      ) {
        throw new AtomicSnapshotError('SNAPSHOT_LINEAGE_PARENT_MISMATCH', 'Snapshot lineage parent relation is broken.', {
          generation: record.generation,
        });
      }
    }

    if (Number.isInteger(record.fencingToken)) {
      if (highestFencingToken !== null && record.fencingToken < highestFencingToken) {
        throw new AtomicSnapshotError('SNAPSHOT_FENCING_REGRESSION', 'Snapshot fencing token moved backwards.', {
          generation: record.generation,
          previousFencingToken: highestFencingToken,
          fencingToken: record.fencingToken,
        });
      }
      fencingStarted = true;
      highestFencingToken = record.fencingToken;
    } else if (fencingStarted) {
      throw new AtomicSnapshotError('SNAPSHOT_FENCING_GAP', 'An unfenced generation followed fenced history.', {
        generation: record.generation,
      });
    }
    previous = record;
  }

  if (
    !previous
    || previous.generation !== headEnvelope.generation
    || previous.snapshotId !== headEnvelope.snapshotId
  ) {
    throw new AtomicSnapshotError('SNAPSHOT_LINEAGE_HEAD_MISMATCH', 'Selected lineage chain does not end at snapshot head.');
  }

  return {
    schema: 'axm.echoworld.snapshot-lineage-verification/v0.01',
    status: 'VERIFIED',
    chainLength: chain.length,
    totalRecordCount: records.length,
    branchRecordCount: records.length - chain.length,
    headGeneration: previous.generation,
    headSnapshotId: previous.snapshotId,
    highestFencingToken,
    chain,
  };
}

export async function verifySnapshotLineage({
  directory,
  name = 'world',
  headEnvelope,
  requireDirectorySync = true,
} = {}) {
  const inspection = await inspectSnapshotLineage({ directory, name, requireDirectorySync });
  return verifySnapshotLineageRecords(inspection.records, { headEnvelope });
}

export async function recordSnapshotLineage({
  directory,
  name = 'world',
  envelope,
  requireDirectorySync = true,
} = {}) {
  const paths = await ensureStore(directory, name, { requireDirectorySync });
  const inspection = await inspectSnapshotLineage({ directory, name, requireDirectorySync });
  const previous = envelope.generation === 1
    ? null
    : inspection.records.find((record) => record.snapshotId === envelope.parentSnapshotId);
  if (envelope.generation > 1 && !previous) {
    throw new AtomicSnapshotError('SNAPSHOT_LINEAGE_PARENT_MISSING', 'Previous lineage record is unavailable.', {
      generation: envelope.generation,
      parentSnapshotId: envelope.parentSnapshotId,
    });
  }
  if (previous && previous.generation !== envelope.generation - 1) {
    throw new AtomicSnapshotError('SNAPSHOT_LINEAGE_PARENT_GENERATION_MISMATCH', 'Parent generation is not one less than child.');
  }
  const record = createSnapshotLineageRecord(envelope, previous?.lineageRecordId ?? null);
  const filePath = recordPath(paths, envelope.generation, envelope.snapshotId);
  try {
    await writeExclusive(filePath, record, { requireDirectorySync });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readRecord(filePath);
    if (!existing.valid || existing.record.lineageRecordId !== record.lineageRecordId) {
      throw new AtomicSnapshotError('SNAPSHOT_LINEAGE_RECORD_CONFLICT', 'Snapshot already has different lineage evidence.', {
        generation: envelope.generation,
        snapshotId: envelope.snapshotId,
      });
    }
  }
  return verifySnapshotLineage({ directory, name, headEnvelope: envelope, requireDirectorySync });
}

export async function reconcileSnapshotLineageCandidates({
  directory,
  name = 'world',
  candidates,
  selectedEnvelope,
  requireDirectorySync = true,
} = {}) {
  const inspection = await inspectSnapshotLineage({ directory, name, requireDirectorySync });
  const existingIds = new Set(inspection.records.map((record) => record.snapshotId));
  const candidateMap = new Map(
    (candidates ?? [])
      .filter((candidate) => candidate.valid)
      .map((candidate) => [candidate.envelope.snapshotId, candidate.envelope]),
  );
  const missing = [];
  let cursor = selectedEnvelope;
  while (cursor && !existingIds.has(cursor.snapshotId)) {
    missing.push(cursor);
    if (cursor.parentSnapshotId === null) break;
    cursor = candidateMap.get(cursor.parentSnapshotId) ?? null;
  }
  if (missing.at(-1)?.parentSnapshotId !== null && !cursor) {
    throw new AtomicSnapshotError('SNAPSHOT_LINEAGE_RECONCILIATION_GAP', 'Available candidates cannot fill selected lineage gap.', {
      selectedSnapshotId: selectedEnvelope.snapshotId,
      missingParentSnapshotId: missing.at(-1)?.parentSnapshotId ?? null,
    });
  }
  for (const envelope of missing.reverse()) {
    await recordSnapshotLineage({ directory, name, envelope, requireDirectorySync });
  }
  return verifySnapshotLineage({ directory, name, headEnvelope: selectedEnvelope, requireDirectorySync });
}
