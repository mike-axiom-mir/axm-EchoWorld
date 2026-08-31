import { createHash } from 'node:crypto';

import { canonicalHash } from '../core/state.js';
import {
  acceptHandoff,
  compareHandoffs,
  deriveNextHandoffs,
  handoffArrivalKey,
  handoffOrderKey,
} from './events.js';
import { processAcceptedHandoff } from './arrival.js';

const DEFAULT_LIMITS = Object.freeze({
  maxProcessed: 4096,
  maxQueueSize: 4096,
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
  world.receipts.handoffSchedules ??= [];
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
  maxQueueSize,
  processArrivals,
  arrivalSpecialistFinishOrder,
) {
  const identity = {
    revision: world.revision,
    maxQueueSize,
    processArrivals,
    arrivalSpecialistFinishOrder,
    handoffs: [...initialHandoffs].sort(compareHandoffs).map((handoff) => handoffOrderKey(handoff)),
  };
  return `HS_${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 16)}`;
}

function incrementReason(reasons, reason) {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
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
    prequeueReasons: {},
    guardRejectionReasons: {},
    lifecycleRejectionReasons: {},
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
}

function enqueueIntoJob(world, job, candidates, run) {
  const queuedEventIds = new Set(job.queue.map((handoff) => handoff.eventId));
  const queuedArrivalKeys = new Set(job.queue.map(handoffArrivalKey));
  const ordered = [...candidates].sort(compareHandoffs);

  for (const candidate of ordered) {
    const arrivalKey = handoffArrivalKey(candidate);
    let reason = null;

    if (world.handoffState.seenEventIds.includes(candidate?.eventId)) {
      reason = 'ALREADY_SEEN_EVENT';
    } else if (queuedEventIds.has(candidate?.eventId)) {
      reason = 'DUPLICATE_QUEUED_EVENT';
    } else if (world.handoffState.seenArrivalKeys.includes(arrivalKey)) {
      reason = 'ALREADY_SEEN_CAUSAL_ARRIVAL';
    } else if (queuedArrivalKeys.has(arrivalKey)) {
      reason = 'DUPLICATE_QUEUED_CAUSAL_ARRIVAL';
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

export function startHandoffSchedule(
  world,
  initialHandoffs,
  {
    maxQueueSize = DEFAULT_LIMITS.maxQueueSize,
    processArrivals = true,
    arrivalSpecialistFinishOrder = null,
  } = {},
) {
  requirePositiveInteger(maxQueueSize, 'maxQueueSize');
  if (!Array.isArray(initialHandoffs)) {
    throw new TypeError('initialHandoffs must be an array.');
  }
  if (typeof processArrivals !== 'boolean') {
    throw new TypeError('processArrivals must be a boolean.');
  }
  const finishOrder = normalizedFinishOrder(arrivalSpecialistFinishOrder);

  const jobs = ensureSchedulerState(world);
  const id = schedulerId(world, initialHandoffs, maxQueueSize, processArrivals, finishOrder);
  if (jobs[id]) return jobs[id];

  const job = {
    schema: 'axm.echoworld.handoff-scheduler-job/v0.01',
    schedulerId: id,
    baseRevision: world.revision,
    status: 'PENDING',
    maxQueueSize,
    processArrivals,
    arrivalSpecialistFinishOrder: finishOrder,
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
    maxQueueObserved: 0,
    prequeueReasons: {},
    guardRejectionReasons: {},
    lifecycleRejectionReasons: {},
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
  const lifecycleReceiptStart = world.receipts.cellLifecycles?.length ?? 0;

  while (job.queue.length > 0 && run.processedCount < maxProcessed) {
    const handoff = job.queue.shift();
    run.processedCount += 1;

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

  const exhausted = job.queue.length > 0 || job.droppedByQueueBudget > 0;
  job.status = canonicalMutationApplied
    ? 'AUTHORITY_BREACH'
    : exhausted
      ? 'BUDGET_EXHAUSTED'
      : 'DRAINED';

  const receipt = {
    schema: 'axm.echoworld.handoff-scheduler-receipt/v0.01',
    schedulerId: job.schedulerId,
    baseRevision: job.baseRevision,
    runIndex: job.runCount,
    status: job.status,
    processArrivals: job.processArrivals,
    limits: {
      maxProcessed,
      maxQueueSize: job.maxQueueSize,
    },
    initialCount: job.initialCount,
    run: {
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
      prequeueReasons: stableReasons(run.prequeueReasons),
      guardRejectionReasons: stableReasons(run.guardRejectionReasons),
      lifecycleRejectionReasons: stableReasons(run.lifecycleRejectionReasons),
    },
    cumulative: {
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
      prequeueReasons: stableReasons(job.prequeueReasons),
      guardRejectionReasons: stableReasons(job.guardRejectionReasons),
      lifecycleRejectionReasons: stableReasons(job.lifecycleRejectionReasons),
    },
    remainingQueueCount: job.queue.length,
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
  } = {},
) {
  const job = startHandoffSchedule(world, initialHandoffs, {
    maxQueueSize,
    processArrivals,
    arrivalSpecialistFinishOrder,
  });
  return drainHandoffSchedule(world, job.schedulerId, { maxProcessed });
}

export function resumeHandoffScheduler(world, schedulerIdValue, options = {}) {
  return drainHandoffSchedule(world, schedulerIdValue, options);
}

export { DEFAULT_LIMITS as HANDOFF_SCHEDULER_DEFAULT_LIMITS };
