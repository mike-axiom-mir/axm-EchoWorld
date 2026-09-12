import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWorld } from '../src/core/state.js';
import { processEvent } from '../src/core/world.js';
import {
  checkpointSourceMutationEvidence,
  createImmutableCheckpointSession,
} from '../src/persistence/checkpoint-session.js';
import {
  acquirePlatformWriteLock,
  assertPlatformWriteLock,
  inspectPlatformWriteLock,
  releasePlatformWriteLock,
} from '../src/persistence/platform-lock.js';
import {
  loadAtomicWorldSnapshot,
} from '../src/persistence/atomic-store.js';
import { saveLeasedAtomicWorldSnapshot } from '../src/persistence/leased-checkpoint.js';
import {
  acquireWriterLease,
  assertWriterLease,
} from '../src/persistence/writer-lease.js';

async function makeDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'axm-echoworld-platform-lock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function expectCode(code) {
  return (error) => {
    assert.equal(error?.code, code);
    return true;
  };
}

test('platform lock excludes another writer and releases atomically', async (t) => {
  const directory = await makeDirectory(t);
  const first = await acquirePlatformWriteLock({
    directory,
    ownerId: 'owner-a',
    leaseId: 'lease-a',
    fencingToken: 1,
    logicalNowMs: 100,
    lockDurationMs: 100,
  });

  await assert.rejects(
    () => acquirePlatformWriteLock({
      directory,
      ownerId: 'owner-b',
      leaseId: 'lease-b',
      fencingToken: 2,
      logicalNowMs: 101,
      lockDurationMs: 100,
    }),
    expectCode('PLATFORM_LOCK_HELD'),
  );
  assert.equal(
    (await assertPlatformWriteLock({ directory, lock: first, logicalNowMs: 150 })).status,
    'CURRENT_OWNER',
  );
  assert.equal(
    (await releasePlatformWriteLock({ directory, lock: first, logicalNowMs: 150 })).status,
    'RELEASED',
  );

  const second = await acquirePlatformWriteLock({
    directory,
    ownerId: 'owner-b',
    leaseId: 'lease-b',
    fencingToken: 2,
    logicalNowMs: 151,
    lockDurationMs: 100,
  });
  assert.equal(second.fencingToken, 2);
});

test('expired platform lock can be atomically quarantined and replaced', async (t) => {
  const directory = await makeDirectory(t);
  const first = await acquirePlatformWriteLock({
    directory,
    ownerId: 'stale-owner',
    leaseId: 'stale-lease',
    fencingToken: 1,
    logicalNowMs: 200,
    lockDurationMs: 10,
  });
  const second = await acquirePlatformWriteLock({
    directory,
    ownerId: 'replacement-owner',
    leaseId: 'replacement-lease',
    fencingToken: 2,
    logicalNowMs: 211,
    lockDurationMs: 100,
  });

  assert.notEqual(second.lockId, first.lockId);
  await assert.rejects(
    () => assertPlatformWriteLock({ directory, lock: first, logicalNowMs: 212 }),
    expectCode('PLATFORM_LOCK_FENCED'),
  );
});

test('platform lock survives owner-process exit and becomes recoverable after logical expiry', async (t) => {
  const directory = await makeDirectory(t);
  const worker = fileURLToPath(new URL('./fixtures/platform-lock-crash-worker.js', import.meta.url));
  const child = spawnSync(process.execPath, [worker, directory, 'AFTER_LOCK_OWNER_FSYNC'], {
    encoding: 'utf8',
  });

  assert.equal(child.status, 86, `stdout=${child.stdout} stderr=${child.stderr}`);
  const before = await inspectPlatformWriteLock({ directory, logicalNowMs: 1_020 });
  assert.equal(before.active, true);
  const replacement = await acquirePlatformWriteLock({
    directory,
    ownerId: 'post-crash-owner',
    leaseId: 'post-crash-lease',
    fencingToken: 2,
    logicalNowMs: 1_051,
    lockDurationMs: 100,
  });
  assert.equal(replacement.fencingToken, 2);
});

test('immutable checkpoint session freezes a normalized world clone and detects source mutation', async () => {
  const world = createWorld({ memoryEnabled: true });
  const lease = {
    schema: 'axm.echoworld.writer-lease-handle/v0.01',
    writerId: 'session-writer',
    leaseId: 'session-lease',
    fencingToken: 1,
  };
  const session = createImmutableCheckpointSession({
    world,
    lease,
    baseGeneration: 0,
    baseSnapshotId: null,
    admittedAtMs: 2_000,
    admittedLogicalMs: 2_000,
    clockObservationId: 'LCO_session',
  });

  assert.equal(Object.isFrozen(session), true);
  assert.equal(Object.isFrozen(session.snapshotWorld), true);
  assert.equal(Object.isFrozen(session.snapshotWorld.cells.C_1_1), true);
  assert.equal(session.snapshotWorld.actors.A.x, 1);
  assert.throws(() => {
    session.snapshotWorld.actors.A.x = 99;
  }, TypeError);

  processEvent(world, {
    eventId: 'SOURCE_MUTATION_AFTER_SESSION',
    type: 'MOVE',
    actorId: 'A',
    x: 2,
    y: 1,
    rare: true,
  });
  const evidence = checkpointSourceMutationEvidence(session, world);
  assert.equal(evidence.sourceWorldMutatedAfterAdmission, true);
  assert.equal(session.snapshotWorld.actors.A.x, 1);
});

test('leased save commits the admitted immutable clone even when source world mutates afterward', async (t) => {
  const directory = await makeDirectory(t);
  const world = createWorld({ memoryEnabled: true });
  const lease = await acquireWriterLease({
    directory,
    writerId: 'immutable-save-writer',
    nowMs: 3_000,
    leaseDurationMs: 10_000,
  });

  const saved = await saveLeasedAtomicWorldSnapshot({
    directory,
    world,
    lease,
    clock: () => 3_001,
    onCheckpointSession() {
      processEvent(world, {
        eventId: 'MUTATE_SOURCE_AFTER_ADMISSION',
        type: 'MOVE',
        actorId: 'A',
        x: 2,
        y: 1,
        rare: true,
      });
    },
  });
  const loaded = await loadAtomicWorldSnapshot({ directory });

  assert.equal(saved.sourceMutation.sourceWorldMutatedAfterAdmission, true);
  assert.equal(world.actors.A.x, 2);
  assert.equal(loaded.world.actors.A.x, 1);
  assert.equal(loaded.checkpoint.checkpointSessionId, saved.checkpoint.checkpointSessionId);
});

test('lease clock rollback is rejected before lease assertion can grant authority', async (t) => {
  const directory = await makeDirectory(t);
  const lease = await acquireWriterLease({
    directory,
    writerId: 'rollback-writer',
    nowMs: 5_000,
    leaseDurationMs: 1_000,
  });
  await assertWriterLease({ directory, lease, nowMs: 5_100 });
  await assert.rejects(
    () => assertWriterLease({ directory, lease, nowMs: 5_050 }),
    expectCode('LEASE_CLOCK_ROLLBACK'),
  );
});
