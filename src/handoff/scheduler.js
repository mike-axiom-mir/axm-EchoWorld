import { createHash } from 'node:crypto';

import { canonicalHash } from '../core/state.js';
import {
  acceptHandoff,
  compareHandoffs,
  deriveNextHandoffs,
  handoffArrivalKey,
  handoffOrderKey,
  inspectHandoff,
} from './events.js';
import { processAcceptedHandoff } from './arrival.js';
import {
  DEFERRED_DELIVERY_DEFAULTS,
  deferBusyHandoff,
  deferredArrivalKeySet,
  deferredEventIdSet,
  pendingDeferredCount,
  sweepDeferredMailboxes,
} from './mailbox.js';

const DEFAULT_LIMITS = Object.freeze({
  maxProcessed: 4096,
  maxQueueSize: 4096,
  ...DEFERRED_DELIVERY_DEFAULTS,
});

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be an integer of at least 1.`);
  }
}

function ensureSchedulerState(world) {
  world.handoffState ??= {};
  world.handoffState.seenEventIds ??= [];
  world.handoffState.seenArrivalKeys ??= [];
  world.handoffState.schedulerJobs ??= {};
  world.handoffState.deferredMailboxes ??= {};
  world.receipts.handoffSchedules ??= [];
  world.receipts.deferredDeliveries ??= [];
  return world.handoffState.schedulerJobs;
}

function normalizedFinishOrder(value) {
  if (value === null) return null;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError('arrivalSpecialistFinishOrder must be null or an array of strings.');
  }
  return [...value];
}

function schedulerId(
  world,
  initialHandoffs,
  {
    maxQueueSize,
    processArrivals,
    arrivalSpecialistFinishOrder,
    maxMailboxSize,
    maxDeferredRetries,
    deferredTtlEpochs,
  },
) {
  const identity = {
    revision: world.revision,
    maxQueueSize,
    processArrivals,
    arrivalSpecialistFinishOrder,
    maxMailboxSize,
    maxDeferredRetries,
    deferredTtlEpochs,
    handoffs: [...initialHandoffs].sort(compareHandoffs).map((handoff) => handoffOrderKey(handoff)),
  };
  return `HS_${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 16)}`;
}

function incrementReason(reasons, reason, count = 1) {
  reasons[reason] = (reasons[reason] ?? 0) + count;
}

function stableReasons(reasons) {
  return Object.fromEntries(Object.keys(reasons).sort().map((key) => [key, reasons[key]]));
}

function makeRunCounters() {
  return {
    processedCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    generatedCount: 0,
    coalescedBeforeQueue: 0,
    droppedByQueueBudget: 0,
    lifecycleProcessedCount: 0,
    lifecycleRejectedCount: 0,
    perceptionCount: 0,
    memoryWriteCount: 0,
    sourceVerifiedCount: 0,
    sourceUnverifiedCount: 0,
    deferredCount: 0,
    deferredReleasedCount: 0,
    deferredRetryCount: 0,
    deferredExpiredCount: 0,
    deferredRetryExhaustedCount: 0,
    deferredCancelledSeenCount: 0,
    deferredReleaseBlockedCount: 0,
    droppedByMailboxBudget: 0,
    deferredDuplicateCount: 0,
    prequeueReasons: {},
    guardRejectionReasons: {},
    lifecycleRejectionReasons: {},
    deferredDeliveryReasons: {},
  };
}

function addRunToJob(job, run) {
  for (const key of [
    'processedCount',
    'acceptedCount',
    'rejectedCount',
    'generatedCount',
    'coalescedBeforeQueue',
    'droppedByQueueBudget',
    'lifecycleProcessedCount',
    'lifecycleRejectedCount',
    'perceptionCount',
    'memoryWriteCount',
    'sourceVerifiedCount',
    'sourceUnverifiedCount',
    'deferredCount',
    'deferredReleasedCount',
    'deferredRetryCount',
    'deferredExpiredCount',
    'deferredRetryExhaustedCount',
    'deferredCancelledSeenCount',
    'deferredReleaseBlockedCount',
    'droppedByMailboxBudget',
    'deferredDuplicateCount',
  ]) {
    job[key] += run[key];
  }

  for (const [reason, count] of Object.entries(run.prequeueReasons)) {
    job.prequeueReasons[reason] = (job.prequeueReasons[reason] ?? 0) + count;
  }
  for (const [reason, count] of Object.entries(run.guardRejectionReasons)) {
    job.guardRejectionReasons[reason] = (job.guardRejectionReasons[reason] ?? 0) + count;
  }
  for (const [reason, count] of Object.entries(run.lifecycleRejectionReasons)) {
    job.lifecycleRejectionReasons[reason] = (job.lifecycleRejectionReasons[reason] ?? 0) + count;
  }
  for (const [reason, count] of Object.entries(run.deferredDeliveryReasons)) {
    job.deferredDeliveryReasons[reason] = (job.deferredDeliveryReasons[reason] ?? 0) + count;
  }
}

function enqueueIntoJob(world, job, candidates, run) {
  const queuedEventIds = new Set(job.queue.map((handoff) => handoff.eventId));
  const queuedArrivalKeys = new Set(job.queue.map(handoffArrivalKey));
  const deferredEventIds = deferredEventIdSet(world);
  const deferredArrivalKeys = deferredArrivalKeySet(world);
  const ordered = [...candidates].sort(compareHandoffs);

  for (const candidate of ordered) {
    const arrivalKey = handoffArrivalKey(candidate);
    let reason = null;

    if (world.handoffState.seenEventIds.includes(candidate?.eventId)) {
      reason = 'ALREADY_SEEN_EVENT';
    } else if (queuedEventIds.has(candidate?.eventId)) {
      reason = 'DUPLICATE_QUEUED_EVENT';
    } else if (deferredEventIds.has(candidate?.eventId)) {
      reason = 'ALREADY_DEFERRED_EVENT';
    } else if (world.handoffState.seenArrivalKeys.includes(arrivalKey)) {
      reason = 'ALREADY_SEEN_CAUSAL_ARRIVAL';
    } else if (queuedArrivalKeys.has(arrivalKey)) {
      reason = 'DUPLICATE_QUEUED_CAUSAL_ARRIVAL';
    } else if (deferredArrivalKeys.has(arrivalKey)) {
      reason = 'ALREADY_DEFERRED_CAUSAL_ARRIVAL';
    } else if (job.queue.length >= job.maxQueueSize) {
      reason = 'QUEUE_BUDGET_EXCEEDED';
    }

    if (reason) {
      incrementReason(run.prequeueReasons, reason);
      if (reason === 'QUEUE_BUDGET_EXCEEDED') run.droppedByQueueBudget += 1;
      else run.coalescedBeforeQueue += 1;
      continue;
    }

    job.queue.push(candidate);
    queuedEventIds.add(candidate.eventId);
    queuedArrivalKeys.add(arrivalKey);
  }

  job.queue.sort(compareHandoffs);
  job.maxQueueObserved = Math.max(job.maxQueueObserved, job.queue.length);
}

function applyDeferredSweep(run, sweep) {
  run.deferredReleasedCount += sweep.stats.releasedCount;
  run.deferredRetryCount += sweep.stats.retryCount;
  run.deferredExpiredCount += sweep.stats.expiredCount;
  run.deferredRetryExhaustedCount += sweep.stats.retryExhaustedCount;
  run.deferredCancelledSeenCount += sweep.stats.cancelledSeenCount;
  run.deferredReleaseBlockedCount += sweep.stats.releaseBlockedCount;

  for (const [reason, count] of [
    ['RELEASED', sweep.stats.releasedCount],
    ['RETRY_DEFERRED', sweep.stats.retryCount],
    ['EXPIRED', sweep.stats.expiredCount],
    ['RETRY_EXHAUSTED', sweep.stats.retryExhaustedCount],
    ['CANCELLED_ALREADY_SEEN', sweep.stats.cancelledSeenCount],
    ['RELEASE_BLOCKED_QUEUE_CAPACITY', sweep.stats.releaseBlockedCount],
  ]) {
    if (count > 0) incrementReason(run.deferredDeliveryReasons, reason, count);
  }
}

function addReleasedToQueue(job, released) {
  job.queue.push(...released);
  job.queue.sort(compareHandoffs);
  job.maxQueueObserved = Math.max(job.maxQueueObserved, job.queue.length);
}

export function startHandoffSchedule(
  world,
  initialHandoffs,
  {
    maxQueueSize = DEFAULT_LIMITS.maxQueueSize,
    processArrivals = true,
    arrivalSpecialistFinishOrder = null,
    maxMailboxSize = DEFAULT_LIMITS.maxMailboxSize,
    maxDeferredRetries = DEFAULT_LIMITS.maxDeferredRetries,
    deferredTtlEpochs = DEFAULT_LIMITS.deferredTtlEpochs,
  } = {},
) {
  requirePositiveInteger(maxQueueSize, 'maxQueueSize');
  requirePositiveInteger(maxMailboxSize, 'maxMailboxSize');
  requirePositiveInteger(maxDeferredRetries, 'maxDeferredRetries');
  requirePositiveInteger(deferredTtlEpochs, 'deferredTtlEpochs');
  if (!Array.isArray(initialHandoffs)) {
    throw new TypeError('initialHandoffs must be an array.');
  }
  if (typeof processArrivals !== 'boolean') {
    throw new TypeError('processArrivals must be a boolean.');
  }
  const finishOrder = normalizedFinishOrder(arrivalSpecialistFinishOrder);

  const jobs = ensureSchedulerState(world);
  const identityOptions = {
    maxQueueSize,
    processArrivals,
    arrivalSpecialistFinishOrder: finishOrder,
    maxMailboxSize,
    maxDeferredRetries,
    deferredTtlEpochs,
  };
  const id = schedulerId(world, initialHandoffs, identityOptions);
  if (jobs[id]) return jobs[id];

  const job = {
    schema: 'axm.echoworld.handoff-scheduler-job/v0.01',
    schedulerId: id,
    baseRevision: world.revision,
    status: 'PENDING',
    maxQueueSize,
    processArrivals,
    arrivalSpecialistFinishOrder: finishOrder,
    maxMailboxSize,
    maxDeferredRetries,
    deferredTtlEpochs,
    deferredEpoch: 0,
    initialCount: initialHandoffs.length,
    queue: [],
    runCount: 0,
    processedCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    generatedCount: 0,
    coalescedBeforeQueue: 0,
    droppedByQueueBudget: 0,
    lifecycleProcessedCount: 0,
    lifecycleRejectedCount: 0,
    perceptionCount: 0,
    memoryWriteCount: 0,
    sourceVerifiedCount: 0,
    sourceUnverifiedCount: 0,
    deferredCount: 0,
    deferredReleasedCount: 0,
    deferredRetryCount: 0,
    deferredExpiredCount: 0,
    deferredRetryExhaustedCount: 0,
    deferredCancelledSeenCount: 0,
    deferredReleaseBlockedCount: 0,
    droppedByMailboxBudget: 0,
    deferredDuplicateCount: 0,
    maxQueueObserved: 0,
    prequeueReasons: {},
    guardRejectionReasons: {},
    lifecycleRejectionReasons: {},
    deferredDeliveryReasons: {},
    canonicalHashAtStart: canonicalHash(world),
  };
  jobs[id] = job;

  const startCounters = makeRunCounters();
  enqueueIntoJob(world, job, initialHandoffs, startCounters);
  addRunToJob(job, startCounters);

  return job;
}

export function drainHandoffSchedule(
  world,
  schedulerIdValue,
  { maxProcessed = DEFAULT_LIMITS.maxProcessed } = {},
) {
  requirePositiveInteger(maxProcessed, 'maxProcessed');
  const jobs = ensureSchedulerState(world);
  const job = jobs[schedulerIdValue];
  if (!job) throw new Error('UNKNOWN_HANDOFF_SCHEDULE');

  const run = makeRunCounters();
  job.deferredEpoch += 1;

  const sweep = sweepDeferredMailboxes(world, job, {
    releaseCapacity: Math.max(0, job.maxQueueSize - job.queue.length),
  });
  applyDeferredSweep(run, sweep);
  addReleasedToQueue(job, sweep.released);

  const lifecycleReceiptStart = world.receipts.cellLifecycles?.length ?? 0;

  while (job.queue.length > 0 && run.processedCount < maxProcessed) {
    const handoff = job.queue.shift();
    run.processedCount += 1;

    const inspection = inspectHandoff(world, handoff);
    if (!inspection.accepted) {
      const guard = acceptHandoff(world, handoff);
      run.rejectedCount += 1;
      incrementReason(run.guardRejectionReasons, guard.reason ?? 'UNKNOWN_REJECTION');
      continue;
    }

    const recipient = world.cells[handoff.recipientCellId];
    if (job.processArrivals && recipient.wakeState !== 'DORMANT') {
      const deferral = deferBusyHandoff(world, job, handoff);
      incrementReason(run.deferredDeliveryReasons, deferral.status);
      if (deferral.deferred) {
        run.deferredCount += 1;
      } else if (deferral.status === 'MAILBOX_BUDGET_EXCEEDED') {
        run.droppedByMailboxBudget += 1;
      } else {
        run.deferredDuplicateCount += 1;
      }
      continue;
    }

    const guard = acceptHandoff(world, handoff);
    if (!guard.accepted) {
      run.rejectedCount += 1;
      incrementReason(run.guardRejectionReasons, guard.reason ?? 'UNKNOWN_REJECTION');
      continue;
    }

    run.acceptedCount += 1;
    let handoffs = [];
    if (job.processArrivals) {
      const lifecycle = processAcceptedHandoff(world, handoff, {
        specialistFinishOrder: job.arrivalSpecialistFinishOrder,
        canonicalVerification: 'SCHEDULER',
        schedulerId: job.schedulerId,
      });
      if (['PROCESSED', 'PROCESSED_PENDING_SCHEDULE_VERIFICATION'].includes(lifecycle.receipt.status)) {
        run.lifecycleProcessedCount += 1;
      } else {
        run.lifecycleRejectedCount += 1;
        incrementReason(run.lifecycleRejectionReasons, lifecycle.receipt.status);
      }
      if (lifecycle.perceptionReceipt) run.perceptionCount += 1;
      if (lifecycle.memoryReceipt) run.memoryWriteCount += 1;
      if (lifecycle.receipt.sourceCommitKnown) run.sourceVerifiedCount += 1;
      else run.sourceUnverifiedCount += 1;
      handoffs = lifecycle.handoffs;
    } else {
      handoffs = deriveNextHandoffs(world, handoff);
    }

    run.generatedCount += handoffs.length;
    enqueueIntoJob(world, job, handoffs, run);
  }

  addRunToJob(job, run);
  job.runCount += 1;

  const canonicalHashAfter = canonicalHash(world);
  const canonicalMutationApplied = job.canonicalHashAtStart !== canonicalHashAfter;

  const lifecycleReceipts = (world.receipts.cellLifecycles ?? [])
    .slice(lifecycleReceiptStart)
    .filter((receipt) => receipt.schedulerId === job.schedulerId);
  for (const lifecycleReceipt of lifecycleReceipts) {
    lifecycleReceipt.schedulerCanonicalHashBefore = job.canonicalHashAtStart;
    lifecycleReceipt.schedulerCanonicalHashAfter = canonicalHashAfter;
    lifecycleReceipt.canonicalMutationApplied = canonicalMutationApplied;
    if (lifecycleReceipt.status === 'PROCESSED_PENDING_SCHEDULE_VERIFICATION') {
      lifecycleReceipt.status = canonicalMutationApplied ? 'AUTHORITY_BREACH' : 'PROCESSED';
    }
  }

  const pendingDeferred = pendingDeferredCount(world, job.schedulerId);
  const queueBudgetFailure = (
    job.queue.length > 0
    || job.droppedByQueueBudget > 0
    || job.droppedByMailboxBudget > 0
  );
  const deferredPolicyFailure = (
    job.deferredExpiredCount > 0
    || job.deferredRetryExhaustedCount > 0
  );

  job.status = canonicalMutationApplied
    ? 'AUTHORITY_BREACH'
    : queueBudgetFailure
      ? 'BUDGET_EXHAUSTED'
      : deferredPolicyFailure
        ? 'DEFERRED_DELIVERY_EXHAUSTED'
        : pendingDeferred > 0
          ? 'WAITING_FOR_DEFERRED_DELIVERY'
          : 'DRAINED';

  const runView = {
    processedCount: run.processedCount,
    acceptedCount: run.acceptedCount,
    rejectedCount: run.rejectedCount,
    generatedCount: run.generatedCount,
    coalescedBeforeQueue: run.coalescedBeforeQueue,
    droppedByQueueBudget: run.droppedByQueueBudget,
    lifecycleProcessedCount: run.lifecycleProcessedCount,
    lifecycleRejectedCount: run.lifecycleRejectedCount,
    perceptionCount: run.perceptionCount,
    memoryWriteCount: run.memoryWriteCount,
    sourceVerifiedCount: run.sourceVerifiedCount,
    sourceUnverifiedCount: run.sourceUnverifiedCount,
    deferredCount: run.deferredCount,
    deferredReleasedCount: run.deferredReleasedCount,
    deferredRetryCount: run.deferredRetryCount,
    deferredExpiredCount: run.deferredExpiredCount,
    deferredRetryExhaustedCount: run.deferredRetryExhaustedCount,
    deferredCancelledSeenCount: run.deferredCancelledSeenCount,
    deferredReleaseBlockedCount: run.deferredReleaseBlockedCount,
    droppedByMailboxBudget: run.droppedByMailboxBudget,
    deferredDuplicateCount: run.deferredDuplicateCount,
    prequeueReasons: stableReasons(run.prequeueReasons),
    guardRejectionReasons: stableReasons(run.guardRejectionReasons),
    lifecycleRejectionReasons: stableReasons(run.lifecycleRejectionReasons),
    deferredDeliveryReasons: stableReasons(run.deferredDeliveryReasons),
  };

  const cumulativeView = {
    processedCount: job.processedCount,
    acceptedCount: job.acceptedCount,
    rejectedCount: job.rejectedCount,
    generatedCount: job.generatedCount,
    coalescedBeforeQueue: job.coalescedBeforeQueue,
    droppedByQueueBudget: job.droppedByQueueBudget,
    lifecycleProcessedCount: job.lifecycleProcessedCount,
    lifecycleRejectedCount: job.lifecycleRejectedCount,
    perceptionCount: job.perceptionCount,
    memoryWriteCount: job.memoryWriteCount,
    sourceVerifiedCount: job.sourceVerifiedCount,
    sourceUnverifiedCount: job.sourceUnverifiedCount,
    deferredCount: job.deferredCount,
    deferredReleasedCount: job.deferredReleasedCount,
    deferredRetryCount: job.deferredRetryCount,
    deferredExpiredCount: job.deferredExpiredCount,
    deferredRetryExhaustedCount: job.deferredRetryExhaustedCount,
    deferredCancelledSeenCount: job.deferredCancelledSeenCount,
    deferredReleaseBlockedCount: job.deferredReleaseBlockedCount,
    droppedByMailboxBudget: job.droppedByMailboxBudget,
    deferredDuplicateCount: job.deferredDuplicateCount,
    prequeueReasons: stableReasons(job.prequeueReasons),
    guardRejectionReasons: stableReasons(job.guardRejectionReasons),
    lifecycleRejectionReasons: stableReasons(job.lifecycleRejectionReasons),
    deferredDeliveryReasons: stableReasons(job.deferredDeliveryReasons),
  };

  const receipt = {
    schema: 'axm.echoworld.handoff-scheduler-receipt/v0.02',
    schedulerId: job.schedulerId,
    baseRevision: job.baseRevision,
    runIndex: job.runCount,
    status: job.status,
    processArrivals: job.processArrivals,
    deferredEpoch: job.deferredEpoch,
    limits: {
      maxProcessed,
      maxQueueSize: job.maxQueueSize,
      maxMailboxSize: job.maxMailboxSize,
      maxDeferredRetries: job.maxDeferredRetries,
      deferredTtlEpochs: job.deferredTtlEpochs,
    },
    initialCount: job.initialCount,
    run: runView,
    cumulative: cumulativeView,
    remainingQueueCount: job.queue.length,
    pendingDeferredCount: pendingDeferred,
    maxQueueObserved: job.maxQueueObserved,
    canonicalHashBefore: job.canonicalHashAtStart,
    canonicalHashAfter,
    canonicalMutationApplied,
  };

  world.receipts.handoffSchedules.push(receipt);
  return receipt;
}

export function runHandoffScheduler(
  world,
  initialHandoffs,
  {
    maxProcessed = DEFAULT_LIMITS.maxProcessed,
    maxQueueSize = DEFAULT_LIMITS.maxQueueSize,
    processArrivals = true,
    arrivalSpecialistFinishOrder = null,
    maxMailboxSize = DEFAULT_LIMITS.maxMailboxSize,
    maxDeferredRetries = DEFAULT_LIMITS.maxDeferredRetries,
    deferredTtlEpochs = DEFAULT_LIMITS.deferredTtlEpochs,
  } = {},
) {
  const job = startHandoffSchedule(world, initialHandoffs, {
    maxQueueSize,
    processArrivals,
    arrivalSpecialistFinishOrder,
    maxMailboxSize,
    maxDeferredRetries,
    deferredTtlEpochs,
  });
  return drainHandoffSchedule(world, job.schedulerId, { maxProcessed });
}

export function resumeHandoffScheduler(world, schedulerIdValue, options = {}) {
  return drainHandoffSchedule(world, schedulerIdValue, options);
}

export { DEFAULT_LIMITS as HANDOFF_SCHEDULER_DEFAULT_LIMITS };
