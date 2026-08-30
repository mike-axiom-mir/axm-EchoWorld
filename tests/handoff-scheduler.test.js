import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalHash, createWorld, persistWorld, reloadWorld } from '../src/core/state.js';
import { processEvent, runScenario } from '../src/core/world.js';
import { acceptHandoff, neighborHandoffs } from '../src/handoff/events.js';
import { resumeHandoffScheduler, runHandoffScheduler } from '../src/handoff/scheduler.js';

function permutations(values) {
  if (values.length <= 1) return [values];
  const result = [];
  for (let index = 0; index < values.length; index += 1) {
    const head = values[index];
    const tail = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const rest of permutations(tail)) result.push([head, ...rest]);
  }
  return result;
}

function centerSignal(world, eventId, hopLimit) {
  const x = Math.floor(world.width / 2);
  const y = Math.floor(world.height / 2);
  return neighborHandoffs(
    world,
    world.cells[`C_${x}_${y}`],
    { eventId, type: 'FIRE' },
    { hopLimit },
  );
}

test('queued handoff scheduling is deterministic across every initial four-way order', () => {
  const baselineWorld = createWorld({ width: 9, height: 9 });
  const baselineInitial = centerSignal(baselineWorld, 'QUEUE_ORDER', 5);
  const baseline = runHandoffScheduler(baselineWorld, baselineInitial, {
    maxProcessed: 512,
    maxQueueSize: 512,
  });

  for (const order of permutations([0, 1, 2, 3])) {
    const world = createWorld({ width: 9, height: 9 });
    const initial = centerSignal(world, 'QUEUE_ORDER', 5);
    const receipt = runHandoffScheduler(
      world,
      order.map((index) => initial[index]),
      {
        maxProcessed: 512,
        maxQueueSize: 512,
      },
    );

    assert.deepEqual(receipt, baseline);
    assert.deepEqual(world.handoffState, baselineWorld.handoffState);
    assert.deepEqual(world.receipts.handoffGuards, baselineWorld.receipts.handoffGuards);
  }
});

test('scheduler drains a bounded signal without changing canonical truth', () => {
  const world = createWorld({ width: 7, height: 7 });
  const before = canonicalHash(world);
  const initial = centerSignal(world, 'FINITE_WAVE', 6);

  const receipt = runHandoffScheduler(world, initial, {
    maxProcessed: 512,
    maxQueueSize: 512,
  });

  assert.equal(receipt.status, 'DRAINED');
  assert.equal(receipt.remainingQueueCount, 0);
  assert.equal(receipt.cumulative.droppedByQueueBudget, 0);
  assert.equal(receipt.canonicalMutationApplied, false);
  assert.equal(receipt.canonicalHashBefore, before);
  assert.equal(receipt.canonicalHashAfter, before);
  assert.ok(receipt.cumulative.acceptedCount > 0);
  assert.ok(receipt.cumulative.acceptedCount <= (world.width * world.height) - 1);
});

test('scheduler fails closed with an explicit receipt when work budget is exhausted', () => {
  const world = createWorld({ width: 16, height: 16 });
  const before = canonicalHash(world);
  const initial = centerSignal(world, 'BUDGET_WAVE', 12);

  const receipt = runHandoffScheduler(world, initial, {
    maxProcessed: 3,
    maxQueueSize: 512,
  });

  assert.equal(receipt.status, 'BUDGET_EXHAUSTED');
  assert.equal(receipt.run.processedCount, 3);
  assert.ok(receipt.remainingQueueCount > 0);
  assert.equal(receipt.canonicalMutationApplied, false);
  assert.equal(canonicalHash(world), before);
});

