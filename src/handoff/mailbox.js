import { compareHandoffs, handoffArrivalKey } from './events.js';

export const DEFERRED_DELIVERY_DEFAULTS = Object.freeze({
  maxMailboxSize: 8,
  maxDeferredRetries: 3,
  deferredTtlEpochs: 8,
});

function ensureDeferredState(world) {
  world.handoffState ??= {};
  world.handoffState.deferredMailboxes ??= {};
  world.receipts.deferredDeliveries ??= [];
  return world.handoffState.deferredMailboxes;
}

function allEntries(world) {
  const mailboxes = ensureDeferredState(world);
  return Object.values(mailboxes).flat();
}

function mailboxFor(world, cellId) {
  const mailboxes = ensureDeferredState(world);
  mailboxes[cellId] ??= [];
  return mailboxes[cellId];
}

function sortMailbox(mailbox) {
  mailbox.sort((a, b) => {
    const handoffOrder = compareHandoffs(a.handoff, b.handoff);
    if (handoffOrder !== 0) return handoffOrder;
    return a.schedulerId.localeCompare(b.schedulerId);
  });
}

function appendReceipt(world, entry, status, extra = {}) {
  const cellId = entry?.handoff?.recipientCellId ?? extra.cellId ?? null;
  const mailboxSize = cellId
    ? (world.handoffState.deferredMailboxes?.[cellId]?.length ?? 0)
    : 0;
  const receipt = {
    schema: 'axm.echoworld.deferred-delivery-receipt/v0.01',
    schedulerId: entry?.schedulerId ?? extra.schedulerId ?? null,
    eventId: entry?.handoff?.eventId ?? extra.eventId ?? null,
    causalEventId: entry?.handoff?.causalEventId ?? extra.causalEventId ?? null,
    cellId,
    status,
    epoch: extra.epoch ?? null,
    deferredAtEpoch: entry?.deferredAtEpoch ?? null,
    expiresAtEpoch: entry?.expiresAtEpoch ?? null,
    retryCount: entry?.retryCount ?? extra.retryCount ?? 0,
    maxRetries: entry?.maxRetries ?? extra.maxRetries ?? null,
    mailboxSize,
    ...extra,
  };
  world.receipts.deferredDeliveries.push(receipt);
  return receipt;
}

export function deferredEventIdSet(world) {
  return new Set(allEntries(world).map((entry) => entry.handoff.eventId));
}

export function deferredArrivalKeySet(world) {
  return new Set(allEntries(world).map((entry) => handoffArrivalKey(entry.handoff)));
}

export function pendingDeferredCount(world, schedulerId = null) {
  return allEntries(world).filter(
    (entry) => schedulerId === null || entry.schedulerId === schedulerId,
  ).length;
}

export function deferBusyHandoff(world, job, handoff) {
  const existingEntries = allEntries(world);
  const arrivalKey = handoffArrivalKey(handoff);
  const duplicateEvent = existingEntries.find((entry) => entry.handoff.eventId === handoff.eventId);
  if (duplicateEvent) {
    return {
      deferred: false,
      status: 'DUPLICATE_DEFERRED_EVENT',
      receipt: appendReceipt(world, duplicateEvent, 'DUPLICATE_DEFERRED_EVENT', {
        schedulerId: job.schedulerId,
        epoch: job.deferredEpoch,
        duplicateSchedulerId: duplicateEvent.schedulerId,
      }),
    };
  }

  const duplicateArrival = existingEntries.find(
    (entry) => handoffArrivalKey(entry.handoff) === arrivalKey,
  );
  if (duplicateArrival) {
    return {
      deferred: false,
      status: 'DUPLICATE_DEFERRED_CAUSAL_ARRIVAL',
      receipt: appendReceipt(world, duplicateArrival, 'DUPLICATE_DEFERRED_CAUSAL_ARRIVAL', {
        schedulerId: job.schedulerId,
        epoch: job.deferredEpoch,
        duplicateSchedulerId: duplicateArrival.schedulerId,
      }),
    };
  }

  const mailbox = mailboxFor(world, handoff.recipientCellId);
  if (mailbox.length >= job.maxMailboxSize) {
    return {
      deferred: false,
      status: 'MAILBOX_BUDGET_EXCEEDED',
      receipt: appendReceipt(world, null, 'MAILBOX_BUDGET_EXCEEDED', {
        schedulerId: job.schedulerId,
        eventId: handoff.eventId,
        causalEventId: handoff.causalEventId,
        cellId: handoff.recipientCellId,
        epoch: job.deferredEpoch,
        maxMailboxSize: job.maxMailboxSize,
      }),
    };
  }

  const entry = {
    schema: 'axm.echoworld.deferred-delivery/v0.01',
    schedulerId: job.schedulerId,
    handoff,
    deferredAtEpoch: job.deferredEpoch,
    expiresAtEpoch: job.deferredEpoch + job.deferredTtlEpochs,
    retryCount: 0,
    maxRetries: job.maxDeferredRetries,
  };
  mailbox.push(entry);
  sortMailbox(mailbox);

  return {
    deferred: true,
    status: 'DEFERRED',
    entry,
    receipt: appendReceipt(world, entry, 'DEFERRED', {
      epoch: job.deferredEpoch,
      maxMailboxSize: job.maxMailboxSize,
    }),
  };
}

