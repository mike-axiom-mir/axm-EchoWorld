import { canonicalHash, cellId, createWorld } from './state.js';
import { recordCommittedMemory } from '../memory/memory.js';
import { createSpecialistReceipts } from '../specialists/matcher.js';
import { neighborHandoffs } from '../handoff/events.js';

function wake(cell) {
  cell.wakeState = 'ACTIVE';
}

function sleep(cell, revision) {
  cell.lastActiveRevision = revision;
  cell.wakeState = 'DORMANT';
}

function fail(event, reason) {
  return {
    committed: false,
    eventId: event.eventId,
    reason,
  };
}

function validateMove(world, event) {
  const actor = world.actors[event.actorId];
  if (!actor) return fail(event, 'UNKNOWN_ACTOR');
  if (event.x < 0 || event.y < 0 || event.x >= world.width || event.y >= world.height) {
    return fail(event, 'OUT_OF_BOUNDS');
  }
  return { committed: true };
}

function validateDamage(world, event) {
  const target = world.cells[event.cellId];
  if (!target) return fail(event, 'UNKNOWN_CELL');
  if (target.truthState.type !== 'structure') return fail(event, 'NOT_STRUCTURE');
  return { committed: true };
}

function affectedCellIds(world, event) {
  if (event.type === 'MOVE') {
    const actor = world.actors[event.actorId];
    return [cellId(actor.x, actor.y), cellId(event.x, event.y)];
  }
  if (event.cellId) return [event.cellId];
  return [];
}

function applyCanonical(world, event) {
  if (event.type === 'MOVE') {
    const actor = world.actors[event.actorId];
    const from = world.cells[cellId(actor.x, actor.y)];
    const to = world.cells[cellId(event.x, event.y)];
    from.truthState.occupants = from.truthState.occupants.filter((id) => id !== event.actorId);
    if (!to.truthState.occupants.includes(event.actorId)) to.truthState.occupants.push(event.actorId);
    actor.x = event.x;
    actor.y = event.y;
    return;
  }

  if (event.type === 'DAMAGE_STRUCTURE') {
    const target = world.cells[event.cellId];
    const current = Number(target.truthState.properties.integrity ?? 0);
    const next = Math.max(0, current - Math.max(0, Number(event.amount ?? 0)));
    target.truthState.properties.integrity = next;
    if (next === 0) {
      target.truthState.properties.destroyed = true;
      target.truthState.material = 'debris';
    }
    return;
  }

  if (event.type === 'FIRE') {
    const target = world.cells[event.cellId];
    target.truthState.properties.burning = true;
  }
}

function validation(world, event) {
  if (!event?.eventId) return fail(event ?? {}, 'MISSING_EVENT_ID');
  if (event.type === 'MOVE') return validateMove(world, event);
  if (event.type === 'DAMAGE_STRUCTURE') return validateDamage(world, event);
  if (event.type === 'FIRE') {
    return world.cells[event.cellId] ? { committed: true } : fail(event, 'UNKNOWN_CELL');
  }
  return fail(event, 'UNKNOWN_EVENT_TYPE');
}

export function processEvent(world, event, { specialistFinishOrder = null } = {}) {
  const check = validation(world, event);
  if (!check.committed) {
    return {
      ...check,
      revision: world.revision,
      canonicalHash: canonicalHash(world),
    };
  }

  const ids = [...new Set(affectedCellIds(world, event))].sort();
  const cells = ids.map((id) => world.cells[id]);
  cells.forEach(wake);

  const preRevision = world.revision;
  for (const cell of cells) {
    createSpecialistReceipts(world, cell, event, specialistFinishOrder);
  }

  applyCanonical(world, event);
  world.revision += 1;
  for (const cell of cells) cell.canonicalRevision = world.revision;

  const truthReceipt = {
    schema: 'axm.echoworld.truth-merge-receipt/v0.01',
    eventId: event.eventId,
    baseRevision: preRevision,
    committedRevision: world.revision,
    affectedCellIds: ids,
    canonicalHash: canonicalHash(world),
  };
  world.receipts.truth.push(truthReceipt);

  for (const cell of cells) {
    recordCommittedMemory(world, cell, event);
    neighborHandoffs(world, cell, event);
    sleep(cell, world.revision);
  }

  return {
    committed: true,
    eventId: event.eventId,
    revision: world.revision,
    canonicalHash: truthReceipt.canonicalHash,
    affectedCellIds: ids,
  };
}

export function runScenario({ memoryEnabled = true, specialistFinishOrder = null } = {}) {
  const world = createWorld({ memoryEnabled });
  const events = [
    {
      eventId: 'E1',
      type: 'MOVE',
      actorId: 'A',
      x: 2,
      y: 1,
      relationshipRelevant: true,
      rare: true,
    },
    {
      eventId: 'E2',
      type: 'DAMAGE_STRUCTURE',
      actorId: 'A',
      cellId: 'C_2_1',
      amount: 100,
      structuralChange: true,
      injuryOrDestruction: true,
      rare: true,
    },
    {
      eventId: 'E3',
      type: 'MOVE',
      actorId: 'A',
      x: 3,
      y: 1,
      relationshipRelevant: true,
      rare: true,
    },
  ];

  for (const event of events) processEvent(world, event, { specialistFinishOrder });
  return world;
}
