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
  acquireWriterLease,
  archiveWriterLeaseLedger,
  releaseWriterLease,
  writerLeaseRecordPaths,
} from '../src/persistence/writer-lease.js';
import { leaseLedgerArchivePaths } from '../src/persistence/lease-ledger-archive.js';

function expectCode(code) {
  return (error) => {
    assert.equal(error?.code, code);
    return true;
  };
}

test('lease archival preserves invalid raw records instead of compacting them away', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'axm-echoworld-invalid-archive-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  let nowMs = 70_000;
  const damaged = await acquireWriterLease({
    directory,
    writerId: 'damaged-history-writer',
    nowMs,
    leaseDurationMs: 500,
  });
  nowMs += 10;
  await releaseWriterLease({ directory, lease: damaged, nowMs });

  nowMs += 10;
  const second = await acquireWriterLease({
    directory,
    writerId: 'second-closed-writer',
    nowMs,
    leaseDurationMs: 500,
  });
  nowMs += 10;
  await releaseWriterLease({ directory, lease: second, nowMs });

  nowMs += 10;
  const current = await acquireWriterLease({
    directory,
    writerId: 'current-writer',
    nowMs,
    leaseDurationMs: 5_000,
  });

  const damagedPaths = writerLeaseRecordPaths(directory, 'world', damaged.fencingToken);
  const activation = JSON.parse(await readFile(damagedPaths.activation, 'utf8'));
  activation.writerId = 'post-seal-tamper';
  const tamperedBytes = `${JSON.stringify(activation, null, 2)}\n`;
  await writeFile(damagedPaths.activation, tamperedBytes, 'utf8');

  await assert.rejects(
    () => archiveWriterLeaseLedger({
      directory,
      lease: current,
      nowMs: nowMs + 10,
      retainRecentTokens: 1,
      keepArchiveCheckpoints: 1,
    }),
    expectCode('LEASE_LEDGER_ARCHIVE_INVALID_RAW_RECORD'),
  );

  assert.equal(await readFile(damagedPaths.activation, 'utf8'), tamperedBytes);
  assert.ok((await readFile(damagedPaths.claim, 'utf8')).length > 0);
  assert.ok((await readFile(damagedPaths.release, 'utf8')).length > 0);
  assert.deepEqual(await readdir(leaseLedgerArchivePaths(directory).archivesDir), []);
});
