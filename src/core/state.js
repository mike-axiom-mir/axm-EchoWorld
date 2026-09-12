import { createHash } from 'node:crypto';

import { recoverPendingMemoryCompactions } from '../memory/compaction.js';

export const MEMORY_BUDGET = Object.freeze({
  working: 16,
  episodic: 8,
  compressed: 4,
  lineageRefs: 16,
});

const DEFERRED_BACKFILL_DEFAULTS = Object.freeze({
  maxMailboxSize: 8,
  maxDeferredRetries: 3,
  deferredTtlEpochs: 8,
});

export function cellId(x, y) {
  return `C_${x}_${y}`;
}

export function createCell(x, y) {
  return {
    cellId: cellId(x, y),
    x,
    y,
    canonicalRevision: 0,
    truthState: {
      type: 'terrain',
      material: 'ground',
      occupants: [],
      properties: {},
    },
    memory: {
      working: [],
      episodic: [],
      compressed: [],
      lineageRefs: [],
      compactionGeneration: 0,
      pendingCompaction: null,
      lastCompactionId: null,
      compactionRepairRequired: false,
    },
    memoryBudget: { ...MEMORY_BUDGET },
    wakeState: 'DORMANT',
    activationCount: 0,
    specialistSpawnBudget: 8,
    authorityClass: 'CELL_LOCAL',
    lastWakeEventId: null,
    lastSleepEventId: null,
    lastActiveRevision: 0,
  };
}

export function createWorld({ width = 16, height = 16, memoryEnabled = true } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 5 || height < 2) {
    throw new RangeError('EchoWorld v0.01 requires integer dimensions of at least 5x2.');
  }

  const cells = {};
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = createCell(x, y);
      cells[cell.cellId] = cell;
    }
  }

  const world = {
    schema: 'axm.echoworld/v0.01',
    width,
    height,
    revision: 0,
    memoryEnabled,
    cells,
    actors: {
      A: { actorId: 'A', x: 1, y: 1 },
      B: { actorId: 'B', x: 4, y: 1 },
    },
    handoffState: {
      seenEventIds: [],
      seenArrivalKeys: [],
      schedulerJobs: {},
      deferredMailboxes: {},
    },
    receipts: {
      truth: [],
      memory: [],
      memoryCompactions: [],
      specialists: [],
      specialistMerges: [],
      handoffs: [],
      handoffGuards: [],
      handoffSchedules: [],
      perceptions: [],
      cellLifecycles: [],
      deferredDeliveries: [],
    },
  };

  world.cells[cellId(1, 1)].truthState.occupants.push('A');
  world.cells[cellId(4, 1)].truthState.occupants.push('B');
  world.cells[cellId(2, 1)].truthState.type = 'structure';
  world.cells[cellId(2, 1)].truthState.material = 'bridge';
  world.cells[cellId(2, 1)].truthState.properties.integrity = 100;

  return world;
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortObject(value[key])]),
    );
  }
  return value;
}

export function canonicalProjection(world) {
  const cells = {};
  for (const id of Object.keys(world.cells).sort()) {
    const cell = world.cells[id];
    cells[id] = {
      cellId: cell.cellId,
      x: cell.x,
      y: cell.y,
      canonicalRevision: cell.canonicalRevision,
      truthState: {
        type: cell.truthState.type,
        material: cell.truthState.material,
        occupants: [...cell.truthState.occupants].sort(),
        properties: sortObject(cell.truthState.properties),
      },
    };
  }

  const actors = {};
  for (const id of Object.keys(world.actors).sort()) {
    actors[id] = { ...world.actors[id] };
  }

  return {
    schema: world.schema,
    width: world.width,
    height: world.height,
    revision: world.revision,
    cells,
    actors,
  };
}

export function canonicalHash(world) {
  const encoded = JSON.stringify(canonicalProjection(world));
  return createHash('sha256').update(encoded).digest('hex');
}

export function persistWorld(world) {
  return JSON.stringify(world);
}

