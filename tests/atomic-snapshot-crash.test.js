import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalHash, createWorld } from '../src/core/state.js';
import { processEvent } from '../src/core/world.js';
import { compactWorkingMemory } from '../src/memory/compaction.js';
import {
  inspectAtomicSnapshotStore,
  loadAtomicWorldSnapshot,
  recoverAtomicWorldSnapshot,
  saveAtomicWorldSnapshot,
} from '../src/persistence/atomic-store.js';

async function makeStoreDir(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'axm-echoworld-atomic-crash-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function advanceWorld(world, eventId) {
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

function seedPendingCompaction(world) {
  const cell = world.cells.C_2_2;
  cell.memory.working = Array.from({ length: 20 }, (_, index) => ({
    eventId: `ATOMIC_MEMORY_${index}`,
    eventClass: index % 2 === 0 ? 'OBSERVED_SOUND' : 'MOVE',
    actorId: index % 2 === 0 ? null : 'A',
    revision: index,
    importance: 5,
    provenanceClass: index % 2 === 0 ? 'OBSERVED' : 'CANONICAL',
  }));
  compactWorkingMemory(world, cell, { interruptAt: 'AFTER_WORKING_SWAP' });
  return cell.memory.pendingCompaction.compactionId;
}

const crashStages = [
  'AFTER_TEMP_WRITE',
  'AFTER_TEMP_FSYNC',
  'AFTER_BACKUP_RENAME',
  'AFTER_BACKUP_DIRECTORY_FSYNC',
  'AFTER_PRIMARY_RENAME',
  'AFTER_PRIMARY_DIRECTORY_FSYNC',
];

for (const crashStage of crashStages) {
  test(`abrupt process exit at ${crashStage} leaves a deterministically recoverable latest snapshot`, async (t) => {
    const directory = await makeStoreDir(t);
    await saveAtomicWorldSnapshot({ directory, world: createWorld() });

    const workerPath = fileURLToPath(
      new URL('./fixtures/atomic-store-crash-worker.js', import.meta.url),
    );
    const child = spawnSync(
      process.execPath,
      [workerPath, directory, 'world', crashStage],
      { encoding: 'utf8' },
    );

    assert.equal(
      child.status,
      86,
      `worker did not exit at ${crashStage}: stdout=${child.stdout} stderr=${child.stderr}`,
    );

    const recovered = await recoverAtomicWorldSnapshot({ directory });
    assert.equal(recovered.generation, 2);
    assert.equal(recovered.world.actors.A.x, 2);
    assert.equal(recovered.world.revision, 1);
    assert.equal(canonicalHash(recovered.world), recovered.canonicalHash);

    const inspection = await inspectAtomicSnapshotStore({ directory });
    assert.equal(inspection.selected.role, 'primary');
    assert.equal(inspection.selected.envelope.generation, 2);
  });
}

const recoveryCrashStages = [
  'AFTER_RECOVERY_TEMP_FSYNC',
  'AFTER_RECOVERY_PRIMARY_RENAME',
  'AFTER_RECOVERY_DIRECTORY_FSYNC',
];

for (const recoveryStage of recoveryCrashStages) {
  test(`abrupt process exit at ${recoveryStage} leaves recovery promotion restartable`, async (t) => {
    const directory = await makeStoreDir(t);
    await saveAtomicWorldSnapshot({ directory, world: createWorld() });
    const nextWorld = advanceWorld(createWorld(), `RECOVERY_${recoveryStage}`);

    await assert.rejects(
      () => saveAtomicWorldSnapshot({
        directory,
        world: nextWorld,
        onStage(stage) {
          if (stage === 'AFTER_TEMP_FSYNC') throw new Error('leave valid recovery temp candidate');
        },
      }),
      /leave valid recovery temp candidate/,
    );

    const workerPath = fileURLToPath(
      new URL('./fixtures/atomic-recovery-crash-worker.js', import.meta.url),
    );
    const child = spawnSync(
      process.execPath,
      [workerPath, directory, 'world', recoveryStage],
      { encoding: 'utf8' },
    );

    assert.equal(
      child.status,
      86,
      `recovery worker did not exit at ${recoveryStage}: stdout=${child.stdout} stderr=${child.stderr}`,
    );

    const recovered = await recoverAtomicWorldSnapshot({ directory });
    assert.equal(recovered.generation, 2);
    assert.equal(recovered.world.actors.A.x, 2);
    assert.equal(recovered.world.revision, 1);
    assert.equal(canonicalHash(recovered.world), recovered.canonicalHash);

    const inspection = await inspectAtomicSnapshotStore({ directory });
    assert.equal(inspection.selected.role, 'primary');
    assert.equal(inspection.selected.envelope.generation, 2);
  });
}

test('atomic snapshot loading also completes a persisted pending memory-compaction journal', async (t) => {
  const directory = await makeStoreDir(t);
  const world = createWorld({ memoryEnabled: true });
  const compactionId = seedPendingCompaction(world);
  const canonicalBefore = canonicalHash(world);

  await saveAtomicWorldSnapshot({ directory, world });
  const loaded = await loadAtomicWorldSnapshot({ directory });
  const cell = loaded.world.cells.C_2_2;

  assert.equal(cell.memory.pendingCompaction, null);
  assert.equal(cell.memory.lastCompactionId, compactionId);
  assert.equal(cell.memory.working.length, cell.memoryBudget.working);
  assert.ok(
    loaded.world.receipts.memoryCompactions.some(
      (receipt) => (
        receipt.compactionId === compactionId
        && ['COMMITTED', 'RECOVERED_COMMIT'].includes(receipt.status)
      ),
    ),
  );
  assert.equal(canonicalHash(loaded.world), canonicalBefore);
});
