import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  archiveLeaseClock,
  inspectLeaseClock,
  leaseClockPaths,
  observeLeaseClock,
} from '../src/persistence/lease-clock.js';
import {
  leaseLedgerArchivePaths,
  readLeaseLedgerArchiveState,
} from '../src/persistence/lease-ledger-archive.js';
import {
  acquireWriterLease,
  archiveWriterLeaseLedger,
  inspectWriterLeaseStore,
  releaseWriterLease,
} from '../src/persistence/writer-lease.js';

async function makeDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'axm-echoworld-lease-archive-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function expectCode(code) {
  return (error) => {
    assert.equal(error?.code, code);
    return true;
  };
}

test('lease clock advances logical time at equal wall time and rejects rollback', async (t) => {
  const directory = await makeDirectory(t);
  const first = await observeLeaseClock({ directory, wallTimeMs: 1_000, operation: 'FIRST' });
  const second = await observeLeaseClock({ directory, wallTimeMs: 1_000, operation: 'EQUAL_WALL' });

  assert.equal(first.logicalMs, 1_000);
  assert.equal(second.logicalMs, 1_001);
  assert.equal(second.previousObservationId, first.observationId);

  await assert.rejects(
    () => observeLeaseClock({ directory, wallTimeMs: 999, operation: 'ROLLBACK' }),
    expectCode('LEASE_CLOCK_ROLLBACK'),
  );

  const tolerated = await observeLeaseClock({
    directory,
    wallTimeMs: 999,
    rollbackToleranceMs: 1,
    operation: 'TOLERATED_ROLLBACK',
  });
  assert.equal(tolerated.logicalMs, 1_002);
});

test('lease clock archive bounds raw observations while preserving rollback evidence', async (t) => {
  const directory = await makeDirectory(t);
  for (let index = 0; index < 12; index += 1) {
    await observeLeaseClock({
      directory,
      wallTimeMs: 2_000 + index,
      operation: `CLOCK_${index}`,
    });
  }

  const archived = await archiveLeaseClock({
    directory,
    retainRecentObservations: 3,
    keepArchiveCheckpoints: 1,
  });
  const inspection = await inspectLeaseClock({ directory });
  const paths = leaseClockPaths(directory);

  assert.equal(archived.status, 'ARCHIVED');
  assert.equal(archived.archivedCount, 9);
  assert.equal(inspection.rawObservationCount, 3);
  assert.equal(inspection.latestSequence, 12);
  assert.equal(inspection.archive.archivedThroughSequence, 9);
  assert.equal((await readdir(paths.archivesDir)).length, 1);

  await assert.rejects(
    () => observeLeaseClock({ directory, wallTimeMs: 2_005, operation: 'ARCHIVED_ROLLBACK' }),
    expectCode('LEASE_CLOCK_ROLLBACK'),
  );
});

test('lease ledger archive prunes closed raw records without reusing fencing tokens', async (t) => {
  const directory = await makeDirectory(t);
  let wallTime = 10_000;

  for (let index = 0; index < 7; index += 1) {
    const lease = await acquireWriterLease({
      directory,
      writerId: `archived-writer-${index}`,
      nowMs: wallTime,
      leaseDurationMs: 100,
    });
    wallTime += 10;
    await releaseWriterLease({ directory, lease, nowMs: wallTime });
    wallTime += 10;
  }

  const current = await acquireWriterLease({
    directory,
    writerId: 'current-writer',
    nowMs: wallTime,
    leaseDurationMs: 1_000,
  });
  wallTime += 10;
  const archived = await archiveWriterLeaseLedger({
    directory,
    lease: current,
    nowMs: wallTime,
    retainRecentTokens: 2,
    retainRecentClockObservations: 4,
    keepArchiveCheckpoints: 1,
  });
  const state = await readLeaseLedgerArchiveState({ directory });
  const paths = leaseLedgerArchivePaths(directory);
  const rawClaims = (await readdir(paths.claimsDir)).sort();

  assert.equal(archived.status, 'ARCHIVED');
  assert.equal(state.archivedThroughToken, 6);
  assert.equal(state.highestAllocatedToken, 8);
  assert.deepEqual(rawClaims, [
    'claim-00000000000000000007.json',
    'claim-00000000000000000008.json',
  ]);

  await releaseWriterLease({ directory, lease: current, nowMs: wallTime + 10 });
  const replacement = await acquireWriterLease({
    directory,
    writerId: 'post-archive-writer',
    nowMs: wallTime + 20,
    leaseDurationMs: 1_000,
  });
  assert.equal(replacement.fencingToken, 9);
});

test('active fencing token is protected from lease-ledger archival', async (t) => {
  const directory = await makeDirectory(t);
  const active = await acquireWriterLease({
    directory,
    writerId: 'protected-writer',
    nowMs: 20_000,
    leaseDurationMs: 5_000,
  });
  const receipt = await archiveWriterLeaseLedger({
    directory,
    lease: active,
    nowMs: 20_001,
    retainRecentTokens: 1,
  });
  const inspection = await inspectWriterLeaseStore({ directory, nowMs: 20_002 });

  assert.equal(receipt.fencingToken, active.fencingToken);
  assert.equal(inspection.active.fencingToken, active.fencingToken);
});

test('tampered lease-ledger archive fails closed', async (t) => {
  const directory = await makeDirectory(t);
  let now = 30_000;
  for (let index = 0; index < 5; index += 1) {
    const lease = await acquireWriterLease({
      directory,
      writerId: `tamper-writer-${index}`,
      nowMs: now,
      leaseDurationMs: 100,
    });
    now += 10;
    await releaseWriterLease({ directory, lease, nowMs: now });
    now += 10;
  }
  const current = await acquireWriterLease({
    directory,
    writerId: 'tamper-current',
    nowMs: now,
    leaseDurationMs: 1_000,
  });
  await archiveWriterLeaseLedger({
    directory,
    lease: current,
    nowMs: now + 1,
    retainRecentTokens: 1,
    keepArchiveCheckpoints: 1,
  });

  const paths = leaseLedgerArchivePaths(directory);
  const [archiveName] = await readdir(paths.archivesDir);
  const archivePath = path.join(paths.archivesDir, archiveName);
  const archive = JSON.parse(await readFile(archivePath, 'utf8'));
  archive.highestAllocatedToken += 100;
  await writeFile(archivePath, `${JSON.stringify(archive, null, 2)}\n`, 'utf8');

  await assert.rejects(
    () => readLeaseLedgerArchiveState({ directory }),
    expectCode('LEASE_LEDGER_ARCHIVE_CORRUPT'),
  );
});
