import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalHash, createWorld, persistWorld, reloadWorld } from '../src/core/state.js';
import { processEvent, runScenario } from '../src/core/world.js';


test('memory-enabled and memory-disabled modes produce the same canonical truth hash', () => {
  const modeA = runScenario({ memoryEnabled: false });
  const modeB = runScenario({ memoryEnabled: true });

  assert.equal(canonicalHash(modeA), canonicalHash(modeB));
  assert.equal(modeA.receipts.memory.length, 0);
  assert.ok(modeB.receipts.memory.length > 0);
});


test('failed truth transition creates no memory and does not advance revision', () => {
  const world = createWorld({ memoryEnabled: true });
  const beforeHash = canonicalHash(world);

  const result = processEvent(world, {
    eventId: 'FAIL_MOVE',
    type: 'MOVE',
    actorId: 'A',
    x: 99,
    y: 99,
    structuralChange: true,
  });

  assert.equal(result.committed, false);
  assert.equal(world.revision, 0);
  assert.equal(world.receipts.memory.length, 0);
  assert.equal(world.receipts.truth.length, 0);
  assert.equal(canonicalHash(world), beforeHash);
});


test('specialist finish order cannot change canonical truth', () => {
  const natural = runScenario();
  const reversed = runScenario({
    specialistFinishOrder: ['sound', 'memory-importance', 'structural', 'material', 'movement', 'collision'],
  });

  assert.equal(canonicalHash(natural), canonicalHash(reversed));
});


test('persistence roundtrip preserves canonical truth', () => {
  const world = runScenario();
  const reloaded = reloadWorld(persistWorld(world));
  assert.equal(canonicalHash(world), canonicalHash(reloaded));
});
