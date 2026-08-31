import { canonicalHash } from '../core/state.js';
import { AtomicSnapshotError, sha256 } from './atomic-types.js';
import { WRITER_LEASE_SCHEMAS } from './writer-lease.js';

export const CHECKPOINT_ADMISSION_SCHEMA = 'axm.echoworld.checkpoint-admission/v0.01';

const QUIESCENT_WAKE_STATES = new Set(['DORMANT', 'REPAIR']);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function schedulerProjection(world) {
  const jobs = world.handoffState?.schedulerJobs ?? {};
  return Object.fromEntries(
    Object.keys(jobs)
      .sort()
      .map((schedulerId) => {
        const job = jobs[schedulerId];
        return [schedulerId, {
          schedulerId,
          baseRevision: job.baseRevision ?? null,
          status: job.status ?? null,
          processArrivals: job.processArrivals ?? null,
          deferredEpoch: job.deferredEpoch ?? null,
          queue: (job.queue ?? []).map((handoff) => ({
            eventId: handoff.eventId,
            causalEventId: handoff.causalEventId,
            senderCellId: handoff.senderCellId,
            recipientCellId: handoff.recipientCellId,
            causalDepth: handoff.causalDepth,
            hopLimit: handoff.hopLimit,
          })),
        }];
      }),
  );
}

function mailboxProjection(world) {
  const mailboxes = world.handoffState?.deferredMailboxes ?? {};
  return Object.fromEntries(
    Object.keys(mailboxes)
      .sort()
      .map((cellId) => [cellId, (mailboxes[cellId] ?? []).map((entry) => ({
        schedulerId: entry.schedulerId,
        eventId: entry.handoff?.eventId ?? null,
        causalEventId: entry.handoff?.causalEventId ?? null,
        recipientCellId: entry.handoff?.recipientCellId ?? null,
        retryCount: entry.retryCount ?? null,
        maxRetries: entry.maxRetries ?? null,
        deferredAtEpoch: entry.deferredAtEpoch ?? null,
        expiresAtEpoch: entry.expiresAtEpoch ?? null,
      }))]),
  );
}

function compactionProjection(world) {
  return Object.fromEntries(
    Object.keys(world.cells ?? {})
      .sort()
      .filter((cellId) => Boolean(world.cells[cellId].memory?.pendingCompaction))
      .map((cellId) => {
        const tx = world.cells[cellId].memory.pendingCompaction;
        return [cellId, {
          compactionId: tx.compactionId,
          generation: tx.generation,
          status: tx.status,
          beforeWorkingHash: tx.before?.workingHash ?? null,
          beforeCompressedHash: tx.before?.compressedHash ?? null,
          afterWorkingHash: tx.after?.workingHash ?? null,
          afterCompressedHash: tx.after?.compressedHash ?? null,
        }];
      }),
  );
}

export function checkpointOperationalProjection(world) {
  return stable({
    seenEventIds: [...(world.handoffState?.seenEventIds ?? [])].sort(),
    seenArrivalKeys: [...(world.handoffState?.seenArrivalKeys ?? [])].sort(),
    schedulerJobs: schedulerProjection(world),
    deferredMailboxes: mailboxProjection(world),
    pendingCompactions: compactionProjection(world),
    cellActivationState: Object.fromEntries(
      Object.keys(world.cells ?? {})
        .sort()
        .map((cellId) => [cellId, {
          wakeState: world.cells[cellId].wakeState,
          activationCount: world.cells[cellId].activationCount ?? 0,
          lastWakeEventId: world.cells[cellId].lastWakeEventId ?? null,
          lastSleepEventId: world.cells[cellId].lastSleepEventId ?? null,
        }]),
    ),
  });
}

export function inspectCheckpointBarrier(world, { requireQuiescent = true } = {}) {
  const transientCells = Object.keys(world.cells ?? {})
    .sort()
    .filter((cellId) => !QUIESCENT_WAKE_STATES.has(world.cells[cellId].wakeState))
    .map((cellId) => ({ cellId, wakeState: world.cells[cellId].wakeState }));
  const operationalProjection = checkpointOperationalProjection(world);
  const schedulerJobs = Object.keys(world.handoffState?.schedulerJobs ?? {}).length;
  const queuedHandoffs = Object.values(world.handoffState?.schedulerJobs ?? {})
    .reduce((total, job) => total + (job.queue?.length ?? 0), 0);
  const deferredHandoffs = Object.values(world.handoffState?.deferredMailboxes ?? {})
    .reduce((total, mailbox) => total + (mailbox?.length ?? 0), 0);
  const pendingCompactions = Object.values(world.cells ?? {})
    .filter((cell) => Boolean(cell.memory?.pendingCompaction)).length;

  return {
    schema: 'axm.echoworld.checkpoint-barrier-inspection/v0.01',
    admitted: !requireQuiescent || transientCells.length === 0,
    reason: requireQuiescent && transientCells.length > 0 ? 'UNQUIESCED_CELL' : null,
    transientCells,
    operationalHash: sha256(JSON.stringify(operationalProjection)),
    counts: {
      schedulerJobs,
      queuedHandoffs,
      deferredHandoffs,
      pendingCompactions,
      seenEventIds: world.handoffState?.seenEventIds?.length ?? 0,
      seenArrivalKeys: world.handoffState?.seenArrivalKeys?.length ?? 0,
    },
  };
}

