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

function compactWorking(cell) {
  const { working, compressed } = cell.memory;
  const budget = cell.memoryBudget.working;
  if (working.length <= budget) return null;

  const overflow = working.splice(0, working.length - budget);
  const groups = new Map();
  for (const item of overflow) {
    const key = `${item.provenanceClass ?? 'UNKNOWN'}|${item.eventClass}|${item.actorId ?? ''}`;
    const existing = groups.get(key) ?? {
      provenanceClass: item.provenanceClass ?? 'UNKNOWN',
      eventClass: item.eventClass,
      actorId: item.actorId ?? null,
      count: 0,
      firstRevision: item.revision,
      lastRevision: item.revision,
    };
    existing.count += 1;
    existing.firstRevision = Math.min(existing.firstRevision, item.revision);
    existing.lastRevision = Math.max(existing.lastRevision, item.revision);
    groups.set(key, existing);
  }

  for (const summary of groups.values()) {
    const existing = compressed.find(
      (item) => (
        item.provenanceClass === summary.provenanceClass
        && item.eventClass === summary.eventClass
        && item.actorId === summary.actorId
      ),
    );
    if (existing) {
      existing.count += summary.count;
      existing.firstRevision = Math.min(existing.firstRevision, summary.firstRevision);
      existing.lastRevision = Math.max(existing.lastRevision, summary.lastRevision);
    } else {
      compressed.push(summary);
    }
  }

  if (compressed.length > cell.memoryBudget.compressed) {
    compressed.splice(0, compressed.length - cell.memoryBudget.compressed);
  }

  return {
    schema: 'axm.echoworld.memory-compaction-receipt/v0.01',
    cellId: cell.cellId,
    compactedCount: overflow.length,
    compressedCount: compressed.length,
  };
}

function retainMemory(cell, memoryRecord, importance, lineageRef) {
  if (importance >= 3) {
    cell.memory.working.push(memoryRecord);
  }
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

  return compactWorking(cell);
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

  const compaction = retainMemory(cell, memoryRecord, importance, event.eventId);
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
