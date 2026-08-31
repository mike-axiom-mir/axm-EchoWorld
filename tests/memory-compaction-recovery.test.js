import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalHash,
  createWorld,
  persistWorld,
  reloadWorld,
} from '../src/core/state.js';
import {
  compactWorkingMemory,
  MEMORY_COMPACTION_INTERRUPT_POINTS,
  recoverPendingMemoryCompactions,
} from '../src/memory/compaction.js';

function seedCompactionWorld() {
  const world = createWorld({ memoryEnabled: true });
  const cell = world.cells.C_2_2;
  cell.memory.working = Array.from({ length: 20 }, (_, index) => ({
    eventId: `SEED_${index}`,
    eventClass: index % 2 === 0 ? 'OBSERVED_SOUND' : 'MOVE',
    actorId: index % 2 === 0 ? null : 'A',
    revision: index,
    importance: 5,
    provenanceClass: index % 2 === 0 ? 'OBSERVED' : 'CANONICAL',
  }));
  cell.memory.compressed = [{
    provenanceClass: 'CANONICAL',
    eventClass: 'MOVE',
    actorId: 'A',
    count: 2,
    firstRevision: -2,
    lastRevision: -1,
  }];
  return world;
}

function semanticCount(cell) {
  return cell.memory.working.length + cell.memory.compressed.reduce(
    (total, summary) => total + Number(summary.count ?? 0),
    0,
  );
}

function finalCompactionReceipts(world, compactionId) {
  return world.receipts.memoryCompactions.filter(
    (receipt) => (
      receipt.compactionId === compactionId
      && ['COMMITTED', 'RECOVERED_COMMIT'].includes(receipt.status)
    ),
  );
}

test('copy-on-write compaction preserves semantic count and declared budgets', () => {
  const world = seedCompactionWorld();
  const cell = world.cells.C_2_2;
  const beforeCount = semanticCount(cell);
  const canonicalBefore = canonicalHash(world);

  const receipt = compactWorkingMemory(world, cell);

  assert.equal(receipt.status, 'COMMITTED');
  assert.equal(cell.memory.working.length, cell.memoryBudget.working);
  assert.ok(cell.memory.compressed.length <= cell.memoryBudget.compressed);
  assert.equal(semanticCount(cell), beforeCount);
  assert.equal(cell.memory.pendingCompaction, null);
  assert.equal(cell.memory.compactionGeneration, 1);
  assert.equal(cell.memory.lastCompactionId, receipt.compactionId);
  assert.equal(finalCompactionReceipts(world, receipt.compactionId).length, 1);
  assert.equal(canonicalHash(world), canonicalBefore);
});

for (const interruptionPoint of MEMORY_COMPACTION_INTERRUPT_POINTS) {
  test(`reload recovers compaction interrupted at ${interruptionPoint}`, () => {
    const uninterrupted = seedCompactionWorld();
    const uninterruptedCell = uninterrupted.cells.C_2_2;
    const beforeCount = semanticCount(uninterruptedCell);
    compactWorkingMemory(uninterrupted, uninterruptedCell);

    const interrupted = seedCompactionWorld();
    const interruptedCell = interrupted.cells.C_2_2;
    const canonicalBefore = canonicalHash(interrupted);
    const interruption = compactWorkingMemory(interrupted, interruptedCell, {
      interruptAt: interruptionPoint,
    });
    const compactionId = interruption.compactionId;

    assert.equal(interruption.status, 'INTERRUPTED');
    assert.ok(interruptedCell.memory.pendingCompaction);

    const reloaded = reloadWorld(persistWorld(interrupted));
    const recoveredCell = reloaded.cells.C_2_2;

    assert.deepEqual(recoveredCell.memory.working, uninterruptedCell.memory.working);
    assert.deepEqual(recoveredCell.memory.compressed, uninterruptedCell.memory.compressed);
    assert.equal(semanticCount(recoveredCell), beforeCount);
    assert.equal(recoveredCell.memory.pendingCompaction, null);
    assert.equal(recoveredCell.memory.lastCompactionId, compactionId);
    assert.equal(finalCompactionReceipts(reloaded, compactionId).length, 1);
    assert.equal(canonicalHash(reloaded), canonicalBefore);
  });
}