test('queue-capacity overflow is explicit and can never report a clean drain', () => {
  const world = createWorld({ width: 9, height: 9 });
  const before = canonicalHash(world);
  const initial = centerSignal(world, 'QUEUE_CAPACITY', 5);

  const receipt = runHandoffScheduler(world, initial, {
    maxProcessed: 512,
    maxQueueSize: 2,
  });

  assert.equal(receipt.status, 'BUDGET_EXHAUSTED');
  assert.ok(receipt.cumulative.droppedByQueueBudget > 0);
  assert.ok(receipt.cumulative.prequeueReasons.QUEUE_BUDGET_EXCEEDED > 0);
  assert.equal(receipt.canonicalMutationApplied, false);
  assert.equal(canonicalHash(world), before);
});

test('same causal signal cannot be accepted twice at one recipient cell', () => {
  const world = createWorld();
  const common = {
    causalEventId: 'CAUSE_1',
    originCellId: 'C_2_1',
    senderCellId: 'C_2_1',
    recipientCellId: 'C_2_2',
    type: 'SOUND',
    sourceRevision: 0,
    causalDepth: 1,
    hopLimit: 3,
    path: ['C_2_1'],
  };

  assert.equal(acceptHandoff(world, { ...common, eventId: 'ARRIVAL_A' }).accepted, true);
  const second = acceptHandoff(world, { ...common, eventId: 'ARRIVAL_B' });
  assert.equal(second.accepted, false);
  assert.equal(second.reason, 'DUPLICATE_CAUSAL_ARRIVAL');
});

test('processEvent can explicitly drain its emitted handoff queue', () => {
  const world = createWorld({ memoryEnabled: true });
  const beforeNeighbor = JSON.stringify(world.cells.C_2_2.truthState);

  const result = processEvent(
    world,
    {
      eventId: 'FIRE_WITH_QUEUE',
      type: 'FIRE',
      actorId: 'A',
      cellId: 'C_2_1',
      structuralChange: true,
      rare: true,
    },
    {
      handoffHopLimit: 4,
      handoffScheduler: {
        maxProcessed: 512,
        maxQueueSize: 512,
      },
    },
  );

  assert.equal(result.committed, true);
  assert.equal(result.handoffScheduleReceipt.status, 'DRAINED');
  assert.equal(world.receipts.handoffSchedules.length, 1);
  assert.equal(world.cells.C_2_1.truthState.properties.burning, true);
  assert.equal(JSON.stringify(world.cells.C_2_2.truthState), beforeNeighbor);
});

test('memory mode still cannot change canonical truth when scheduler is enabled', () => {
  const options = {
    handoffHopLimit: 4,
    handoffScheduler: {
      maxProcessed: 512,
      maxQueueSize: 512,
    },
  };
  const withoutMemory = runScenario({ ...options, memoryEnabled: false });
  const withMemory = runScenario({ ...options, memoryEnabled: true });

  assert.equal(canonicalHash(withoutMemory), canonicalHash(withMemory));
  assert.equal(withoutMemory.receipts.handoffSchedules.length, 1);
  assert.equal(withMemory.receipts.handoffSchedules.length, 1);
});

test('budget-exhausted queue survives persistence and resumes deterministically', () => {
  const world = createWorld({ width: 9, height: 9 });
  const before = canonicalHash(world);
  const first = runHandoffScheduler(world, centerSignal(world, 'PERSISTED_WAVE', 5), {
    maxProcessed: 4,
    maxQueueSize: 512,
  });

  assert.equal(first.status, 'BUDGET_EXHAUSTED');
  assert.ok(first.remainingQueueCount > 0);

  const reloaded = reloadWorld(persistWorld(world));
  assert.deepEqual(reloaded.handoffState, world.handoffState);
  assert.equal(canonicalHash(reloaded), before);

  const resumed = resumeHandoffScheduler(reloaded, first.schedulerId, {
    maxProcessed: 512,
  });

  assert.equal(resumed.status, 'DRAINED');
  assert.equal(resumed.remainingQueueCount, 0);
  assert.equal(resumed.canonicalMutationApplied, false);
  assert.equal(canonicalHash(reloaded), before);
});
