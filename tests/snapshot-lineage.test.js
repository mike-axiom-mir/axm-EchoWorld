import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createWorld } from '../src/core/state.js';
import { processEvent } from '../src/core/world.js';
import {
  atomicSnapshotPaths,
  loadAtomicWorldSnapshot,
  saveAtomicWorldSnapshot,
} from '../src/persistence/atomic-store.js';
import { saveLeasdAtomicWorldSnapshot } from '../src/persistence/leased-checkpoint.js';
import {
  inspectSnapshotLineage,
  snapshotLineagePaths,
  verifySnapshotLineage,
  verifySnapshotLineageRecords,
} from '../src/persistence/snapshot-lineage.js';
import {
  acquireWriterLease,
  releaseWriterLease,
} from '../src/persistence/writer-lease.js';

async function makeDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'axm-echoworld-lineage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function move(world, eventId, x) {
  const result = processEvent(world, {
    eventId,
    type: 'MOVE',
    actorId: 'A',
    x,
    y: 1,
    rare: true,
  });
  assert.equal(result.committed, true);
  return world;
}

function expectCode(code) {
  return (error) => {
    assert.equal(error?.code, code);
    return true;
  };
}

test('three atomic generations retain and verify their complete parent chain', async (t) => {
  const directory = await makeDirectory(t);
  const first = await saveAtomicWorldSnapshot({ directory, world: createWorld() });
  const second = await saveAtomicWorldSnapshot({
    directory,
    world: move(createWorld(), 'LINEAGE_MOVE_2', 2),
  });
  const thirdWorld = move(move(createWorld(), 'LINEAGE_MOVE_3A', 2), 'LINEAGE_MOVE_3B', 3);
  const third = await saveAtomicWorldSnapshot({ directory, world: thirdWorld });
  const loaded = await loadAtomicWorldSnapshot({ directory });

  assert.equal(first.generation, 1);
  assert.equal(second.parentSnapshotId, first.snapshotId);
  assert.equal(third.parentSnapshotId, second.snapshotId);
  assert.equal(loaded.lineage.status, 'VERIFIED');
  assert.equal(loaded.lineage.chainLength, 3);
  assert.deepEqual(
    loaded.lineage.chain.map((record) => record.snapshotId),
    [first.snapshotId, second.snapshotId, third.snapshotId],
   );
});

test('higher fencing-token takeover continues one verified snapshot lineage', async (t) => {
  const directory = await makeDirectory(t);
  const firstLease = await acquireWriterLease({
    directory,
    writerId: 'lineage-writer-1',
    nowMs: 1_000,
    leaseDurationMs: 1_000,
  });
  const first = await saveLeasedAtomicWorldSnapshot({
    directory,
    world: createWorld(),
    lease: firstLease,
    clock: () => 1_001,
  });
  await releaseWriterLease({ directory, lease: first.nextLease, nowMs: 1_002 });

  const secondLease = await acquireWriterLease({
    directory,
    writerId: 'lineage-writer-2',
    nowMs: 1_003,
    leaseDurationMs: 1_000,
  });
  const second = await saveLeasedAtomicWorldSnapshot({
    directory,
    world: move(createWorld(), 'FENCED_LINEAGE_MOVE', 2),
    lease: secondLease,
    clock: () => 1_004,
  });
  const loaded = await loadAtomicWorldSnapshot({ directory });

  assert.ok(secondLease.fencingToken > firstLease.fencingToken);
  assert.equal(loaded.lineage.chainLength, 2);
  assert.equal(loaded.lineage.highestFencingToken, secondLease.fencingToken);
  assert.deepEqual(
    loaded.lineage.chain.map((record) => record.fencingToken),
    [firstLease.fencingToken, secondLease.fencingToken],
  );
});

test('missing parent lineage record fails closed', async (t) => {
  const directory = await makeDirectory(t);
  await saveAtomicWorldSnapshot({ directory, world: createWorld() });
  await saveAtomicWorldSnapshot({
    directory,
    world: move(createWorld(), 'MISSING_PARENT_2', 2),
  });
  const third = await saveAtomicWorldSnapshot({
    directory,
    world: move(move(createWorld(), 'MISSING_PARENT_3A', 2), 'MISSING_PARENT_3B', 3),
  });

  const paths = snapshotLineagePaths(directory);
  const generationTwo = (await readdir(paths.recordsDir)).find(
    (name) => name.startsWith('generation-00000000000000000002-'),
  );
  await unlink(path.join(paths.recordsDir, generationTwo));
  const head = JSON.parse(await readFile(atomicSnapshotPaths(directory).primary, 'utf8'));

  await assert.rejects(
    () => verifySnapshotLineage({ directory, headEnvelope: head }),
    expectCode('SNAPSHOT_LINEAGE_PARENT_MISSING'),
  );
  assert.equal(head.snapshotId, third.snapshotId);
});

