import { persistWorld, reloadWorld } from '../core/state.js';
import { AtomicSnapshotError, sha256 } from './atomic-types.js';
import {
  createCheckpointAdmission,
  inspectCheckpointBarrier,
} from './checkpoint.js';

export const CHECKPOINT_SESSION_SCHEMA = 'axm.echoworld.immutable-checkpoint-session/v0.01';

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

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function sessionIdentity(session) {
  return stable({
    schema: session.schema,
    writerId: session.writerId,
    leaseId: session.leaseId,
    fencingToken: session.fencingToken,
    admittedAtMs: session.admittedAtMs,
    admittedLogicalMs: session.admittedLogicalMs,
    clockObservationId: session.clockObservationId,
    baseGeneration: session.baseGeneration,
    baseSnapshotId: session.baseSnapshotId,
    sourcePayloadHash: session.sourcePayloadHash,
    snapshotPayloadHash: session.snapshotPayloadHash,
    worldRevision: session.worldRevision,
    operationalHash: session.operationalHash,
  });
}

export function createImmutableCheckpointSession({
  world,
  lease,
  baseGeneration,
  baseSnapshotId,
  admittedAtMs,
  admittedLogicalMs,
  clockObservationId,
  requireQuiescent = true,
} = {}) {
  if (!world || typeof world !== 'object') {
    throw new AtomicSnapshotError('INVALID_WORLD', 'world must be an object.');
  }
  if (!Number.isFinite(admittedAtMs) || !Number.isFinite(admittedLogicalMs)) {
    throw new AtomicSnapshotError('INVALID_CHECKPOINT_TIME', 'Checkpoint times must be finite.');
  }
  if (typeof clockObservationId !== 'string' || clockObservationId.length === 0) {
    throw new AtomicSnapshotError('INVALID_CLOCK_OBSERVATION_ID', 'clockObservationId is required.');
  }

  const sourcePayload = persistWorld(world);
  const sourcePayloadHash = sha256(sourcePayload);
  const snapshotWorld = reloadWorld(sourcePayload, { recoverMemoryCompactions: false });
  const snapshotPayload = persistWorld(snapshotWorld);
  const snapshotPayloadHash = sha256(snapshotPayload);
  const barrier = inspectCheckpointBarrier(snapshotWorld, { requireQuiescent });
  if (!barrier.admitted) {
    throw new AtomicSnapshotError(
      'CHECKPOINT_BARRIER_REJECTED',
      'The world is not quiescent enough for immutable checkpoint admission.',
      { barrier },
    );
  }

  const seed = {
    schema: CHECKPOINT_SESSION_SCHEMA,
    writerId: lease?.writerId ?? null,
    leaseId: lease?.leaseId ?? null,
    fencingToken: lease?.fencingToken ?? null,
    admittedAtMs,
    admittedLogicalMs,
    clockObservationId,
    baseGeneration,
    baseSnapshotId,
    sourcePayloadHash,
    snapshotPayloadHash,
    worldRevision: snapshotWorld.revision,
    operationalHash: barrier.operationalHash,
  };
  const sessionId = `CPS_${sha256(JSON.stringify(stable(seed))).slice(0, 24)}`;
  const checkpoint = createCheckpointAdmission({
    world: snapshotWorld,
    lease,
    baseGeneration,
    baseSnapshotId,
    admittedAtMs,
    admittedLogicalMs,
    clockObservationId,
    checkpointSessionId: sessionId,
    sourcePayloadHash: snapshotPayloadHash,
    requireQuiescent,
  });

  const session = {
    ...seed,
    sessionId,
    checkpoint,
    checkpointBarrier: barrier,
    snapshotPayload,
    snapshotWorld,
  };
  const expectedSessionId = `CPS_${sha256(JSON.stringify(sessionIdentity(session))).slice(0, 24)}`;
  if (expectedSessionId !== sessionId) {
    throw new AtomicSnapshotError('CHECKPOINT_SESSION_ID_MISMATCH', 'Checkpoint session identity is unstable.');
  }
  deepFreeze(snapshotWorld);
  deepFreeze(checkpoint);
  return Object.freeze(session);
}

export function checkpointSourceMutationEvidence(session, world) {
  if (!session || session.schema !== CHECKPOINT_SESSION_SCHEMA) {
    throw new AtomicSnapshotError('INVALID_CHECKPOINT_SESSION', 'A valid checkpoint session is required.');
  }
  const currentPayloadHash = sha256(persistWorld(world));
  return {
    schema: 'axm.echoworld.checkpoint-source-mutation-evidence/v0.01',
    sessionId: session.sessionId,
    sourcePayloadHash: session.sourcePayloadHash,
    currentPayloadHash,
    sourceWorldMutatedAfterAdmission: currentPayloadHash !== session.sourcePayloadHash,
  };
}

export { deepFreeze as deepFreezeCheckpointValue };
