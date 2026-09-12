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

export const LEASE_CLOCK_SCHEMAS = Object.freeze({
  observation: 'axm.echoworld.lease-clock-observation/v0.01',
  archive: 'axm.echoworld.lease-clock-archive/v0.01',
  inspection: 'axm.echoworld.lease-clock-inspection/v0.01',
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

function sequencePart(sequence) {
  return String(sequence).padStart(20, '0');
}

function archivePart(generation) {
  return String(generation).padStart(10, '0');
}

export function leaseClockPaths(directory, name = 'world') {
  const root = path.join(directory, `${name}.writer-lease`, 'clock');
  return {
    root,
    observationsDir: path.join(root, 'observations'),
    archivesDir: path.join(root, 'archives'),
  };
}

async function ensureStore(directory, name, { requireDirectorySync = true } = {}) {
  const paths = leaseClockPaths(directory, name);
  await mkdir(paths.observationsDir, { recursive: true });
  await mkdir(paths.archivesDir, { recursive: true });
  await syncDirectory(paths.root, { requireDirectorySync });
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

function parseObservationName(name) {
  const match = name.match(/^observation-(\d{20})\.json$/);
  return match ? Number(match[1]) : null;
}

function parseArchiveName(name) {
  const match = name.match(/^clock-archive-(\d{10})\.json$/);
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

async function readLatestArchive(paths) {
  const archiveNames = (await names(paths.archivesDir))
    .map((name) => ({ name, generation: parseArchiveName(name) }))
    .filter((item) => item.generation !== null)
    .sort((a, b) => b.generation - a.generation);
  if (archiveNames.length === 0) return null;

  const latest = archiveNames[0];
  const result = await readJson(
    path.join(paths.archivesDir, latest.name),
    LEASE_CLOCK_SCHEMAS.archive,
  );
  if (!result.valid) {
    throw new AtomicSnapshotError('LEASE_CLOCK_ARCHIVE_CORRUPT', 'Latest lease-clock archive is invalid.', {
      generation: latest.generation,
      reason: result.reason,
    });
  }
  if (result.record.archiveGeneration !== latest.generation) {
    throw new AtomicSnapshotError('LEASE_CLOCK_ARCHIVE_GENERATION_MISMATCH', 'Archive filename and record disagree.');
  }
  const expectedId = `LCA_${hashIdentity(result.record, ['archiveId', 'recordHash']).slice(0, 24)}`;
  if (result.record.archiveId !== expectedId) {
    throw new AtomicSnapshotError('LEASE_CLOCK_ARCHIVE_ID_MISMATCH', 'Lease-clock archive identity is invalid.');
  }
  return result.record;
}

async function readRawObservations(paths) {
  const items = (await names(paths.observationsDir))
    .map((name) => ({ name, sequence: parseObservationName(name) }))
    .filter((item) => item.sequence !== null)
    .sort((a, b) => a.sequence - b.sequence);
  const observations = [];
  for (const item of items) {
    const result = await readJson(
      path.join(paths.observationsDir, item.name),
      LEASE_CLOCK_SCHEMAS.observation,
    );
    if (!result.valid) {
      throw new AtomicSnapshotError('LEASE_CLOCK_OBSERVATION_CORRUPT', 'A lease-clock observation is invalid.', {
        name: item.name,
        reason: result.reason,
      });
    }
    if (result.record.sequence !== item.sequence) {
      throw new AtomicSnapshotError('LEASE_CLOCK_SEQUENCE_MISMATCH', 'Observation filename and record disagree.');
    }
    const expectedId = `LCO_${hashIdentity(result.record, ['observationId', 'recordHash']).slice(0, 24)}`;
    if (result.record.observationId !== expectedId) {
      throw new AtomicSnapshotError('LEASE_CLOCK_OBSERVATION_ID_MISMATCH', 'Observation identity is invalid.');
    }
    observations.push({ ...result, filePath: path.join(paths.observationsDir, item.name) });
  }
  return observations;
}

function validateObservationChain(archive, observations) {
  let previousSequence = archive?.archivedThroughSequence ?? 0;
  let previousObservationId = archive?.lastObservationId ?? null;
  let previousLogicalMs = archive?.lastLogicalMs ?? Number.NEGATIVE_INFINITY;

  for (const item of observations) {
    const observation = item.record;
    if (observation.sequence !== previousSequence + 1) {
      throw new AtomicSnapshotError('LEASE_CLOCK_SEQUENCE_GAP', 'Lease-clock observation sequence is not contiguous.', {
        expected: previousSequence + 1,
        actual: observation.sequence,
      });
    }
    if (observation.previousObservationId !== previousObservationId) {
      throw new AtomicSnapshotError('LEASE_CLOCK_CHAIN_MISMATCH', 'Lease-clock observation chain is broken.', {
        sequence: observation.sequence,
      });
    }
    if (observation.logicalMs <= previousLogicalMs) {
      throw new AtomicSnapshotError('LEASE_CLOCK_LOGICAL_REGRESSION', 'Lease logical time did not advance.', {
        sequence: observation.sequence,
        previousLogicalMs,
        logicalMs: observation.logicalMs,
      });
    }
    previousSequence = observation.sequence;
    previousObservationId = observation.observationId;
    previousLogicalMs = observation.logicalMs;
  }
}

export async function inspectLeaseClock({
  directory,
  name = 'world',
  requireDirectorySync = true,
} = {}) {
  const paths = await ensureStore(directory, name, { requireDirectorySync });
  const archive = await readLatestArchive(paths);
  const observations = await readRawObservations(paths);
  validateObservationChain(archive, observations);
  const latest = observations.at(-1)?.record ?? null;
  return {
    schema: LEASE_CLOCK_SCHEMAS.inspection,
    directory,
    name,
    paths,
    archive,
    rawObservationCount: observations.length,
    latestSequence: latest?.sequence ?? archive?.archivedThroughSequence ?? 0,
    latestObservationId: latest?.observationId ?? archive?.lastObservationId ?? null,
    latestWallTimeMs: latest?.wallTimeMs ?? archive?.lastWallTimeMs ?? null,
    latestLogicalMs: latest?.logicalMs ?? archive?.lastLogicalMs ?? 0,
    observations: observations.map((item) => item.record),
  };
}

export async function observeLeaseClock({
  directory,
  name = 'world',
  wallTimeMs = Date.now(),
  rollbackToleranceMs = 0,
  operation = 'UNSPECIFIED',
  requireDirectorySync = true,
} = {}) {
  if (!Number.isFinite(wallTimeMs)) {
    throw new AtomicSnapshotError('INVALID_LEASE_CLOCK', 'wallTimeMs must be finite.');
  }
  if (!Number.isInteger(rollbackToleranceMs) || rollbackToleranceMs < 0) {
    throw new AtomicSnapshotError('INVALID_CLOCK_ROLLBACK_TOLERANCE', 'rollbackToleranceMs must be non-negative.');
  }

  const paths = await ensureStore(directory, name, { requireDirectorySync });
  for (;;) {
    const inspection = await inspectLeaseClock({ directory, name, requireDirectorySync });
    if (
      inspection.latestWallTimeMs !== null
      && wallTimeMs < inspection.latestWallTimeMs - rollbackToleranceMs
    ) {
      throw new AtomicSnapshotError('LEASE_CLOCK_ROLLBACK', 'Observed wall time moved backwards beyond tolerance.', {
        wallTimeMs,
        latestWallTimeMs: inspection.latestWallTimeMs,
        rollbackToleranceMs,
        latestLogicalMs: inspection.latestLogicalMs,
      });
    }

    const sequence = inspection.latestSequence + 1;
    const logicalMs = Math.max(wallTimeMs, inspection.latestLogicalMs + 1);
    const observation = {
      schema: LEASE_CLOCK_SCHEMAS.observation,
      sequence,
      previousObservationId: inspection.latestObservationId,
      wallTimeMs,
      logicalMs,
      rollbackToleranceMs,
      operation,
    };
    observation.observationId = `LCO_${hashIdentity(observation).slice(0, 24)}`;
    const filePath = path.join(paths.observationsDir, `observation-${sequencePart(sequence)}.json`);
    try {
      return await writeExclusive(filePath, observation, { requireDirectorySync });
    } catch (error) {
      if (error?.code === 'EEXIST') continue;
      throw error;
    }
  }
}

export async function archiveLeaseClock({
  directory,
  name = 'world',
  retainRecentObservations = 16,
  keepArchiveCheckpoints = 2,
  requireDirectorySync = true,
} = {}) {
  if (!Number.isInteger(retainRecentObservations) || retainRecentObservations < 1) {
    throw new AtomicSnapshotError('INVALID_CLOCK_RETENTION', 'retainRecentObservations must be at least 1.');
  }
  if (!Number.isInteger(keepArchiveCheckpoints) || keepArchiveCheckpoints < 1) {
    throw new AtomicSnapshotError('INVALID_CLOCK_ARCHIVE_RETENTION', 'keepArchiveCheckpoints must be at least 1.');
  }

  const paths = await ensureStore(directory, name, { requireDirectorySync });
  const archive = await readLatestArchive(paths);
  const observations = await readRawObservations(paths);
  validateObservationChain(archive, observations);
  if (observations.length <= retainRecentObservations) {
    return {
      schema: 'axm.echoworld.lease-clock-archive-receipt/v0.01',
      status: 'NOTHING_TO_ARCHIVE',
      archivedCount: 0,
      retainedCount: observations.length,
      archive,
    };
  }

  const archivedItems = observations.slice(0, observations.length - retainRecentObservations);
  const last = archivedItems.at(-1).record;
  const segmentEntries = archivedItems.map((item) => ({
    sequence: item.record.sequence,
    observationId: item.record.observationId,
    fileHash: sha256(item.text),
  }));
  const segmentRoot = sha256(JSON.stringify(segmentEntries));
  const archiveGeneration = (archive?.archiveGeneration ?? 0) + 1;
  const cumulativeRoot = sha256(JSON.stringify({
    previousCumulativeRoot: archive?.cumulativeRoot ?? null,
    segmentRoot,
    archivedThroughSequence: last.sequence,
    lastObservationId: last.observationId,
  }));
  const nextArchive = {
    schema: LEASE_CLOCK_SCHEMAS.archive,
    archiveGeneration,
    previousArchiveId: archive?.archiveId ?? null,
    previousCumulativeRoot: archive?.cumulativeRoot ?? null,
    cumulativeRoot,
    segmentRoot,
    archivedCount: archivedItems.length,
    archivedThroughSequence: last.sequence,
    lastObservationId: last.observationId,
    lastWallTimeMs: last.wallTimeMs,
    lastLogicalMs: last.logicalMs,
  };
  nextArchive.archiveId = `LCA_${hashIdentity(nextArchive).slice(0, 24)}`;
  const archivePath = path.join(
    paths.archivesDir,
    `clock-archive-${archivePart(archiveGeneration)}.json`,
  );
  const writtenArchive = await writeExclusive(archivePath, nextArchive, { requireDirectorySync });

  for (const item of archivedItems) await rm(item.filePath, { force: true });
  await syncDirectory(paths.observationsDir, { requireDirectorySync });

  const archiveNames = (await names(paths.archivesDir))
    .map((fileName) => ({ fileName, generation: parseArchiveName(fileName) }))
    .filter((item) => item.generation !== null)
    .sort((a, b) => b.generation - a.generation);
  for (const item of archiveNames.slice(keepArchiveCheckpoints)) {
    await rm(path.join(paths.archivesDir, item.fileName), { force: true });
  }
  await syncDirectory(paths.archivesDir, { requireDirectorySync });

  return {
    schema: 'axm.echoworld.lease-clock-archive-receipt/v0.01',
    status: 'ARCHIVED',
    archivedCount: archivedItems.length,
    retainedCount: observations.length - archivedItems.length,
    archive: writtenArchive,
  };
}
