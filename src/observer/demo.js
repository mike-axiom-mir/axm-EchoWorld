import { canonicalHash, createWorld } from '../core/state.js';
import { processEvent } from '../core/world.js';

const EVENTS = Object.freeze([
  {
    eventId: 'DEMO_MOVE_TO_BRIDGE',
    type: 'MOVE',
    actorId: 'A',
    x: 2,
    y: 1,
    relationshipRelevant: true,
    rare: true,
    title: 'A steps onto the bridge',
    intent: 'Move actor A from ground onto the bridge cell.',
  },
  {
    eventId: 'DEMO_BRIDGE_IMPACT',
    type: 'DAMAGE_STRUCTURE',
    actorId: 'A',
    cellId: 'C_2_1',
    amount: 35,
    structuralChange: true,
    injuryOrDestruction: true,
    rare: true,
    title: 'The bridge takes an impact',
    intent: 'Reduce bridge integrity by 35 and propagate a bounded sound observation.',
  },
  {
    eventId: 'DEMO_REJECTED_MOVE',
    type: 'MOVE',
    actorId: 'A',
    x: 16,
    y: 1,
    title: 'An impossible move is attempted',
    intent: 'Try to move beyond the 16×16 world boundary.',
  },
  {
    eventId: 'DEMO_BRIDGE_FIRE',
    type: 'FIRE',
    cellId: 'C_2_1',
    structuralChange: true,
    rare: true,
    title: 'Fire starts on the bridge',
    intent: 'Mark the bridge as burning and propagate another bounded observation.',
  },
  {
    eventId: 'DEMO_BRIDGE_COLLAPSE',
    type: 'DAMAGE_STRUCTURE',
    actorId: 'A',
    cellId: 'C_2_1',
    amount: 65,
    structuralChange: true,
    injuryOrDestruction: true,
    rare: true,
    title: 'The damaged bridge collapses',
    intent: 'Reduce integrity to zero; canonical material becomes debris.',
  },
]);

const RECEIPT_GROUPS = Object.freeze([
  'truth',
  'memory',
  'specialists',
  'specialistMerges',
  'handoffs',
  'handoffGuards',
  'handoffSchedules',
  'perceptions',
  'cellLifecycles',
]);

function receiptCounts(world) {
  return Object.fromEntries(RECEIPT_GROUPS.map((key) => [key, world.receipts[key].length]));
}

function receiptDelta(before, after) {
  return Object.fromEntries(RECEIPT_GROUPS.map((key) => [key, after[key] - before[key]]));
}

function memoryCount(cell) {
  return cell.memory.working.length + cell.memory.episodic.length + cell.memory.compressed.length;
}

function snapshotCells(world) {
  return Object.values(world.cells)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((cell) => ({
      cellId: cell.cellId,
      x: cell.x,
      y: cell.y,
      revision: cell.canonicalRevision,
      type: cell.truthState.type,
      material: cell.truthState.material,
      occupants: [...cell.truthState.occupants].sort(),
      integrity: cell.truthState.properties.integrity ?? null,
      burning: cell.truthState.properties.burning === true,
      destroyed: cell.truthState.properties.destroyed === true,
      memoryCount: memoryCount(cell),
      activationCount: cell.activationCount,
    }));
}

function snapshotActors(world) {
  return Object.values(world.actors)
    .sort((a, b) => a.actorId.localeCompare(b.actorId))
    .map((actor) => ({ ...actor }));
}

function publicEvent(event) {
  if (!event) return null;
  const {
    title,
    intent,
    relationshipRelevant: _relationshipRelevant,
    structuralChange: _structuralChange,
    injuryOrDestruction: _injuryOrDestruction,
    rare: _rare,
    ...input
  } = event;
  return { title, intent, input };
}

function frameFrom(world, {
  index,
  event = null,
  result = null,
  countsBefore = receiptCounts(world),
  perceptionsBefore = world.receipts.perceptions.length,
} = {}) {
  const countsAfter = receiptCounts(world);
  const perceptions = world.receipts.perceptions.slice(perceptionsBefore);
  const depthByCell = {};
  for (const perception of perceptions) {
    const prior = depthByCell[perception.cellId];
    depthByCell[perception.cellId] = prior == null
      ? perception.causalDepth
      : Math.min(prior, perception.causalDepth);
  }

  const scheduler = result?.handoffScheduleReceipt ?? null;
  return {
    index,
    event: publicEvent(event),
    outcome: result
      ? {
          committed: result.committed,
          reason: result.reason ?? null,
          revision: result.revision,
          canonicalHash: result.canonicalHash,
          affectedCellIds: result.affectedCellIds ?? [],
        }
      : {
          committed: null,
          reason: null,
          revision: world.revision,
          canonicalHash: canonicalHash(world),
          affectedCellIds: [],
        },
    world: {
      width: world.width,
      height: world.height,
      revision: world.revision,
      canonicalHash: canonicalHash(world),
      actors: snapshotActors(world),
      cells: snapshotCells(world),
    },
    observation: {
      depthByCell,
      perceivedCellIds: Object.keys(depthByCell).sort(),
      scheduler: scheduler
        ? {
            status: scheduler.status,
            initialCount: scheduler.initialCount,
            processedCount: scheduler.run.processedCount,
            acceptedCount: scheduler.run.acceptedCount,
            rejectedCount: scheduler.run.rejectedCount,
            maxQueueObserved: scheduler.maxQueueObserved,
            canonicalMutationApplied: scheduler.canonicalMutationApplied,
            canonicalHashBefore: scheduler.canonicalHashBefore,
            canonicalHashAfter: scheduler.canonicalHashAfter,
          }
        : null,
    },
    receipts: {
      total: countsAfter,
      delta: receiptDelta(countsBefore, countsAfter),
    },
  };
}

export function buildDemo({ memoryEnabled = true } = {}) {
  const world = createWorld({ memoryEnabled });
  const frames = [frameFrom(world, { index: 0 })];

  for (const event of EVENTS) {
    const countsBefore = receiptCounts(world);
    const perceptionsBefore = world.receipts.perceptions.length;
    const result = processEvent(world, event, {
      handoffHopLimit: 4,
      handoffScheduler: { maxProcessed: 512, maxQueueSize: 512 },
    });
    frames.push(frameFrom(world, {
      index: frames.length,
      event,
      result,
      countsBefore,
      perceptionsBefore,
    }));
  }

  return {
    schema: 'axm.echoworld.causal-observer-demo/v0.01',
    memoryEnabled,
    frames,
  };
}

export function buildObserverPayload() {
  const withMemory = buildDemo({ memoryEnabled: true });
  const withoutMemory = buildDemo({ memoryEnabled: false });
  const truthComparison = withMemory.frames.map((frame, index) => ({
    index,
    revision: frame.world.revision,
    withMemory: frame.world.canonicalHash,
    withoutMemory: withoutMemory.frames[index].world.canonicalHash,
    equal: frame.world.canonicalHash === withoutMemory.frames[index].world.canonicalHash,
  }));

  return {
    schema: 'axm.echoworld.causal-observer/v0.01',
    source: 'Generated by the EchoWorld deterministic core; no browser-side state mutation.',
    authorityBoundary: 'Canonical truth is the core world projection. Memory, perception, animation, and this observer are non-authoritative realizations.',
    controls: 'Arrow keys step; Home/End jump; Space plays or pauses; M toggles the memory layer.',
    truthComparison,
    frames: withMemory.frames,
  };
}
