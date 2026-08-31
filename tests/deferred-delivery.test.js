import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalHash, createWorld, persistWorld, reloadWorld } from '../src/core/state.js';
import { pendingDeferredCount } from '../src/handoff/mailbox.js';
import { resumeHandoffScheduler, runHandoffScheduler } from '../src/handoff/scheduler.js';

function signal(
  eventId,
  causalEventId,
  {
    recipientCellId = 'C_2_2',
    sourceRevision = 0,
    hopLimit = 1,
  } = {},
) {
  return {
    schema: 'axm.echoworld.handoff/v0.01',
    eventId,
    causalEventId,
    originCellId: 'C_2_1',
    senderCellId: 'C_2_1',
    recipientCellId,
    type: 'SOUND',
    parameters: { sourceEventType: 'FIRE' },
    sourceRevision,
    causalDepth: 1,
    hopLimit,
    path: ['C_2_1'],
  };
}

const mailboxOptions = Object.freeze({
  maxProcessed: 32,
  maxQueueSize: 32,
  maxMailboxSize: 4,
  maxDeferredRetries: 3,
  deferredTtlEpochs: 8,
});

test('busy recipient defers before acceptance, perception, or memory', () => {
  const world = createWorld({ memoryEnabled: true });
  const before = canonicalHash(world);
  world.cells.C_2_2.wakeState = 'ACTIVE';

  const receipt = runHandoffScheduler(
    world,
    [signal('BUSY_DEFER', 'BUSY_CAUSE')],
    mailboxOptions,
  );

  assert.equal(receipt.status, 'WAITING_FOR_DEFERRED_DELIVERY');
  assert.equal(receipt.run.deferredCount, 1);
  assert.equal(receipt.pendingDeferredCount, 1);
  assert.equal(pendingDeferredCount(world, receipt.schedulerId), 1);
  assert.equal(world.handoffState.seenEventIds.includes('BUSY_DEFER'), false);
  assert.equal(world.receipts.handoffGuards.length, 0);
  assert.equal(world.receipts.cellLifecycles.length, 0);
  assert.equal(world.receipts.perceptions.length, 0);
  assert.equal(world.receipts.memory.length, 0);
  assert.equal(world.receipts.deferredDeliveries.at(-1).status, 'DEFERRED');
  assert.equal(canonicalHash(world), before);
});

test('deferred delivery releases exactly once after the cell becomes dormant', () => {
  const world = createWorld({ memoryEnabled: true });
  const before = canonicalHash(world);
  world.cells.C_2_2.wakeState = 'ACTIVE';

  const first = runHandoffScheduler(
    world,
    [signal('BUSY_RELEASE', 'BUSY_RELEASE_CAUSE')],
    mailboxOptions,
  );
  world.cells.C_2_2.wakeState = 'DORMANT';

  const second = resumeHandoffScheduler(world, first.schedulerId, { maxProcessed: 32 });
  const lifecycleCount = world.receipts.cellLifecycles.length;
  const memoryCount = world.receipts.memory.length;
  const third = resumeHandoffScheduler(world, first.schedulerId, { maxProcessed: 32 });

  assert.equal(second.status, 'DRAINED');
  assert.equal(second.run.deferredReleasedCount, 1);
  assert.equal(second.run.lifecycleProcessedCount, 1);
  assert.equal(second.pendingDeferredCount, 0);
  assert.equal(world.handoffState.seenEventIds.includes('BUSY_RELEASE'), true);
  assert.equal(world.receipts.deferredDeliveries.some((item) => item.status === 'RELEASED'), true);
  assert.equal(world.receipts.cellLifecycles.length, lifecycleCount);
  assert.equal(world.receipts.memory.length, memoryCount);
  assert.equal(third.run.processedCount, 0);
  assert.equal(canonicalHash(world), before);
});

test('a second schedule cannot queue an event already held in a deferred mailbox', () => {
  const world = createWorld();
  world.cells.C_2_2.wakeState = 'ACTIVE';
  const handoff = signal('DEFERRED_DEDUP', 'DEFERRED_DEDUP_CAUSE');

  const first = runHandoffScheduler(world, [handoff], mailboxOptions);
  const second = runHandoffScheduler(world, [handoff], {
    ...mailboxOptions,
    maxQueueSize: 64,
  });

  assert.equal(first.status, 'WAITING_FOR_DEFERRED_DELIVERY');
  assert.equal(second.run.processedCount, 0);
  assert.equal(second.cumulative.prequeueReasons.ALREADY_DEFERRED_EVENT, 1);
  assert.equal(pendingDeferredCount(world), 1);
});

test('deferred delivery expires deterministically after its logical TTL', () => {
  const world = createWorld();
  const before = canonicalHash(world);
  world.cells.C_2_2.wakeState = 'ACTIVE';

  const first = runHandoffScheduler(
    world,
    [signal('TTL_SIGNAL', 'TTL_CAUSE')],
    {
      ...mailboxOptions,
      maxDeferredRetries: 99,
      deferredTtlEpochs: 2,
    },
  );
  const second = resumeHandoffScheduler(world, first.schedulerId, { maxProcessed: 32 });
  const third = resumeHandoffScheduler(world, first.schedulerId, { maxProcessed: 32 });

  assert.equal(second.status, 'WAITING_FOR_DEFERRED_DELIVERY');
  assert.equal(second.run.deferredRetryCount, 1);
  assert.equal(third.status, 'DEFERRED_DELIVERY_EXHAUSTED');
  assert.equal(third.run.deferredExpiredCount, 1);
  assert.equal(third.pendingDeferredCount, 0);
  assert.equal(world.handoffState.seenEventIds.includes('TTL_SIGNAL'), false);
  assert.equal(world.receipts.cellLifecycles.length, 0);
  assert.equal(canonicalHash(world), before);
});

