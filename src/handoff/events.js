export function neighborHandoffs(world, originCell, event, { hopLimit = 2 } = {}) {
  if (!['FIRE', 'DAMAGE_STRUCTURE'].includes(event.type)) return [];

  const offsets = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  const handoffs = [];
  for (const [dx, dy] of offsets) {
    const x = originCell.x + dx;
    const y = originCell.y + dy;
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
    handoffs.push({
      schema: 'axm.echoworld.handoff/v0.01',
      eventId: `${event.eventId}:handoff:${x}:${y}`,
      originCellId: originCell.cellId,
      senderCellId: originCell.cellId,
      recipientCellId: `C_${x}_${y}`,
      type: 'SOUND',
      parameters: { sourceEventType: event.type },
      sourceRevision: world.revision,
      causalDepth: 1,
      hopLimit,
    });
  }

  world.receipts.handoffs.push(...handoffs);
  return handoffs;
}
