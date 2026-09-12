import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/core/state.js';
import { acceptHandoff, neighborHandoffs, propagateAcceptedHandoff } from '../src/handoff/events.js';

test('duplicate handoff is rejected after first acceptance', () => {
  const world = createWorld();
  const [handoff] = neighborHandoffs(world, world.cells.C_2_1, { eventId: 'DUP_SOURCE', type: 'FIRE' });
  assert.equal(acceptHandoff(world, handoff).accepted, true);
  const duplicate = acceptHandoff(world, handoff);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, 'DUPLICATE_HANDOFF');
});

test('handoff cycle is rejected using causal path', () => {
  const world = createWorld();
  const cycle = {
    eventId: 'CYCLE_1',
    senderCellId: 'C_2_2',
    recipientCellId: 'C_2_1',
    originCellId: 'C_2_1',
    causalDepth: 2,
    hopLimit: 4,
    path: ['C_2_1', 'C_2_2'],
  };
  const receipt = acceptHandoff(world, cycle);
  assert.equal(receipt.accepted, false);
  assert.equal(receipt.reason, 'CYCLE_DETECTED');
});

test('handoff beyond hop limit is rejected', () => {
  const world = createWorld();
  const receipt = acceptHandoff(world, {
    eventId: 'TOO_DEEP',
    senderCellId: 'C_2_1',
    recipientCellId: 'C_2_2',
    originCellId: 'C_2_1',
    causalDepth: 3,
    hopLimit: 2,
    path: ['C_2_1'],
  });
  assert.equal(receipt.accepted, false);
  assert.equal(receipt.reason, 'HOP_LIMIT_EXCEEDED');
});

test('accepted handoff propagates only to terminal hop and never mutates truth directly', () => {
  const world = createWorld();
  const truthBefore = JSON.stringify(world.cells.C_2_2.truthState);
  const [handoff] = neighborHandoffs(
    world,
    world.cells.C_2_1,
    { eventId: 'PROP_1', type: 'FIRE' },
    { hopLimit: 2 },
  );
  const next = propagateAcceptedHandoff(world, handoff);
  assert.ok(next.length > 0);
  assert.ok(next.every((item) => item.causalDepth === 2 && item.causalDepth <= item.hopLimit));
  const terminal = next.find((item) => !(item.path ?? []).includes(item.recipientCellId));
  assert.ok(terminal);
  assert.deepEqual(propagateAcceptedHandoff(world, terminal), []);
  assert.equal(JSON.stringify(world.cells.C_2_2.truthState), truthBefore);
});