export function sweepDeferredMailboxes(world, job, { releaseCapacity } = {}) {
  if (!Number.isInteger(releaseCapacity) || releaseCapacity < 0) {
    throw new RangeError('releaseCapacity must be a non-negative integer.');
  }

  const mailboxes = ensureDeferredState(world);
  const released = [];
  const stats = {
    releasedCount: 0,
    retryCount: 0,
    expiredCount: 0,
    retryExhaustedCount: 0,
    cancelledSeenCount: 0,
    releaseBlockedCount: 0,
  };

  for (const cellId of Object.keys(mailboxes).sort()) {
    const mailbox = mailboxes[cellId];
    sortMailbox(mailbox);
    const retained = [];

    for (const entry of mailbox) {
      if (entry.schedulerId !== job.schedulerId) {
        retained.push(entry);
        continue;
      }

      const arrivalKey = handoffArrivalKey(entry.handoff);
      if (
        world.handoffState.seenEventIds.includes(entry.handoff.eventId)
        || world.handoffState.seenArrivalKeys.includes(arrivalKey)
      ) {
        stats.cancelledSeenCount += 1;
        appendReceipt(world, entry, 'CANCELLED_ALREADY_SEEN', { epoch: job.deferredEpoch });
        continue;
      }

      if (job.deferredEpoch >= entry.expiresAtEpoch) {
        stats.expiredCount += 1;
        appendReceipt(world, entry, 'EXPIRED', { epoch: job.deferredEpoch });
        continue;
      }

      const cell = world.cells[entry.handoff.recipientCellId];
      if (cell?.wakeState === 'DORMANT') {
        if (released.length < releaseCapacity) {
          released.push(entry.handoff);
          stats.releasedCount += 1;
          appendReceipt(world, entry, 'RELEASED', { epoch: job.deferredEpoch });
        } else {
          retained.push(entry);
          stats.releaseBlockedCount += 1;
          appendReceipt(world, entry, 'RELEASE_BLOCKED_QUEUE_CAPACITY', {
            epoch: job.deferredEpoch,
          });
        }
        continue;
      }

      const retryCount = entry.retryCount + 1;
      entry.retryCount = retryCount;
      if (retryCount >= entry.maxRetries) {
        stats.retryExhaustedCount += 1;
        appendReceipt(world, entry, 'RETRY_EXHAUSTED', { epoch: job.deferredEpoch });
        continue;
      }

      retained.push(entry);
      stats.retryCount += 1;
      appendReceipt(world, entry, 'RETRY_DEFERRED', { epoch: job.deferredEpoch });
    }

    if (retained.length > 0) {
      sortMailbox(retained);
      mailboxes[cellId] = retained;
    } else {
      delete mailboxes[cellId];
    }
  }

  released.sort(compareHandoffs);
  return { released, stats };
}
