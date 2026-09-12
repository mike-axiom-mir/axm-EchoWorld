import { createHash } from 'node:crypto';

export const MEMORY_COMPACTION_INTERRUPT_POINTS = Object.freeze([
  'AFTER_PREPARE',
  'AFTER_WORKING_SWAP',
  'AFTER_COMPRESSED_SWAP',
  'AFTER_COMMIT_RECEIPT',
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function ensureCompactionState(world, cell) {
  world.receipts ??= {};
  world.receipts.memoryCompactions ??= [];
  cell.memory.compactionGeneration ??= 0;
  cell.memory.pendingCompaction ??= null;
  cell.memory.lastCompactionId ??= null;
  cell.memory.compactionRepairRequired ??= false;
}

function summaryKey(item) {
  return `${item.provenanceClass ?? 'UNKNOWN'}|${item.eventClass}|${item.actorId ?? ''}`;
}

function buildCompactedState(cell) {
  const beforeWorking = clone(cell.memory.working);
  const beforeCompressed = clone(cell.memory.compressed);
  const budget = cell.memoryBudget.working;
  const overflowCount = Math.max(0, beforeWorking.length - budget);
  if (overflowCount === 0) return null;

  const overflow = beforeWorking.slice(0, overflowCount);
  const afterWorking = beforeWorking.slice(overflowCount);
  const afterCompressed = clone(beforeCompressed);
  const groups = new Map();

  for (const item of overflow) {
    const key = summaryKey(item);
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
    const existing = afterCompressed.find((item) => summaryKey(item) === summaryKey(summary));
    if (existing) {
      existing.count = Number(existing.count ?? 0) + summary.count;
      existing.firstRevision = Math.min(existing.firstRevision, summary.firstRevision);
      existing.lastRevision = Math.max(existing.lastRevision, summary.lastRevision);
    } else {
      afterCompressed.push(summary);
    }
  }

  if (afterCompressed.length > cell.memoryBudget.compressed) {
    afterCompressed.splice(0, afterCompressed.length - cell.memoryBudget.compressed);
  }

  return {
    overflow,
    overflowCount,
    beforeWorking,
    beforeCompressed,
    afterWorking,
    afterCompressed,
  };
}

function compactionId(cell, generation, plan) {
  const identity = {
    cellId: cell.cellId,
    generation,
    beforeWorkingHash: digest(plan.beforeWorking),
    beforeCompressedHash: digest(plan.beforeCompressed),
    afterWorkingHash: digest(plan.afterWorking),
    afterCompressedHash: digest(plan.afterCompressed),
  };
  return `MC_${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 20)}`;
}

function receipt(world, tx, status, extra = {}) {
  const item = {
    schema: 'axm.echoworld.memory-compaction-receipt/v0.02',
    compactionId: tx?.compactionId ?? null,
    cellId: tx?.cellId ?? null,
    generation: tx?.generation ?? null,
    status,
    stage: tx?.status ?? null,
    revision: world.revision ?? null,
    compactedCount: tx?.overflowCount ?? 0,
    workingBeforeCount: tx?.before?.working?.length ?? null,
    workingAfterCount: tx?.after?.working?.length ?? null,
    compressedBeforeCount: tx?.before?.compressed?.length ?? null,
    compressedAfterCount: tx?.after?.compressed?.length ?? null,
    sourceEventIds: tx?.sourceEventIds ?? [],
    beforeWorkingHash: tx?.before?.workingHash ?? null,
    beforeCompressedHash: tx?.before?.compressedHash ?? null,
    afterWorkingHash: tx?.after?.workingHash ?? null,
    afterCompressedHash: tx?.after?.compressedHash ?? null,
    ...extra,
  };
  world.receipts.memoryCompactions.push(item);
  return item;
}

function prepareCompaction(world, cell) {
  ensureCompactionState(world, cell);
  if (cell.memory.pendingCompaction) return cell.memory.pendingCompaction;

  const plan = buildCompactedState(cell);
  if (!plan) return null;
  const generation = cell.memory.compactionGeneration + 1;
  const tx = {
    schema: 'axm.echoworld.memory-compaction-journal/v0.02',
    compactionId: compactionId(cell, generation, plan),
    cellId: cell.cellId,
    generation,
    status: 'PREPARED',
    overflowCount: plan.overflowCount,
    sourceEventIds: plan.overflow.map((item) => item.eventId).filter(Boolean),
    before: {
      working: plan.beforeWorking,
      compressed: plan.beforeCompressed,
      workingHash: digest(plan.beforeWorking),
      compressedHash: digest(plan.beforeCompressed),
    },
    after: {
      working: plan.afterWorking,
      compressed: plan.afterCompressed,
      workingHash: digest(plan.afterWorking),
      compressedHash: digest(plan.afterCompressed),
    },
  };
  cell.memory.pendingCompaction = tx;
  return tx;
}

function interrupted(world, tx, interruptionPoint) {
  return receipt(world, tx, 'INTERRUPTED', { interruptionPoint });
}

function finalReceipt(world, tx, status = 'COMMITTED', extra = {}) {
  const existing = world.receipts.memoryCompactions.find(
    (item) => item.compactionId === tx.compactionId && ['COMMITTED', 'RECOVERED_COMMIT'].includes(item.status),
  );
  return existing ?? receipt(world, tx, status, extra);
}

export function compactWorkingMemory(world, cell, { interruptAt = null } = {}) {
  ensureCompactionState(world, cell);
  if (interruptAt !== null && !MEMORY_COMPACTION_INTERRUPT_POINTS.includes(interruptAt)) {
    throw new RangeError('Unknown memory compaction interrupt point.');
  }
  if (cell.memory.compactionRepairRequired) {
    throw new Error('MEMORY_COMPACTION_REPAIR_REQUIRED');
  }
  if (cell.memory.pendingCompaction) {
    throw new Error('MEMORY_COMPACTION_ALREADY_PENDING');
  }

  const tx = prepareCompaction(world, cell);
  if (!tx) return null;
  if (interruptAt === 'AFTER_PREPARE') return interrupted(world, tx, interruptAt);

  cell.memory.working = clone(tx.after.working);
  tx.status = 'WORKING_SWAPPED';
  if (interruptAt === 'AFTER_WORKING_SWAP') return interrupted(world, tx, interruptAt);

  cell.memory.compressed = clone(tx.after.compressed);
  tx.status = 'COMPRESSED_SWAPPED';
  if (interruptAt === 'AFTER_COMPRESSED_SWAP') return interrupted(world, tx, interruptAt);

  const committed = finalReceipt(world, tx, 'COMMITTED');
  tx.status = 'COMMIT_RECEIPT_WRITTEN';
  if (interruptAt === 'AFTER_COMMIT_RECEIPT') return interrupted(world, tx, interruptAt);

  cell.memory.compactionGeneration = tx.generation;
  cell.memory.lastCompactionId = tx.compactionId;
  cell.memory.compactionRepairRequired = false;
  cell.memory.pendingCompaction = null;
  return committed;
}

function snapshotValid(snapshot, key) {
  return snapshot && Array.isArray(snapshot[key]) && digest(snapshot[key]) === snapshot[`${key}Hash`];
}

function currentMatches(value, before, after) {
  const valueHash = digest(value);
  return valueHash === before || valueHash === after;
}

export function recoverCellMemoryCompaction(world, cell) {
  ensureCompactionState(world, cell);
  const tx = cell.memory.pendingCompaction;
  if (!tx) return null;

  const beforeValid = snapshotValid(tx.before, 'working') && snapshotValid(tx.before, 'compressed');
  const afterValid = snapshotValid(tx.after, 'working') && snapshotValid(tx.after, 'compressed');

  if (!beforeValid) {
    cell.memory.compactionRepairRequired = true;
    cell.wakeState = 'REPAIR';
    tx.status = 'REPAIR_REQUIRED';
    const existing = world.receipts.memoryCompactions.find(
      (item) => item.compactionId === tx.compactionId && item.status === 'RECOVERY_FAILED_CORRUPT_BEFORE',
    );
    return existing ?? receipt(world, tx, 'RECOVERY_FAILED_CORRUPT_BEFORE', { repairRequired: true });
  }
  if (!afterValid) {
    cell.memory.working = clone(tx.before.working);
    cell.memory.compressed = clone(tx.before.compressed);
    cell.memory.pendingCompaction = null;
    cell.memory.compactionRepairRequired = false;
    return receipt(world, tx, 'RECOVERED_ROLLBACK_CORRUPT_AFTER');
  }

  const stateRecognized = (
    currentMatches(cell.memory.working, tx.before.workingHash, tx.after.workingHash)
    && currentMatches(cell.memory.compressed, tx.before.compressedHash, tx.after.compressedHash)
  );
  if (!stateRecognized) {
    cell.memory.working = clone(tx.before.working);
    cell.memory.compressed = clone(tx.before.compressed);
    cell.memory.pendingCompaction = null;
    cell.memory.compactionRepairRequired = false;
    return receipt(world, tx, 'RECOVERED_ROLLBACK_DIVERGED_STATE');
  }

  cell.memory.working = clone(tx.after.working);
  cell.memory.compressed = clone(tx.after.compressed);
  const existed = world.receipts.memoryCompactions.some(
    (item) => item.compactionId === tx.compactionId && ['COMMITTED', 'RECOVERED_COMMIT'].includes(item.status),
  );
  const committed = finalReceipt(world, tx, 'RECOVERED_COMMIT', { recoveredFromStage: tx.status });
  cell.memory.compactionGeneration = Math.max(cell.memory.compactionGeneration, tx.generation);
  cell.memory.lastCompactionId = tx.compactionId;
  cell.memory.compactionRepairRequired = false;
  cell.memory.pendingCompaction = null;
  if (existed) receipt(world, tx, 'RECOVERED_CLEAR_COMMITTED', { recoveredFromStage: tx.status });
  return committed;
}

export function recoverPendingMemoryCompactions(world) {
  world.receipts ??= {};
  world.receipts.memoryCompactions ??= [];
  const results = [];
  for (const cellId of Object.keys(world.cells ?? {}).sort()) {
    const result = recoverCellMemoryCompaction(world, world.cells[cellId]);
    if (result) results.push(result);
  }
  return results;
}
