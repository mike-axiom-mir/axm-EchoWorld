import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalHash, createWorld, persistWorld, reloadWorld } from '../src/core/state.js';
import { processEvent } from '../src/core/world.js';
import { acceptHandoff, neighborHandoffs } from '../src/handoff/events.js';
import { processAcceptedHandoff } from '../src/handoff/arrival.js';
import { runHandoffScheduler } from '../src/handoff/scheduler.js';
import { matchSpecialists } from '../src/specialists/matcher.js';

function directSignal(
  eventId,
  causalEventId,
  { sourceRevision = 0, sourceEventType = 'FIRE' } = {},
) {
  return {
    schema: 'axm.echoworld.handoff/v0.01',
    eventId,
    causalEventId,
    originCellId: 'C_2_1',
    senderCellId: 'C_2_1',
    recipientCellId: 'C_2_2',
    type: 'SOUND',
    parameters: { sourceEventType },
    sourceRevision,
    causalDepth: 1,
    hopLimit: 1,
    path: ['C_2_1'],
  };
}


test('direct recipient lifecycle carries its own canonical hash witness', () => {
  const world = createWorld({ memoryEnabled: true });
  const handoff = directSignal('DIRECT_SIGNAL', 'DIRECT_CAUSE');
  const before = canonicalHash(world);

  assert.equal(acceptHandoff(world, handoff).accepted, true);
  const lifecycle = processAcceptedHandoff(world, handoff);

  assert.equal(lifecycle.receipt.status, 'PROCESSED');
  assert.equal(lifecycle.receipt.verificationScope, 'CELL_LIFECYCLE');
  assert.equal(lifecycle.receipt.canonicalHashBefore, before);
  assert.equal(lifecycle.receipt.canonicalHashAfter, before);
  assert.equal(lifecycle.receipt.canonicalMutationApplied, false);
  assert.equal(canonicalHash(world), before);
});

test('committed handoff wakes recipient, runs SOUND specialists, records observed memory, and sleeps', () => {
  const world = createWorld({ memoryEnabled: true });
  const result = processEvent(
    world,
    {
      eventId: 'COMMITTED_FIRE',
      type: 'FIRE',
      actorId: 'A',
      cellId: 'C_2_1',
      structuralChange: true,
      rare: true,
    },
    {
      handoffHopLimit: 2,
      handoffScheduler: {
        maxProcessed: 512,
        maxQueueSize: 512,
      },
    },
  );

  assert.equal(canonicalHash(world), result.canonicalHash);
  const lifecycle = world.receipts.cellLifecycles.find(
    (receipt) => receipt.cellId === 'C_2_2' && receipt.causalEventId === 'COMMITTED_FIRE',
  );
  assert.ok(lifecycle);
  assert.equal(lifecycle.status, 'PROCESSED');
  assert.deepEqual(lifecycle.stateTransitions, [
    'DORMANT',
    'WAKING',
    'ACTIVE',
    'SLEEPING',
    'DORMANT',
  ]);
  assert.equal(lifecycle.sourceCommitKnown, true);
  assert.equal(lifecycle.memoryReceiptWritten, true);
  assert.equal(lifecycle.canonicalMutationApplied, false);
  assert.equal(world.cells.C_2_2.wakeState, 'DORMANT');
  assert.equal(world.cells.C_2_2.activationCount, 1);

  const memory = world.cells.C_2_2.memory.working.find(
    (record) => record.causalEventId === 'COMMITTED_FIRE',
  );
  assert.ok(memory);
  assert.equal(memory.provenanceClass, 'OBSERVED');
  assert.equal(memory.sourceCommitKnown, true);

  const specialists = world.receipts.specialists
    .filter((receipt) => receipt.eventRef === lifecycle.handoffEventId)
    .map((receipt) => receipt.specialistId);
  assert.deepEqual(specialists, matchSpecialists({ type: 'SOUND' }));
});

test('memory-disabled arrival still wakes, processes, and sleeps without retaining memory', () => {
  const world = createWorld({ memoryEnabled: false });
  const before = canonicalHash(world);
  const receipt = runHandoffScheduler(
    world,
    [directSignal('NO_MEMORY_SIGNAL', 'NO_MEMORY_CAUSE')],
    { maxProcessed: 32, maxQueueSize: 32 },
  );

  assert.equal(receipt.status, 'DRAINED');
  assert.equal(receipt.cumulative.lifecycleProcessedCount, 1);
  assert.equal(receipt.cumulative.memoryWriteCount, 0);
  assert.equal(world.receipts.memory.length, 0);
  assert.equal(world.receipts.perceptions[0].memoryRetained, false);
  assert.equal(world.cells.C_2_2.wakeState, 'DORMANT');
  assert.equal(canonicalHash(world), before);
});

