function ensureHandoffState(world) {
  world.handoffState ??= { seenEventIds: [] };
  world.receipts.handoffGuards ??= [];
  return world.handoffState;
}

function offsets() {
  return [[1, 0], [-1, 0], [0, 1], [0, -1]];
}

export function neighborHandoffs(world, originCell, event, { hopLimit = 2 } = {}) {
  if (!['FIRE', 'DAMAGE_STRUCTURE'].includes(event.type)) return [];
  const handoffs = [];
  for (const [dx, dy] of offsets()) {
    const x = originCell.x + dx;
    const y = originCell.y + dy;
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
    handoffs.push({
      schema: 'axm.echoworld.handoff/v0.01',
      eventId: `${event.eventId}:handoff:${x}:${y}`,
      causalEventId: event.eventId,
      originCellId: originCell.cellId,
      senderCellId: originCell.cellId,
      recipientCellId: `C_${x}_${y}`,
      type: 'SOUND',
      parameters: { sourceEventType: event.type },
      sourceRevision: world.revision,
      causalDepth: 1,
      hopLimit,
      path: [originCell.cellId],
    });
  }
  world.receipts.handoffs.push(...handoffs);
  return handoffs;
}

export function acceptHandoff(world, handoff) {
  const state = ensureHandoffState(world);
  let reason = null;

  if (!handoff?.eventId) reason = 'MISSING_EVENT_ID';
  else if (state.seenEventIds.includes(handoff.eventId)) reason = 'DUPLICATE_HANDOFF';
  else if (!world.cells[handoff.senderCellId] || !world.cells[handoff.recipientCellId]) reason = 'UNKNOWN_CELL';
  else if (!Number.isInteger(handoff.causalDepth) || !Number.isInteger(handoff.hopLimit) || handoff.hopLimit < 0) reason = 'INVALID_HOP_BUDGET';
  else if (handoff.causalDepth > handoff.hopLimit) reason = 'HOP_LIMIT_EXCEEDED';
  else if ((handoff.path ?? []).includes(handoff.recipientCellId)) reason = 'CYCLE_DETECTED';

  const accepted = reason === null;
  if (accepted) state.seenEventIds.push(handoff.eventId);

  const receipt = {
    schema: 'axm.echoworld.handoff-guard-receipt/v0.01',
    eventId: handoff?.eventId ?? null,
    accepted,
    reason,
    causalDepth: handoff?.causalDepth ?? null,
    hopLimit: handoff?.hopLimit ?? null,
    senderCellId: handoff?.senderCellId ?? null,
    recipientCellId: handoff?.recipientCellId ?? null,
  };
  world.receipts.handoffGuards.push(receipt);
  return receipt;
}

export function propagateAcceptedHandoff(world, handoff) {
  const guard = acceptHandoff(world, handoff);
  if (!guard.accepted || handoff.causalDepth >= handoff.hopLimit) return [];

  const sender = world.cells[handoff.recipientCellId];
  const path = [...(handoff.path ?? [handoff.senderCellId]), handoff.recipientCellId];
  const nextDepth = handoff.causalDepth + 1;
  const handoffs = [];

  for (const [dx, dy] of offsets()) {
    const x = sender.x + dx;
    const y = sender.y + dy;
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
    handoffs.push({
      ...handoff,
      eventId: `${handoff.eventId}:hop:${nextDepth}:${x}:${y}`,
      senderCellId: sender.cellId,
      recipientCellId: `C_${x}_${y}`,
      sourceRevision: world.revision,
      causalDepth: nextDepth,
      path,
    });
  }

  world.receipts.handoffs.push(...handoffs);
  return handoffs;
}
