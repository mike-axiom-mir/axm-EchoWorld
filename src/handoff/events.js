function ensureHandoffState(world) {
  world.handoffState ??= {};
  world.handoffState.seenEventIds ??= [];
  world.handoffState.seenArrivalKeys ??= [];
  world.receipts.handoffs ??= [];
  world.receipts.handoffGuards ??= [];
  return world.handoffState;
}

function offsets() {
  return [[1, 0], [-1, 0], [0, 1], [0, -1]];
}

export function handoffArrivalKey(handoff) {
  const causalEventId = handoff?.causalEventId ?? handoff?.eventId ?? 'MISSING_CAUSE';
  const type = handoff?.type ?? 'UNKNOWN';
  const recipientCellId = handoff?.recipientCellId ?? 'UNKNOWN_CELL';
  return `${causalEventId}|${type}|${recipientCellId}`;
}

export function handoffOrderKey(handoff) {
  const depth = Number.isInteger(handoff?.causalDepth) ? handoff.causalDepth : Number.MAX_SAFE_INTEGER;
  return [
    String(depth).padStart(8, '0'),
    handoff?.causalEventId ?? '',
    handoff?.type ?? '',
    handoff?.senderCellId ?? '',
    handoff?.recipientCellId ?? '',
    handoff?.eventId ?? '',
  ].join('|');
}

export function compareHandoffs(a, b) {
  return handoffOrderKey(a).localeCompare(handoffOrderKey(b));
}

function nextEventId(handoff, senderCellId, recipientCellId, causalDepth) {
  const cause = handoff.causalEventId ?? handoff.eventId;
  const type = handoff.type ?? 'UNKNOWN';
  return `${cause}:${type}:d${causalDepth}:${senderCellId}>${recipientCellId}`;
}

export function neighborHandoffs(world, originCell, event, { hopLimit = 2 } = {}) {
  if (!['FIRE', 'DAMAGE_STRUCTURE'].includes(event.type)) return [];
  if (!Number.isInteger(hopLimit) || hopLimit < 1) {
    throw new RangeError('hopLimit must be an integer of at least 1.');
  }

  const handoffs = [];
  for (const [dx, dy] of offsets()) {
    const x = originCell.x + dx;
    const y = originCell.y + dy;
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
    const recipientCellId = `C_${x}_${y}`;
    handoffs.push({
      schema: 'axm.echoworld.handoff/v0.01',
      eventId: nextEventId(
        { causalEventId: event.eventId, type: 'SOUND' },
        originCell.cellId,
        recipientCellId,
        1,
      ),
      causalEventId: event.eventId,
      originCellId: originCell.cellId,
      senderCellId: originCell.cellId,
      recipientCellId,
      type: 'SOUND',
      parameters: { sourceEventType: event.type },
      sourceRevision: world.revision,
      causalDepth: 1,
      hopLimit,
      path: [originCell.cellId],
    });
  }

  handoffs.sort(compareHandoffs);
  world.receipts.handoffs.push(...handoffs);
  return handoffs;
}

export function acceptHandoff(world, handoff) {
  const state = ensureHandoffState(world);
  const arrivalKey = handoffArrivalKey(handoff);
  let reason = null;

  if (!handoff?.eventId) reason = 'MISSING_EVENT_ID';
  else if (state.seenEventIds.includes(handoff.eventId)) reason = 'DUPLICATE_HANDOFF';
  else if (!world.cells[handoff.senderCellId] || !world.cells[handoff.recipientCellId]) reason = 'UNKNOWN_CELL';
  else if (
    !Number.isInteger(handoff.causalDepth)
    || !Number.isInteger(handoff.hopLimit)
    || handoff.causalDepth < 1
    || handoff.hopLimit < 1
  ) reason = 'INVALID_HOP_BUDGET';
  else if (handoff.causalDepth > handoff.hopLimit) reason = 'HOP_LIMIT_EXCEEDED';
  else if ((handoff.path ?? []).includes(handoff.recipientCellId)) reason = 'CYCLE_DETECTED';
  else if (state.seenArrivalKeys.includes(arrivalKey)) reason = 'DUPLICATE_CAUSAL_ARRIVAL';

  const accepted = reason === null;
  if (accepted) {
    state.seenEventIds.push(handoff.eventId);
    state.seenArrivalKeys.push(arrivalKey);
    state.seenEventIds.sort();
    state.seenArrivalKeys.sort();
  }

  const receipt = {
    schema: 'axm.echoworld.handoff-guard-receipt/v0.01',
    eventId: handoff?.eventId ?? null,
    causalEventId: handoff?.causalEventId ?? null,
    arrivalKey,
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

export function deriveNextHandoffs(world, handoff) {
  if (handoff.causalDepth >= handoff.hopLimit) return [];

  const sender = world.cells[handoff.recipientCellId];
  const path = [...(handoff.path ?? [handoff.senderCellId]), handoff.recipientCellId];
  const nextDepth = handoff.causalDepth + 1;
  const handoffs = [];

  for (const [dx, dy] of offsets()) {
    const x = sender.x + dx;
    const y = sender.y + dy;
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;

    const recipientCellId = `C_${x}_${y}`;
    handoffs.push({
      ...handoff,
      eventId: nextEventId(handoff, sender.cellId, recipientCellId, nextDepth),
      senderCellId: sender.cellId,
      recipientCellId,
      sourceRevision: world.revision,
      causalDepth: nextDepth,
      path,
    });
  }

  handoffs.sort(compareHandoffs);
  world.receipts.handoffs.push(...handoffs);
  return handoffs;
}

export function acceptAndPropagateHandoff(world, handoff) {
  const guard = acceptHandoff(world, handoff);
  const handoffs = guard.accepted ? deriveNextHandoffs(world, handoff) : [];
  return { guard, handoffs };
}

export function propagateAcceptedHandoff(world, handoff) {
  return acceptAndPropagateHandoff(world, handoff).handoffs;
}