function checkpointIdentity(checkpoint) {
  const { checkpointId, ...identity } = checkpoint;
  return stable(identity);
}

export function createCheckpointAdmission({
  world,
  lease,
  baseGeneration,
  baseSnapshotId,
  admittedAtMs,
  requireQuiescent = true,
}) {
  if (!lease || lease.schema !== WRITER_LEASE_SCHEMAS.handle) {
    throw new AtomicSnapshotError('INVALID_WRITER_LEASE_HANDLE', 'A writer lease is required.');
  }
  if (!Number.isInteger(baseGeneration) || baseGeneration < 0) {
    throw new AtomicSnapshotError('INVALID_CHECKPOINT_BASE_GENERATION', 'baseGeneration must be non-negative.');
  }
  const barrier = inspectCheckpointBarrier(world, { requireQuiescent });
  if (!barrier.admitted) {
    throw new AtomicSnapshotError('CHECKPOINT_BARRIER_REJECTED', 'World is not quiescent enough for checkpoint admission.', {
      barrier,
    });
  }

  const checkpoint = {
    schema: CHECKPOINT_ADMISSION_SCHEMA,
    writerId: lease.writerId,
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken,
    admittedAtMs,
    admittedBaseGeneration: baseGeneration,
    admittedBaseSnapshotId: baseSnapshotId,
    worldRevision: world.revision,
    canonicalHash: canonicalHash(world),
    operationalHash: barrier.operationalHash,
    operationalCounts: barrier.counts,
  };
  return {
    ...checkpoint,
    checkpointId: `CP_${sha256(JSON.stringify(checkpointIdentity(checkpoint))).slice(0, 24)}`,
  };
}

export function validateCheckpointAdmission(checkpoint) {
  if (!checkpoint || checkpoint.schema !== CHECKPOINT_ADMISSION_SCHEMA) {
    return { valid: false, reason: 'CHECKPOINT_SCHEMA_MISMATCH' };
  }
  for (const field of ['writerId', 'leaseId', 'checkpointId', 'canonicalHash', 'operationalHash']) {
    if (typeof checkpoint[field] !== 'string' || checkpoint[field].length === 0) {
      return { valid: false, reason: `INVALID_${field.toUpperCase()}` };
    }
  }
  if (!Number.isInteger(checkpoint.fencingToken) || checkpoint.fencingToken < 1) {
    return { valid: false, reason: 'INVALID_FENCING_TOKEN' };
  }
  if (!Number.isInteger(checkpoint.admittedBaseGeneration) || checkpoint.admittedBaseGeneration < 0) {
    return { valid: false, reason: 'INVALID_ADMITTED_BASE_GENERATION' };
  }
  if (!Number.isInteger(checkpoint.worldRevision) || checkpoint.worldRevision < 0) {
    return { valid: false, reason: 'INVALID_WORLD_REVISION' };
  }
  if (!Number.isFinite(checkpoint.admittedAtMs)) {
    return { valid: false, reason: 'INVALID_ADMITTED_AT' };
  }
  const expectedId = `CP_${sha256(JSON.stringify(checkpointIdentity(checkpoint))).slice(0, 24)}`;
  if (expectedId !== checkpoint.checkpointId) {
    return { valid: false, reason: 'CHECKPOINT_ID_MISMATCH' };
  }
  return { valid: true, reason: null };
}

export function validateCheckpointAgainstWorld(checkpoint, world) {
  const validation = validateCheckpointAdmission(checkpoint);
  if (!validation.valid) return validation;
  if (checkpoint.worldRevision !== world.revision) {
    return { valid: false, reason: 'CHECKPOINT_WORLD_REVISION_MISMATCH' };
  }
  if (checkpoint.canonicalHash !== canonicalHash(world)) {
    return { valid: false, reason: 'CHECKPOINT_CANONICAL_HASH_MISMATCH' };
  }
  const operationalHash = sha256(JSON.stringify(checkpointOperationalProjection(world)));
  if (checkpoint.operationalHash !== operationalHash) {
    return { valid: false, reason: 'CHECKPOINT_OPERATIONAL_HASH_MISMATCH' };
  }
  return { valid: true, reason: null };
}