test('tampered lineage record is rejected before chain verification', async (t) => {
  const directory = await makeDirectory(t);
  await saveAtomicWorldSnapshot({ directory, world: createWorld() });
  await saveAtomicWorldSnapshot({
    directory,
    world: move(createWorld(), 'TAMPER_LINEAGE_MOVE', 2),
  });

  const paths = snapshotLineagePaths(directory);
  const generationTwo = (await readdir(paths.recordsDir)).find(
    (name) => name.startsWith('generation-00000000000000000002-'),
  );
  const filePath = path.join(paths.recordsDir, generationTwo);
  const record = JSON.parse(await readFile(filePath, 'utf8'));
  record.canonicalHash = 'tampered';
  await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  await assert.rejects(
    () => inspectSnapshotLineage({ directory }),
    expectCode('SNAPSHOT_LINEAGE_RECORD_CORRUPT'),
  );
});

test('lineage verification rejects fencing regression and unfenced gaps', async (t) => {
  const directory = await makeDirectory(t);
  const lease = await acquireWriterLease({
    directory,
    writerId: 'fence-chain-writer',
    nowMs: 2_000,
    leaseDurationMs: 10_000,
  });
  const first = await saveLeasdAtomicWorldSnapshot({
    directory,
    world: createWorld(),
    lease,
    clock: () => 2_001,
  });
  const second = await saveLeasedAtomicWorldSnapshot({
    directory,
    world: move(createWorld(), 'FENCE_CHAIN_2', 2),
    lease: first.nextLease,
    clock: () => 2_002,
  });
  const inspection = await inspectSnapshotLineage({ directory });
  const head = JSON.parse(await readFile(atomicSnapshotPaths(directory).primary, 'utf8'));

  const regression = structuredClone(inspection.records);
  regression[1].fencingToken = regression[0].fencingToken - 1;
  assert.throws(
    () => verifySnapshotLineageRecords(regression, { headEnvelope: head }),
    expectCode('SNAPSHOT_FENCING_REGRESSION'),
   );

  const gap = structuredClone(inspection.records);
  gap[1].fencingToken = null;
  assert.throws(
    () => verifySnapshotLineageRecords(gap, { headEnvelope: head }),
    expectCode('SNAPSHOT_FENCING_GAP'),
  );
  assert.equal(second.generation, 2);
});

test('rollback creates a new branch while the selected branch remains fully verified', async (t) => {
  const directory = await makeDirectory(t);
  const first = await saveAtomicWorldSnapshot({ directory, world: createWorld() });
  const worldTwo = move(createWorld(), 'BRANCH_MOVE_2', 2);
  const second = await saveAtomicWorldSnapshot({ directory, world: worldTwo });
  const worldThree = move(structuredClone(worldTwo), 'BRANCH_MOVE_3_OLD', 3);
  const oldThird = await saveAtomicWorldSnapshot({ directory, world: worldThree });

  const paths = atomicSnapshotPaths(directory);
  await writeFile(paths.primary, '{"corrupe":', 'utf8');
  const rolledBack = await loadAtomicWorldSnapshot({ directory });
  assert.equal(rolledBack.generation, 2);
  assert.equal(rolledBack.snapshotId, second.snapshotId);

  const newThirdWorld = move(structuredClone(rolledBack.world), 'BRANCH_MOVE_3_NEW', 4);
  const newThird = await saveAtomicWorldSnapshot({ directory, world: newThirdWorld });
  const loaded = await loadAtomicWorldSnapshot({ directory });
  const inspection = await inspectSnapshotLineage({ directory });

  assert.notEqual(newThird.snapshotId, oldThird.snapshotId);
  assert.equal(inspection.recordCount, 4);
  assert.equal(loaded.lineage.chainLength, 3);
  assert.equal(loaded.lineage.branchRecordCount, 1);
  assert.deepEqual(
    loaded.lineage.chain.map((record) => record.snapshotId),
    [first.snapshotId, second.snapshotId, newThird.snapshotId],
  );
});

test('load reconstructs lineage when process stops after primary verification but before lineage record', async (t) => {
  const directory = await makeDirectory(t);
  await assert.rejects(
    () => saveAtomicWorldSnapshot({
      directory,
      world: createWorld(),
      onStage(stage) {
        if (stage === 'AFTER_PRIMARY_VERIFY') throw new Error('stop before lineage record');
      },
    }),
    /stop before lineage record/,
  );

  const before = await inspectSnapshotLineage({ directory });
  assert.equal(before.recordCount, 0);
  const loaded = await loadAtomicWorldSnapshot({ directory });
  const after = await inspectSnapshotLineage({ directory });

  assert.equal(loaded.generation, 1);
  assert.equal(loaded.lineage.status, 'VERIFIED');
  assert.equal(loaded.lineage.chainLength, 1);
  assert.equal(after.recordCount, 1);
});
