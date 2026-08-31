import {
  compactWorkingMemory,
  recoverCellMemoryCompaction,
} from './compaction.js';

export {
  compactWorkingMemory,
  MEMORY_COMPACTION_INTERRUPT_POINTS,
  recoverCellMemoryCompaction,
  recoverPendingMemoryCompactions,
} from './compaction.js';

function scoreEvent(event) {
  let score = 0;
  if (event.structuralChange) score += 5;
  if (event.injuryOrDestruction) score += 4;
  if (event.rare) score += 3;
  if (event.relationshipRelevant) score += 2;
  if (event.repeatedRelevant) score += 1;
  if (event.humanBookmark) score += 1;
  return score;
}

function scoreObservedHandoff(handoff) {
  let score = 0;
  if (handoff.type === 'SOUND') score += 3;
  if (['FIRE', 'DAMAGE_STRUCTURE'].includes(handoff.parameters?.sourceEventType)) score += 2;
  if (handoff.causalDepth === 1) score += 1;
  return score;
}

function retainMemory(world, cell, memoryRecord, importance, lineageRef) {
  if (cell.memory.pendingCompaction) recoverCellMemoryCompaction(world, cell);
  if (cell.memory.pendingCompaction || cell.memory.compactionRepairRequired) {
    throw new Error('MEMORY_COMPACTION_REPAIR_REQUIRED');
  }

  if (importance >= 3) cell.memory.working.push(memoryRecord);
  if (importance >= 5) {
    cell.memory.episodic.push(memoryRecord);
    if (cell.memory.episodic.length > cell.memoryBudget.episodic) {
      cell.memory.episodic.splice(0, cell.memory.episodic.length - cell.memoryBudget.episodic);
    }
  }
  if (importance >= 8 && lineageRef) {
    cell.memory.lineageRefs.push(lineageRef);
    if (cell.memory.lineageRefs.length > cell.memoryBudget.lineageRefs) {
      cell.memory.lineageRefs.splice(0, cell.memory.lineageRefs.length - cell.memoryBudget.lineageRefs);
    }
  }

  return compactWorkingMemory(world, cell);
}

export function recordCommittedMemory(world, cell, event) {
  if (!world.memoryEnabled) return null;

  const importance = scoreEvent(event);
  const memoryRecord = {
    eventId: event.eventId,
    eventClass: event.type,
    actorId: event.actorId ?? null,
    revision: world.revision,
    importance,
    provenanceClass: 'CANONICAL',
  };

  const compaction = retainMemory(world, cell, memoryRecord, importance, event.eventId);
  const receipt = {
    schema: 'axm.echoworld.memory-receipt/v0.01',
    cellId: cell.cellId,
    eventId: event.eventId,
    revision: world.revision,
    provenanceClass: 'CANONICAL',
    importance,
    retainedWorking: importance >= 3,
    retainedEpisodic: importance >= 5,
    retainedLineage: importance >= 8,
    compaction,
  };
  world.receipts.memory.push(receipt);
  return receipt;
}

export function recordObservedHandoffMemory(
  world,
  cell,
  handoff,
  { sourceCommitKnown = false } = {},
) {
  if (!world.memoryEnabled) return null;

  const importance = scoreObservedHandoff(handoff);
  const memoryRecord = {
    eventId: handoff.eventId,
    eventClass: `OBSERVED_${handoff.type}`,
    actorId: null,
    revision: world.revision,
    importance,
    provenanceClass: 'OBSERVED',
    causalEventId: handoff.causalEventId,
    sourceRevision: handoff.sourceRevision,
    sourceCommitKnown,
    senderCellId: handoff.senderCellId,
    recipientCellId: handoff.recipientCellId,
    causalDepth: handoff.causalDepth,
  };

  const compaction = retainMemory(
    world,
    cell,
    memoryRecord,
    importance,
    sourceCommitKnown ? handoff.causalEventId : null,
  );
  const receipt = {
    schema: 'axm.echoworld.perception-memory-receipt/v0.01',
    cellId: cell.cellId,
    eventId: handoff.eventId,
    causalEventId: handoff.causalEventId,
    observedAtRevision: world.revision,
    sourceRevision: handoff.sourceRevision,
    sourceCommitKnown,
    provenanceClass: 'OBSERVED',
    importance,
    retainedWorking: importance >= 3,
    retainedEpisodic: importance >= 5,
    retainedLineage: importance >= 8 && sourceCommitKnown,
    compaction,
  };
  world.receipts.memory.push(receipt);
  return receipt;
}

export function memoryImportance(event) {
  return scoreEvent(event);
}

export function perceptionImportance(handoff) {
  return scoreObservedHandoff(handoff);
}
