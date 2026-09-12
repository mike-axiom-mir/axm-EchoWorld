import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { sha256 } from '../src/persistence/atomic-types.js';
import { archiveLeaseLedgerRecords } from '../src/persistence/lease-ledger-archive.js';
import {
  acquireWriterLease,
  inspectWriterLeaseStore,
  releaseWriterLease,
  writerLeasePaths,
} from '../src/persistence/writer-lease.js';

async function makeDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'axm-echoworld-lease-linkage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function seal(record) {
  return {
    ...record,
    recordHash: sha256(JSON.stringify(stable(record))),
  };
}

async function writeSealed(filePath, record) {
  await writeFile(filePath, `${JSON.stringify(seal(record), null, 2)}\n`, 'utf8');
}

function releasePath(paths, fencingToken) {
  return path.join(paths.releasesDir, `release-${String(fencingToken).padStart(20, '0')}.json`);
}

test('a re-sealed foreign release cannot end another writer claim', async (t) => {
  const directory = await makeDirectory(t);
  const lease = await acquireWriterLease({
    directory,
    writerId: 'writer-a',
    nowMs: 1_000,
    leaseDurationMs: 10_000,
  });
  const paths = writerLeasePaths(directory);

  await writeSealed(releasePath(paths, lease.fencingToken), {
    schema: 'axm.echoworld.writer-lease-release/v0.01',
    fencingToken: lease.fencingToken,
    writerId: 'writer-b',
    leaseId: lease.leaseId,
    releasedAtMs: 1_001,
    releasedAtLogicalMs: 1_001,
    clockObservationId: lease.clockObservationId,
    reason: 'FOREIGN_RELEASE',
  });

  const inspection = await inspectWriterLeaseStore({ directory, nowMs: 1_002 });
  assert.equal(inspection.active?.writerId, 'writer-a');
  assert.ok(inspection.invalidRecords.some((record) => (
    record.name.startsWith('release-')
    && record.reason === 'RECORD_CLAIM_IDENTITY_MISMATCH'
  )));
  await assert.rejects(
    () => releaseWriterLease({ directory, lease, nowMs: 1_003 }),
    (error) => error?.code === 'WRITER_LEASE_RELEASE_CONFLICT',
  );
  await assert.rejects(
    () => acquireWriterLease({
      directory,
      writerId: 'writer-b',
      nowMs: 1_004,
      leaseDurationMs: 10_000,
    }),
    (error) => error?.code === 'WRITER_LEASE_HELD',
  );
});

test('a foreign release cannot make an active token archivable', async (t) => {
  const directory = await makeDirectory(t);
  const lease = await acquireWriterLease({
    directory,
    writerId: 'writer-a',
    nowMs: 2_000,
    leaseDurationMs: 10_000,
  });
  const paths = writerLeasePaths(directory);

  await writeSealed(releasePath(paths, lease.fencingToken), {
    schema: 'axm.echoworld.writer-lease-release/v0.01',
    fencingToken: lease.fencingToken,
    writerId: 'writer-b',
    leaseId: lease.leaseId,
    releasedAtMs: 2_001,
    releasedAtLogicalMs: 2_001,
    clockObservationId: lease.clockObservationId,
    reason: 'FOREIGN_RELEASE',
  });
  await writeFile(
    path.join(paths.claimsDir, 'claim-00000000000000000002.json'),
    '{"schema":"burned-token"}\n',
    'utf8',
  );

  const archived = await archiveLeaseLedgerRecords({
    directory,
    logicalNowMs: 2_002,
    retainRecentTokens: 1,
  });
  assert.equal(archived.status, 'NOTHING_TO_ARCHIVE');
  await readFile(path.join(paths.claimsDir, 'claim-00000000000000000001.json'), 'utf8');
});

test('record identity must agree with the fencing token encoded by its filename', async (t) => {
  const directory = await makeDirectory(t);
  const lease = await acquireWriterLease({
    directory,
    writerId: 'writer-a',
    nowMs: 3_000,
    leaseDurationMs: 10_000,
  });
  const paths = writerLeasePaths(directory);
  const activationPath = path.join(
    paths.activationsDir,
    `activation-${String(lease.fencingToken).padStart(20, '0')}.json`,
  );
  const activation = JSON.parse(await readFile(activationPath, 'utf8'));
  delete activation.recordHash;
  activation.fencingToken += 1;
  await writeSealed(activationPath, activation);

  const inspection = await inspectWriterLeaseStore({ directory, nowMs: 3_001 });
  assert.equal(inspection.active, null);
  assert.ok(inspection.invalidRecords.some((record) => (
    record.name.startsWith('activation-')
    && record.reason === 'RECORD_FILENAME_IDENTITY_MISMATCH'
  )));
});