function backfillCell(cell) {
  cell.memory ??= {};
  cell.memory.working ??= [];
  cell.memory.episodic ??= [];
  cell.memory.compressed ??= [];
  cell.memory.lineageRefs ??= [];
  cell.memory.compactionGeneration ??= 0;
  cell.memory.pendingCompaction ??= null;
  cell.memory.lastCompactionId ??= null;
  cell.memory.compactionRepairRequired ??= false;
  cell.memoryBudget ??= { ...MEMORY_BUDGET };
  cell.wakeState ??= 'DORMANT';
  cell.activationCount ??= 0;
  cell.specialistSpawnBudget ??= 8;
  cell.authorityClass ??= 'CELL_LOCAL';
  cell.lastWakeEventId ??= null;
  cell.lastSleepEventId ??= null;
  cell.lastActiveRevision ??= 0;
}

function backfillSchedulerJob(job) {
  job.queue ??= [];
  job.processArrivals ??= true;
  job.maxMailboxSize ??= DEFERRED_BACKFILL_DEFAULTS.maxMailboxSize;
  job.maxDeferredRetries ??= DEFERRED_BACKFILL_DEFAULTS.maxDeferredRetries;
  job.deferredTtlEpochs ??= DEFERRED_BACKFILL_DEFAULTS.deferredTtlEpochs;
  job.deferredEpoch ??= 0;
  job.deferredCount ??= 0;
  job.deferredReleasedCount ??= 0;
  job.deferredRetryCount ??= 0;
  job.deferredExpiredCount ??= 0;
  job.deferredRetryExhaustedCount ??= 0;
  job.deferredCancelledSeenCount ??= 0;
  job.deferredReleaseBlockedCount ??= 0;
  job.droppedByMailboxBudget ??= 0;
  job.deferredDuplicateCount ??= 0;
  job.deferredDeliveryReasons ??= {};
}

function backfillDeferredMailboxes(world) {
  const mailboxes = world.handoffState.deferredMailboxes;
  for (const cellId of Object.keys(mailboxes)) {
    if (!Array.isArray(mailboxes[cellId])) {
      mailboxes[cellId] = [];
      continue;
    }
    for (const entry of mailboxes[cellId]) {
      entry.retryCount ??= 0;
      entry.maxRetries ??= DEFERRED_BACKFILL_DEFAULTS.maxDeferredRetries;
      entry.deferredAtEpoch ??= 0;
      entry.expiresAtEpoch ??= entry.deferredAtEpoch + DEFERRED_BACKFILL_DEFAULTS.deferredTtlEpochs;
    }
  }
}

export function reloadWorld(serialized, { recoverMemoryCompactions = true } = {}) {
  const world = JSON.parse(serialized);
  if (world?.schema !== 'axm.echoworld/v0.01' || !world.cells || !world.actors) {
    throw new Error('INVALID_ECHOWORLD_SNAPSHOT');
  }

  for (const cell of Object.values(world.cells)) backfillCell(cell);

  world.handoffState ??= {};
  world.handoffState.seenEventIds ??= [];
  world.handoffState.seenArrivalKeys ??= [];
  world.handoffState.schedulerJobs ??= {};
  world.handoffState.deferredMailboxes ??= {};
  for (const job of Object.values(world.handoffState.schedulerJobs)) backfillSchedulerJob(job);
  backfillDeferredMailboxes(world);

  world.receipts ??= {};
  world.receipts.truth ??= [];
  world.receipts.memory ??= [];
  world.receipts.memoryCompactions ??= [];
  world.receipts.specialists ??= [];
  world.receipts.specialistMerges ??= [];
  world.receipts.handoffs ??= [];
  world.receipts.handoffGuards ??= [];
  world.receipts.handoffSchedules ??= [];
  world.receipts.perceptions ??= [];
  world.receipts.cellLifecycles ??= [];
  world.receipts.deferredDeliveries ??= [];

  if (recoverMemoryCompactions) recoverPendingMemoryCompactions(world);
  return world;
}