test('recovery is idempotent after interrupted compaction has been repaired', () => {
  const world = seedCompactionWorld();
  compactWorkingMemory(world, world.cells.C_2_2, { interruptAt: 'AFTER_WORKING_SWAP' });

  const reloaded = reloadWorld(persistWorld(world));
  const receiptCount = reloaded.receipts.memoryCompactions.length;
  const memorySnapshot = structuredClone(reloaded.cells.C_2_2.memory);

  assert.deepEqual(recoverPendingMemoryCompactions(reloaded), []);
  assert.equal(reloaded.receipts.memoryCompactions.length, receiptCount);
  assert.deepEqual(reloaded.cells.C_2_2.memory, memorySnapshot);
});

test('corrupted after-image rolls back to the complete before-image without fake memory', () => {
  const world = seedCompactionWorld();
  const cell = world.cells.C_2_2;
  const beforeMemory = structuredClone(cell.memory);
  const canonicalBefore = canonicalHash(world);

  compactWorkingMemory(world, cell, { interruptAt: 'AFTER_PREPARE' });
  cell.memory.pendingCompaction.after.working.push({ eventId: 'FAKE_MEMORY' });

  const reloaded = reloadWorld(persistWorld(world));
  const recoveredCell = reloaded.cells.C_2_2;

  assert.deepEqual(recoveredCell.memory.working, beforeMemory.working);
  assert.deepEqual(recoveredCell.memory.compressed, beforeMemory.compressed);
  assert.equal(recoveredCell.memory.pendingCompaction, null);
  assert.equal(recoveredCell.memory.compactionRepairRequired, false);
  assert.equal(
    recoveredCell.memory.working.some((record) => record.eventId === 'FAKE_MEMORY'),
    false,
  );
  assert.ok(
    reloaded.receipts.memoryCompactions.some(
      (receipt) => receipt.status === 'RECOVERED_ROLLBACK_CORRUPT_AFTER',
    ),
  );
  assert.equal(canonicalHash(reloaded), canonicalBefore);
});

test('corrupted before-image fails closed in explicit REPAIR state', () => {
  const world = seedCompactionWorld();
  const cell = world.cells.C_2_2;
  const canonicalBefore = canonicalHash(world);

  compactWorkingMemory(world, cell, { interruptAt: 'AFTER_PREPARE' });
  cell.memory.pendingCompaction.before.working.push({ eventId: 'CORRUPT_BEFORE' });

  const reloaded = reloadWorld(persistWorld(world));
  const repairCell = reloaded.cells.C_2_2;
  const failureReceiptCount = reloaded.receipts.memoryCompactions.filter(
    (receipt) => receipt.status === 'RECOVERY_FAILED_CORRUPT_BEFORE',
  ).length;

  assert.ok(repairCell.memory.pendingCompaction);
  assert.equal(repairCell.memory.compactionRepairRequired, true);
  assert.equal(repairCell.wakeState, 'REPAIR');
  assert.throws(
    () => compactWorkingMemory(reloaded, repairCell),
    /MEMORY_COMPACTION_REPAIR_REQUIRED/,
  );
  assert.equal(canonicalHash(reloaded), canonicalBefore);

  const secondReload = reloadWorld(persistWorld(reloaded));
  assert.equal(
    secondReload.receipts.memoryCompactions.filter(
      (receipt) => receipt.status === 'RECOVERY_FAILED_CORRUPT_BEFORE',
    ).length,
    failureReceiptCount,
  );
});

test('compaction never merges CANONICAL and OBSERVED provenance classes', () => {
  const world = createWorld({ memoryEnabled: true });
  const cell = world.cells.C_2_2;
  cell.memoryBudget.working = 2;
  cell.memory.working = [
    { eventId: 'C1', eventClass: 'MOVE', actorId: 'A', revision: 1, provenanceClass: 'CANONICAL' },
    { eventId: 'O1', eventClass: 'MOVE', actorId: 'A', revision: 2, provenanceClass: 'OBSERVED' },
    { eventId: 'C2', eventClass: 'MOVE', actorId: 'A', revision: 3, provenanceClass: 'CANONICAL' },
    { eventId: 'O2', eventClass: 'MOVE', actorId: 'A', revision: 4, provenanceClass: 'OBSERVED' },
  ];

  compactWorkingMemory(world, cell);

  assert.equal(cell.memory.compressed.length, 2);
  assert.deepEqual(
    cell.memory.compressed.map((summary) => summary.provenanceClass).sort(),
    ['CANONICAL', 'OBSERVED'],
  );
});
