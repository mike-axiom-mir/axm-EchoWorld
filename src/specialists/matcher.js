const MATCHERS = Object.freeze({
  MOVE: ['collision', 'movement', 'memory-importance'],
  DAMAGE_STRUCTURE: ['material', 'structural', 'memory-importance', 'sound'],
  FIRE: ['material', 'fire-propagation', 'memory-importance', 'sound', 'witness-perception'],
});

export function matchSpecialists(event) {
  return [...(MATCHERS[event.type] ?? ['memory-importance'])];
}

export function createSpecialistReceipts(world, cell, event, finishOrder = null) {
  const matched = matchSpecialists(event).slice(0, cell.specialistSpawnBudget);
  const order = finishOrder ?? matched;
  const receipts = order
    .filter((specialistId) => matched.includes(specialistId))
    .map((specialistId) => ({
      schema: 'axm.echoworld.specialist-receipt/v0.01',
      runId: `${event.eventId}:${cell.cellId}:${specialistId}`,
      specialistId,
      cellId: cell.cellId,
      baseRevision: world.revision,
      eventRef: event.eventId,
      proposal: { eventType: event.type, cellId: cell.cellId },
      status: 'PROPOSED',
    }));

  world.receipts.specialists.push(...receipts);
  return receipts;
}
