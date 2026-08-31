import { canonicalHash } from '../core/state.js';
import { recordObservedHandoffMemory } from '../memory/memory.js';
import { createSpecialistReceipts } from '../specialists/matcher.js';
import { mergeSpecialistProposals } from '../specialists/merge.js';
import { deriveNextHandoffs } from './events.js';

function ensureReceiptState(world) {
  world.receipts.perceptions ??= [];
  world.receipts.cellLifecycles ??= [];
}

function sourceCommitKnown(world, handoff) {
  return world.receipts.truth.some(
    (receipt) => (
      receipt.eventId === handoff.causalEventId
      && receipt.committedRevision === handoff.sourceRevision
    ),
  );
}

function directVerificationEnabled(canonicalVerification) {
  if (!['DIRECT', 'SCHEDULER'].includes(canonicalVerification)) {
    throw new TypeError('canonicalVerification must be DIRECT or SCHEDULER.');
  }
  return canonicalVerification === 'DIRECT';
}

function lifecycleFailure(
  world,
  handoff,
  cell,
  reason,
  {
    directVerification,
    canonicalHashBefore,
    schedulerId,
  },
) {
  const canonicalHashAfter = directVerification ? canonicalHash(world) : null;
  const receipt = {
    schema: 'axm.echoworld.cell-handoff-lifecycle-receipt/v0.01',
    schedulerId,
    handoffEventId: handoff.eventId,
    causalEventId: handoff.causalEventId,
    cellId: handoff.recipientCellId,
    sourceRevision: handoff.sourceRevision,
    observedAtRevision: world.revision,
    status: reason,
    verificationScope: directVerification ? 'CELL_LIFECYCLE' : 'SCHEDULER_JOB',
    stateTransitions: [cell?.wakeState ?? null],
    activationCount: cell?.activationCount ?? null,
    sourceCommitKnown: false,
    specialistRunIds: [],
    specialistDecisionCount: 0,
    specialistConflictCount: 0,
    specialistRejectedCount: 0,
    perceptionRecorded: false,
    memoryReceiptWritten: false,
    generatedHandoffCount: 0,
    canonicalHashBefore,
    canonicalHashAfter,
    canonicalMutationApplied: directVerification
      ? canonicalHashBefore !== canonicalHashAfter
      : null,
  };
  world.receipts.cellLifecycles.push(receipt);
  return {
    receipt,
    handoffs: [],
    specialistReceipts: [],
    mergeReceipt: null,
    perceptionReceipt: null,
    memoryReceipt: null,
  };
}

export function processAcceptedHandoff(
  world,
  handoff,
  {
    specialistFinishOrder = null,
    canonicalVerification = 'DIRECT',
    schedulerId = null,
  } = {},
) {
  ensureReceiptState(world);
  const directVerification = directVerificationEnabled(canonicalVerification);
  const canonicalHashBefore = directVerification ? canonicalHash(world) : null;
  const cell = world.cells[handoff.recipientCellId];

  if (!cell) {
    return lifecycleFailure(world, handoff, null, 'UNKNOWN_RECIPIENT_CELL', {
      directVerification,
      canonicalHashBefore,
      schedulerId,
    });
  }
  if (cell.wakeState !== 'DORMANT') {
    return lifecycleFailure(world, handoff, cell, 'CELL_BUSY_REJECTED', {
      directVerification,
      canonicalHashBefore,
      schedulerId,
    });
  }

  const transitions = ['DORMANT'];
  cell.wakeState = 'WAKING';
  transitions.push('WAKING');
  cell.activationCount += 1;
  cell.lastWakeEventId = handoff.eventId;

  cell.wakeState = 'ACTIVE';
  transitions.push('ACTIVE');

  const observedEvent = {
    eventId: handoff.eventId,
    type: handoff.type,
    causalEventId: handoff.causalEventId,
    sourceKind: 'HANDOFF_ARRIVAL',
    sourceRevision: handoff.sourceRevision,
  };
  const specialistReceipts = createSpecialistReceipts(
    world,
    cell,
    observedEvent,
    specialistFinishOrder,
  );
  const mergeReceipt = mergeSpecialistProposals(world, specialistReceipts);
  const committedSourceKnown = sourceCommitKnown(world, handoff);
  const memoryReceipt = recordObservedHandoffMemory(
    world,
    cell,
    handoff,
    { sourceCommitKnown: committedSourceKnown },
  );

  const perceptionReceipt = {
    schema: 'axm.echoworld.perception-receipt/v0.01',
    schedulerId,
    handoffEventId: handoff.eventId,
    causalEventId: handoff.causalEventId,
    cellId: cell.cellId,
    signalType: handoff.type,
    sourceEventType: handoff.parameters?.sourceEventType ?? null,
    sourceRevision: handoff.sourceRevision,
    observedAtRevision: world.revision,
    causalDepth: handoff.causalDepth,
    provenanceClass: 'OBSERVED',
    sourceCommitKnown: committedSourceKnown,
    memoryEnabled: world.memoryEnabled,
    memoryRetained: Boolean(memoryReceipt),
    specialistRunIds: specialistReceipts.map((receipt) => receipt.runId).sort(),
  };
  world.receipts.perceptions.push(perceptionReceipt);

  const handoffs = deriveNextHandoffs(world, handoff);

  cell.wakeState = 'SLEEPING';
  transitions.push('SLEEPING');
  cell.lastActiveRevision = world.revision;
  cell.lastSleepEventId = handoff.eventId;
  cell.wakeState = 'DORMANT';
  transitions.push('DORMANT');

  const canonicalHashAfter = directVerification ? canonicalHash(world) : null;
  const canonicalMutationApplied = directVerification
    ? canonicalHashBefore !== canonicalHashAfter
    : null;
  const receipt = {
    schema: 'axm.echoworld.cell-handoff-lifecycle-receipt/v0.01',
    schedulerId,
    handoffEventId: handoff.eventId,
    causalEventId: handoff.causalEventId,
    cellId: cell.cellId,
    sourceRevision: handoff.sourceRevision,
    observedAtRevision: world.revision,
    status: directVerification
      ? canonicalMutationApplied
        ? 'AUTHORITY_BREACH'
        : 'PROCESSED'
      : 'PROCESSED_PENDING_SCHEDULE_VERIFICATION',
    verificationScope: directVerification ? 'CELL_LIFECYCLE' : 'SCHEDULER_JOB',
    stateTransitions: transitions,
    activationCount: cell.activationCount,
    sourceCommitKnown: committedSourceKnown,
    specialistRunIds: specialistReceipts.map((item) => item.runId).sort(),
    specialistDecisionCount: mergeReceipt.decisions.length,
    specialistConflictCount: mergeReceipt.conflicts.length,
    specialistRejectedCount: mergeReceipt.rejected.length,
    perceptionRecorded: true,
    memoryReceiptWritten: Boolean(memoryReceipt),
    generatedHandoffCount: handoffs.length,
    canonicalHashBefore,
    canonicalHashAfter,
    canonicalMutationApplied,
  };
  world.receipts.cellLifecycles.push(receipt);

  return {
    receipt,
    handoffs,
    specialistReceipts,
    mergeReceipt,
    perceptionReceipt,
    memoryReceipt,
  };
}
