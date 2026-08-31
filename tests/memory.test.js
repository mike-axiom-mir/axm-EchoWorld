import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorld } from '../src/core/state.js';
import { processEvent } from '../src/core/world.js';
import { matchSpecialists } from '../src/specialists/matcher.js';


test('bounded memory never exceeds declared budgets under repeated relevant traversal', () => {
  const world = createWorld({ memoryEnabled: true });

  for (let i = 0; i < 100; i += 1) {
    const x = i % 2 === 0 ? 2 : 1;
    processEvent(world, {
      eventId: `STEP_${i}`,
      type: 'MOVE',
      actorId: 'A',
      x,
      y: 1,
      rare: true,
    });
  }

  const cells = [world.cells.C_1_1, world.cells.C_2_1];
  for (const cell of cells) {
    assert.ok(cell.memory.working.length <= cell.memoryBudget.working);
    assert.ok(cell.memory.episodic.length <= cell.memoryBudget.episodic);
    assert.ok(cell.memory.compressed.length <= cell.memoryBudget.compressed);
    assert.ok(cell.memory.lineageRefs.length <= cell.memoryBudget.lineageRefs);
  }

  assert.ok(world.receipts.memory.some((receipt) => receipt.compaction));
});


test('specialist matcher selects only event-relevant contracts', () => {
  assert.deepEqual(matchSpecialists({ type: 'FIRE' }), [
    'material',
    'fire-propagation',
    'memory-importance',
    'sound',
    'witness-perception',
  ]);
  assert.equal(matchSpecialists({ type: 'FIRE' }).includes('trading'), false);
  assert.equal(matchSpecialists({ type: 'FIRE' }).includes('diplomacy'), false);
});


test('handoffs are bounded and do not directly mutate neighbors', () => {
  const world = createWorld({ memoryEnabled: true });
  const neighborBefore = JSON.stringify(world.cells.C_2_2.truthState);

  processEvent(world, {
    eventId: 'FIRE_1',
    type: 'FIRE',
    actorId: 'A',
    cellId: 'C_2_1',
    structuralChange: true,
    rare: true,
  });

  assert.ok(world.receipts.handoffs.length > 0);
  assert.ok(world.receipts.handoffs.every((handoff) => handoff.causalDepth <= handoff.hopLimit));
  assert.equal(JSON.stringify(world.cells.C_2_2.truthState), neighborBefore);
});