test('deferred retry limit fails closed without false perception', () => {
  const world = createWorld({ memoryEnabled: true });
  const before = canonicalHash(world);
  world.cells.C_2_2.wakeState = 'ACTIVE';

  const first = runHandoffScheduler(
    world,
    [signal('RETRY_SIGNAL', 'RETRY_CAUSE')],
    {
      ...mailboxOptions,
      maxDeferredRetries: 2,
      deferredTtlEpochs: 20,
    },
  );
  const second = resumeHandoffScheduler(world, first.schedulerId, { maxProcessed: 32 });
  const third = resumeHandoffScheduler(world, first.schedulerId, { maxProcessed: 32 });

  assert.equal(second.run.deferredRetryCount, 1);
  assert.equal(third.status, 'DEFERRED_DELIVERY_EXHAUSTED');
  assert.equal(third.run.deferredRetryExhaustedCount, 1);
  assert.equal(third.pendingDeferredCount, 0);
  assert.equal(world.receipts.perceptions.length, 0);
  assert.equal(world.receipts.memory.length, 0);
  assert.equal(canonicalHash(world), before);
});

test('mailbox capacity overflow is explicit and cannot masquerade as successful delivery', () => {
  const world = createWorld();
  const before = canonicalHash(world);
  world.cells.C_2_2.wakeState = 'ACTIVE';

  const receipt = runHandoffScheduler(
    world,
    [
      signal('MAILBOX_A', 'MAILBOX_CAUSE_A'),
      signal('MAILBOX_B', 'MAILBOX_CAUSE_B'),
    ],
    {
      ...mailboxOptions,
      maxMailboxSize: 1,
    },
  );

  assert.equal(receipt.status, 'BUDGET_EXHAUSTED');
  assert.equal(receipt.run.deferredCount, 1);
  assert.equal(receipt.run.droppedByMailboxBudget, 1);
  assert.equal(receipt.run.deferredDeliveryReasons.MAILBOX_BUDGET_EXCEEDED, 1);
  assert.equal(receipt.pendingDeferredCount, 1);
  assert.equal(world.handoffState.seenEventIds.length, 0);
  assert.equal(world.receipts.cellLifecycles.length, 0);
  assert.equal(canonicalHash(world), before);
});

test('deferred mailbox and retry policy survive persistence and resume', () => {
  const world = createWorld({ memoryEnabled: true });
  const before = canonicalHash(world);
  world.cells.C_2_2.wakeState = 'ACTIVE';

  const first = runHandoffScheduler(
    world,
    [signal('PERSIST_DEFER', 'PERSIST_DEFER_CAUSE')],
    mailboxOptions,
  );
  const reloaded = reloadWorld(persistWorld(world));

  assert.deepEqual(reloaded.handoffState.deferredMailboxes, world.handoffState.deferredMailboxes);
  assert.deepEqual(reloaded.receipts.deferredDeliveries, world.receipts.deferredDeliveries);
  reloaded.cells.C_2_2.wakeState = 'DORMANT';

  const resumed = resumeHandoffScheduler(reloaded, first.schedulerId, { maxProcessed: 32 });
  assert.equal(resumed.status, 'DRAINED');
  assert.equal(resumed.run.deferredReleasedCount, 1);
  assert.equal(resumed.run.lifecycleProcessedCount, 1);
  assert.equal(resumed.pendingDeferredCount, 0);
  assert.equal(canonicalHash(reloaded), before);
});

test('invalid future-revision arrival is rejected instead of deferred even when recipient is busy', () => {
  const world = createWorld();
  world.cells.C_2_2.wakeState = 'ACTIVE';

  const receipt = runHandoffScheduler(
    world,
    [signal('BUSY_FUTURE', 'BUSY_FUTURE_CAUSE', { sourceRevision: 1 })],
    mailboxOptions,
  );

  assert.equal(receipt.status, 'DRAINED');
  assert.equal(receipt.run.rejectedCount, 1);
  assert.equal(receipt.run.guardRejectionReasons.FUTURE_SOURCE_REVISION, 1);
  assert.equal(receipt.run.deferredCount, 0);
  assert.equal(receipt.pendingDeferredCount, 0);
  assert.equal(world.receipts.deferredDeliveries.length, 0);
});

test('mailbox release order is deterministic regardless of initial input order', () => {
  const forward = createWorld({ memoryEnabled: true });
  const reversed = createWorld({ memoryEnabled: true });
  forward.cells.C_2_2.wakeState = 'ACTIVE';
  reversed.cells.C_2_2.wakeState = 'ACTIVE';

  const a = signal('ORDER_MAIL_A', 'ORDER_MAIL_CAUSE_A');
  const b = signal('ORDER_MAIL_B', 'ORDER_MAIL_CAUSE_B');
  const firstForward = runHandoffScheduler(forward, [a, b], mailboxOptions);
  const firstReversed = runHandoffScheduler(reversed, [b, a], mailboxOptions);
  forward.cells.C_2_2.wakeState = 'DORMANT';
  reversed.cells.C_2_2.wakeState = 'DORMANT';

  const drainedForward = resumeHandoffScheduler(forward, firstForward.schedulerId, { maxProcessed: 32 });
  const drainedReversed = resumeHandoffScheduler(reversed, firstReversed.schedulerId, { maxProcessed: 32 });

  assert.deepEqual(drainedForward, drainedReversed);
  assert.deepEqual(forward.handoffState, reversed.handoffState);
  assert.deepEqual(forward.receipts.deferredDeliveries, reversed.receipts.deferredDeliveries);
  assert.deepEqual(forward.receipts.cellLifecycles, reversed.receipts.cellLifecycles);
  assert.equal(canonicalHash(forward), canonicalHash(reversed));
});
