import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalHash, createWorld } from '../src/core/state.js';
import { processEvent } from '../src/core/world.js';
import { compactWorkingMemory } from '../src/memory/compaction.js';
import {
  atomicSnapshotPaths,
  inspectAtomicSnapshotStore,
  loadAtomicWorldSnapshot,
  saveAtomicWorldSnapshot,
  serializeAtomicSnapshotEnvelope,
  validateAtomicSnapshotText,
} from '../src/persistence/atomic-store.js';
import { inspectCheckpointBarrier } from '../src/persistence/checkpoint.js';
import { saveLeasedAtomicWorldSnapshot } from '../src/persistence/leased-checkpoint.js';
import {
  acquireWriterLease,
  assertWriterLease,
  inspectWriterLeaseStore,
  releaseWriterLease,
  renewWriterLease,
  writerLeasePaths,
} from '../src/persistence/writer-lease.js';

async function makeDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'axm-echoworld-writer-lease-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function expectCode(code) {
  return (error) => {
    assert.equal(error?.code, code);
    return true;
  };
}

function moveWorld(eventId) {
  const world = createWorld({ memoryEnabled: true });
  const result = processEvent(world, {
    eventId,
    type: 'MOVE',
    actorId: 'A',
    x: 2,
    y: 1,
    rare: true,
  });
  assert.equal(result.committed, true);
  return world;
}

test('one active writer lease blocks a second cooperative writer', async (t) => {
  const directory = await makeDirectory(t);
  const lease = await acquireWriterLease({
    directory,
    writerId: 'writer-a',
    nowMs: 1_000,
    leaseDurationMs: 1_000,
  });

  await assert.rejects(
    () => acquireWriterLease({
      directory,
      writerId: 'writer-b',
      nowMs: 1_001,
      leaseDurationMs: 1_000,
    }),
    expectCode('WRITER_LEASE_HELD'),
  );
  const assertion = await assertWriterLease({ directory, lease, nowMs: 1_500 });
  assert.equal(assertion.status, 'CURRENT_OWNER');
  assert.equal(assertion.fencingToken, 1);
});