test('already-seen handoff cannot trigger a second lifecycle or memory write', () => {
  const world = createWorld({ memoryEnabled: true });
  const handoff = directSignal('DUP_LIFECYCLE', 'DUP_LIFECYCLE_CAUSE');
  const first = runHandoffScheduler(world, [handoff], {
    maxProcessed: 32,
    maxQueueSize: 32,
  });
  const lifecycleCount = world.receipts.cellLifecycles.length;
  const memoryCount = world.receipts.memory.length;

  const second = runHandoffScheduler(world, [handoff], {
    maxProcessed: 32,
    maxQueueSize: 64,
  });

  assert.equal(first.cumulative.lifecycleProcessedCount, 1);
  assert.equal(second.run.processedCount, 0);
  assert.equal(second.cumulative.prequeueReasons.ALREADY_SEEN_EVENT, 1);
  assert.equal(world.receipts.cellLifecycles.length, lifecycleCount);
  assert.equal(world.receipts.memory.length, memoryCount);
});

test('different causal signals can wake one cell repeatedly while memory remains bounded', () => {
  const world = createWorld({ memoryEnabled: true });

  for (let index = 0; index < 40; index += 1) {
    const receipt = runHandoffScheduler(
      world,
      [directSignal(`REPEAT_${index}`, `CAUSE_${index}`)],
      { maxProcessed: 32, maxQueueSize: 32 },
    );
    assert.equal(receipt.status, 'DRAINED');
  }

  const cell = world.cells.C_2_2;
  assert.equal(cell.activationCount, 40);
  assert.equal(cell.wakeState, 'DORMANT');
  assert.ok(cell.memory.working.length <= cell.memoryBudget.working);
  assert.ok(cell.memory.episodic.length <= cell.memoryBudget.episodic);
  assert.ok(cell.memory.compressed.length <= cell.memoryBudget.compressed);
  assert.ok(cell.memory.lineageRefs.length <= cell.memoryBudget.lineageRefs);
  assert.ok(world.receipts.memory.some((receipt) => receipt.compaction));
});

test('future-revision signal is rejected before recipient lifecycle begins', () => {
  const world = createWorld();
  const before = canonicalHash(world);
  const receipt = runHandoffScheduler(
    world,
    [directSignal('FUTURE_SIGNAL', 'FUTURE_CAUSE', { sourceRevision: 1 })],
    { maxProcessed: 32, maxQueueSize: 32 },
  );

  assert.equal(receipt.cumulative.acceptedCount, 0);
  assert.equal(receipt.cumulative.guardRejectionReasons.FUTURE_SOURCE_REVISION, 1);
  assert.equal(world.receipts.cellLifecycles.length, 0);
  assert.equal(world.cells.C_2_2.activationCount, 0);
  assert.equal(canonicalHash(world), before);
});

test('arrival specialist finish order cannot alter lifecycle meaning or canonical truth', () => {
  const natural = createWorld();
  const reversed = createWorld();
  const initialNatural = neighborHandoffs(
    natural,
    natural.cells.C_2_1,
    { eventId: 'ORDERED_CAUSE', type: 'FIRE' },
    { hopLimit: 1 },
  );
  const initialReversed = neighborHandoffs(
    reversed,
    reversed.cells.C_2_1,
    { eventId: 'ORDERED_CAUSE', type: 'FIRE' },
    { hopLimit: 1 },
  );

  runHandoffScheduler(natural, initialNatural, {
    maxProcessed: 32,
    maxQueueSize: 32,
  });
  runHandoffScheduler(reversed, initialReversed, {
    maxProcessed: 32,
    maxQueueSize: 32,
    arrivalSpecialistFinishOrder: ['memory-importance', 'witness-perception', 'sound'],
  });

  assert.equal(canonicalHash(natural), canonicalHash(reversed));
  const withoutSchedulerIdentity = (receipts) => receipts.map(({ schedulerId, ...receipt }) => receipt);
  assert.deepEqual(
    withoutSchedulerIdentity(natural.receipts.cellLifecycles),
    withoutSchedulerIdentity(reversed.receipts.cellLifecycles),
  );
});

test('perception and lifecycle receipts survive persistence without becoming canonical truth', () => {
  const world = createWorld({ memoryEnabled: true });
  const before = canonicalHash(world);
  runHandoffScheduler(
    world,
    [directSignal('PERSIST_PERCEPTION', 'PERSIST_CAUSE')],
    { maxProcessed: 32, maxQueueSize: 32 },
  );

  const reloaded = reloadWorld(persistWorld(world));
  assert.deepEqual(reloaded.receipts.perceptions, world.receipts.perceptions);
  assert.deepEqual(reloaded.receipts.cellLifecycles, world.receipts.cellLifecycles);
  assert.equal(canonicalHash(reloaded), before);
});