test('simultaneous cooperative claims elect exactly one active writer', async (t) => {
  const directory = await makeDirectory(t);
  const results = await Promise.allSettled([
    acquireWriterLease({ directory, writerId: 'writer-a', nowMs: 2_000, leaseDurationMs: 1_000 }),
    acquireWriterLease({ directory, writerId: 'writer-b', nowMs: 2_000, leaseDurationMs: 1_000 }),
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  const inspection = await inspectWriterLeaseStore({ directory, nowMs: 2_001 });
  assert.ok(inspection.active);
  assert.equal(
    inspection.active.fencingToken,
    results.find((item) => item.status === 'fulfilled').value.fencingToken,
  );
});

test('release permits immediate acquisition with a strictly higher fencing token', async (t) => {
  const directory = await makeDirectory(t);
  const first = await acquireWriterLease({
    directory,
    writerId: 'writer-a',
    nowMs: 3_000,
    leaseDurationMs: 1_000,
  });
  const released = await releaseWriterLease({ directory, lease: first, nowMs: 3_010 });
  const second = await acquireWriterLease({
    directory,
    writerId: 'writer-b',
    nowMs: 3_011,
    leaseDurationMs: 1_000,
  });

  assert.equal(released.status, 'RELEASED');
  assert.ok(second.fencingToken > first.fencingToken);
});

test('heartbeat renewal extends ownership and later stale takeover fences the old writer', async (t) => {
  const directory = await makeDirectory(t);
  const first = await acquireWriterLease({
    directory,
    writerId: 'writer-a',
    nowMs: 4_000,
    leaseDurationMs: 100,
  });
  const renewed = await renewWriterLease({
    directory,
    lease: first,
    nowMs: 4_050,
    leaseDurationMs: 200,
  });

  await assert.rejects(
    () => acquireWriterLease({
      directory,
      writerId: 'writer-b',
      nowMs: 4_150,
      leaseDurationMs: 100,
    }),
    expectCode('WRITER_LEASE_HELD'),
  );

  const second = await acquireWriterLease({
    directory,
    writerId: 'writer-b',
    nowMs: 4_300,
    leaseDurationMs: 100,
  });
  assert.ok(second.fencingToken > renewed.fencingToken);
  await assert.rejects(
    () => assertWriterLease({ directory, lease: renewed, nowMs: 4_300 }),
    expectCode('WRITER_FENCED'),
  );
});

test('an invalid burned claim cannot become active and the next token remains monotonic', async (t) => {
  const directory = await makeDirectory(t);
  await inspectWriterLeaseStore({ directory, nowMs: 5_000 });
  const paths = writerLeasePaths(directory);
  await writeFile(
    path.join(paths.claimsDir, 'claim-00000000000000000001.json'),
    '{"schema":"corrupt"}',
    'utf8',
  );

  const lease = await acquireWriterLease({
    directory,
    writerId: 'writer-valid',
    nowMs: 5_001,
    leaseDurationMs: 1_000,
  });
  const inspection = await inspectWriterLeaseStore({ directory, nowMs: 5_002 });

  assert.equal(lease.fencingToken, 2);
  assert.equal(inspection.active.fencingToken, 2);
  assert.ok(inspection.invalidRecords.some((item) => item.name.includes('00000000000000000001')));
});

test('leased checkpoint embeds fencing evidence and advances the lease base', async (t) => {
  const directory = await makeDirectory(t);
  const lease = await acquireWriterLease({
    directory,
    writerId: 'checkpoint-writer',
    nowMs: 6_000,
    leaseDurationMs: 10_000,
  });
  const first = await saveLeasedAtomicWorldSnapshot({
    directory,
    world: createWorld(),
    lease,
    clock: () => 6_001,
  });
  const second = await saveLeasedAtomicWorldSnapshot({
    directory,
    world: moveWorld('LEASED_SECOND_MOVE'),
    lease: first.nextLease,
    clock: () => 6_002,
  });
  const loaded = await loadAtomicWorldSnapshot({ directory });

  assert.equal(first.generation, 1);
  assert.equal(first.checkpoint.fencingToken, lease.fencingToken);
  assert.equal(first.checkpoint.admittedBaseGeneration, 0);
  assert.equal(first.checkpoint.admittedBaseSnapshotId, null);
  assert.equal(second.generation, 2);
  assert.equal(second.parentSnapshotId, first.snapshotId);
  assert.equal(second.checkpoint.admittedBaseSnapshotId, first.snapshotId);
  assert.equal(second.nextLease.baseSnapshotId, second.snapshotId);
  assert.equal(loaded.checkpoint.fencingToken, lease.fencingToken);
  assert.equal(loaded.world.actors.A.x, 2);
});

test('a stale checkpoint base is rejected even while the same lease remains current', async (t) => {
  const directory = await makeDirectory(t);
  const lease = await acquireWriterLease({
    directory,
    writerId: 'base-writer',
    nowMs: 7_000,
    leaseDurationMs: 10_000,
  });
  await saveLeasedAtomicWorldSnapshot({
    directory,
    world: createWorld(),
    lease,
    clock: () => 7_001,
  });

  await assert.rejects(
    () => saveLeasedAtomicWorldSnapshot({
      directory,
      world: moveWorld('STALE_BASE_MOVE'),
      lease,
      clock: () => 7_002,
    }),
    expectCode('CHECKPOINT_BASE_CHANGED'),
  );
});

test('a stale owner cannot checkpoint after a higher fencing token takes over', async (t) => {
  const directory = await makeDirectory(t);
  const first = await acquireWriterLease({
    directory,
    writerId: 'stale-writer',
    nowMs: 8_000,
    leaseDurationMs: 100,
  });
  const committed = await saveLeasedAtomicWorldSnapshot({
    directory,
    world: createWorld(),
    lease: first,
    clock: () => 8_001,
    renewForMs: 100,
  });
  const second = await acquireWriterLease({
    directory,
    writerId: 'replacement-writer',
    nowMs: 8_200,
    leaseDurationMs: 1_000,
  });

  await assert.rejects(
    () => saveLeasedAtomicWorldSnapshot({
      directory,
      world: moveWorld('FENCED_MOVE'),
      lease: committed.nextLease,
      clock: () => 8_201,
      renewForMs: 100,
    }),
    expectCode('WRITER_FENCED'),
  );
  const loaded = await loadAtomicWorldSnapshot({ directory });
  assert.equal(loaded.generation, 1);
  assert.equal(loaded.world.actors.A.x, 1);
  assert.ok(second.fencingToken > first.fencingToken);
});

test('checkpoint barrier rejects an unquiesced receiving cell', async (t) => {
  const directory = await makeDirectory(t);
  const lease = await acquireWriterLease({
    directory,
    writerId: 'barrier-writer',
    nowMs: 9_000,
    leaseDurationMs: 1_000,
  });
  const world = createWorld();
  world.cells.C_2_2.wakeState = 'ACTIVE';
  const barrier = inspectCheckpointBarrier(world);

  assert.equal(barrier.admitted, false);
  assert.equal(barrier.reason, 'UNQUIESCED_CELL');
  await assert.rejects(
    () => saveLeasedAtomicWorldSnapshot({
      directory,
      world,
      lease,
      clock: () => 9_001,
    }),
    expectCode('CHECKPOINT_BARRIER_REJECTED'),
  );
  const inspection = await inspectAtomicSnapshotStore({ directory });
  assert.equal(inspection.anyExisting, false);
});

test('checkpoint operational hash covers pending queues, mailboxes, and compaction journals', async (t) => {
  const directory = await makeDirectory(t);
  const lease = await acquireWriterLease({
    directory,
    writerId: 'operational-writer',
    nowMs: 10_000,
    leaseDurationMs: 5_000,
  });
  const world = createWorld({ memoryEnabled: true });
  const cell = world.cells.C_2_2;
  cell.memory.working = Array.from({ length: 20 }, (_, index) => ({
    eventId: `CHECKPOINT_MEMORY_${index}`,
    eventClass: 'OBSERVED_SOUND',
    actorId: null,
    revision: index,
    importance: 5,
    provenanceClass: 'OBSERVED',
  }));
  compactWorkingMemory(world, cell, { interruptAt: 'AFTER_PREPARE' });
  world.handoffState.schedulerJobs.S1 = {
    schedulerId: 'S1',
    baseRevision: 0,
    status: 'PENDING',
    processArrivals: true,
    deferredEpoch: 0,
    queue: [{
      eventId: 'QUEUE_1',
      causalEventId: 'CAUSE_1',
      senderCellId: 'C_2_1',
      recipientCellId: 'C_2_2',
      causalDepth: 1,
      hopLimit: 2,
    }],
  };
  world.handoffState.deferredMailboxes.C_3_3 = [{
    schedulerId: 'S1',
    handoff: {
      eventId: 'MAIL_1',
      causalEventId: 'CAUSE_2',
      recipientCellId: 'C_3_3',
    },
    retryCount: 0,
    maxRetries: 3,
    deferredAtEpoch: 0,
    expiresAtEpoch: 8,
  }];

  const saved = await saveLeasedAtomicWorldSnapshot({
    directory,
    world,
    lease,
    clock: () => 10_001,
  });
  const loaded = await loadAtomicWorldSnapshot({ directory });

  assert.equal(saved.checkpoint.operationalCounts.schedulerJobs, 1);
  assert.equal(saved.checkpoint.operationalCounts.queuedHandoffs, 1);
  assert.equal(saved.checkpoint.operationalCounts.deferredHandoffs, 1);
  assert.equal(saved.checkpoint.operationalCounts.pendingCompactions, 1);
  assert.equal(loaded.world.cells.C_2_2.memory.pendingCompaction, null);
  assert.equal(canonicalHash(loaded.world), saved.canonicalHash);
});

test('checkpoint tampering invalidates the deterministic snapshot identity', async (t) => {
  const directory = await makeDirectory(t);
  const lease = await acquireWriterLease({
    directory,
    writerId: 'tamper-writer',
    nowMs: 11_000,
    leaseDurationMs: 5_000,
  });
  await saveLeasedAtomicWorldSnapshot({
    directory,
    world: createWorld(),
    lease,
    clock: () => 11_001,
  });
  const primaryPath = atomicSnapshotPaths(directory).primary;
  const envelope = JSON.parse(await readFile(primaryPath, 'utf8'));
  envelope.checkpoint.fencingToken += 1;
  const validation = validateAtomicSnapshotText(serializeAtomicSnapshotEnvelope(envelope));

  assert.equal(validation.valid, false);
  assert.equal(validation.reason, 'SNAPSHOT_ID_MISMATCH');
});

test('new fencing token discards an older leased temp that never reached primary commit', async (t) => {
  const directory = await makeDirectory(t);
  const lease = await acquireWriterLease({
    directory,
    writerId: 'temp-writer',
    nowMs: 12_000,
    leaseDurationMs: 100,
  });
  const first = await saveLeasedAtomicWorldSnapshot({
    directory,
    world: createWorld(),
    lease,
    clock: () => 12_001,
    renewForMs: 100,
  });

  await assert.rejects(
    () => saveLeasedAtomicWorldSnapshot({
      directory,
      world: moveWorld('FENCED_TEMP_MOVE'),
      lease: first.nextLease,
      clock: () => 12_002,
      renewForMs: 100,
      onStage(stage) {
        if (stage === 'AFTER_TEMP_FSYNC') throw new Error('leave fenced temp');
      },
    }),
    /leave fenced temp/,
  );
  const paths = atomicSnapshotPaths(directory);
  assert.equal((await readFile(paths.temp, 'utf8')).includes('FENCED_TEMP_MOVE'), true);

  const replacement = await acquireWriterLease({
    directory,
    writerId: 'replacement-writer',
    nowMs: 12_200,
    leaseDurationMs: 1_000,
  });
  const inspection = await inspectAtomicSnapshotStore({ directory });

  assert.equal(replacement.baseGeneration, 1);
  assert.equal(replacement.baseSnapshotId, first.snapshotId);
  assert.equal(inspection.candidates.find((item) => item.role === 'temp').exists, false);
});

test('lease expiry during save prevents primary installation and the next owner fences the temp', async (t) => {
  const directory = await makeDirectory(t);
  const lease = await acquireWriterLease({
    directory,
    writerId: 'expiring-writer',
    nowMs: 13_000,
    leaseDurationMs: 100,
  });
  let now = 13_001;

  await assert.rejects(
    () => saveLeasedAtomicWorldSnapshot({
      directory,
      world: createWorld(),
      lease,
      clock: () => now,
      renewForMs: 100,
      onStage(stage) {
        if (stage === 'AFTER_TEMP_FSYNC') now = 13_200;
      },
    }),
    expectCode('WRITER_LEASE_EXPIRED'),
  );
  const paths = atomicSnapshotPaths(directory);
  assert.equal((await readFile(paths.temp, 'utf8')).includes('checkpoint'), true);

  const replacement = await acquireWriterLease({
    directory,
    writerId: 'replacement-after-expiry',
    nowMs: 13_201,
    leaseDurationMs: 1_000,
  });
  assert.equal(replacement.baseGeneration, 0);
  assert.equal(replacement.baseSnapshotId, null);
  const inspection = await inspectAtomicSnapshotStore({ directory });
  assert.equal(inspection.anyExisting, false);
});

test('leased checkpoint refuses a durable base changed by a non-cooperating writer', async (t) => {
  const directory = await makeDirectory(t);
  const lease = await acquireWriterLease({
    directory,
    writerId: 'cooperative-writer',
    nowMs: 14_000,
    leaseDurationMs: 5_000,
  });
  await saveAtomicWorldSnapshot({ directory, world: createWorld() });

  await assert.rejects(
    () => saveLeasedAtomicWorldSnapshot({
      directory,
      world: moveWorld('NON_COOPERATIVE_BASE_MOVE'),
      lease,
      clock: () => 14_001,
    }),
    expectCode('CHECKPOINT_BASE_CHANGED'),
  );
});

for (const stage of ['AFTER_CLAIM_FSYNC', 'AFTER_ACTIVATION_FSYNC', 'AFTER_BASE_RECORD_FSYNC']) {
  test(`stale-owner recovery succeeds after process exit at ${stage}`, async (t) => {
    const directory = await makeDirectory(t);
    const worker = fileURLToPath(new URL('./fixtures/writer-lease-crash-worker.js', import.meta.url));
    const child = spawnSync(process.execPath, [worker, directory, 'acquire', stage], { encoding: 'utf8' });

    assert.equal(child.status, 86, `stdout=${child.stdout} stderr=${child.stderr}`);
    const replacement = await acquireWriterLease({
      directory,
      writerId: `replacement-${stage}`,
      nowMs: 15_200,
      leaseDurationMs: 1_000,
      provisionalDurationMs: 50,
    });
    assert.ok(replacement.fencingToken >= 2);
  });
}

test('process exit after durable release permits immediate replacement', async (t) => {
  const directory = await makeDirectory(t);
  const worker = fileURLToPath(new URL('./fixtures/writer-lease-crash-worker.js', import.meta.url));
  const child = spawnSync(
    process.execPath,
    [worker, directory, 'release', 'AFTER_RELEASE_FSYNC'],
    { encoding: 'utf8' },
  );

  assert.equal(child.status, 86, `stdout=${child.stdout} stderr=${child.stderr}`);
  const replacement = await acquireWriterLease({
    directory,
    writerId: 'replacement-after-release',
    nowMs: 15_001,
    leaseDurationMs: 1_000,
  });
  assert.ok(replacement.fencingToken >= 2);
});
