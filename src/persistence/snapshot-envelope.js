import { canonicalHash, persistWorld, reloadWorld } from '../core/state.js';
import {
  ATOMIC_SNAPSHOT_SCHEMA,
  LEGACY_ATOMIC_SNAPSHOT_SCHEMA,
  SUPPORTED_ATOMIC_SNAPSHOT_SCHEMAS,
  AtomicSnapshotError,
  sha256,
} from './atomic-types.js';
import {
  validateCheckpointAdmission,
  validateCheckpointAgainstWorld,
} from './checkpoint.js';

function legacyEnvelopeIdentity(envelope) {
  return {
    schema: envelope.schema,
    generation: envelope.generation,
    parentSnapshotId: envelope.parentSnapshotId,
    worldSchema: envelope.worldSchema,
    canonicalHash: envelope.canonicalHash,
    payloadHash: envelope.payloadHash,
    payloadEncoding: envelope.payloadEncoding,
    payload: envelope.payload,
  };
}

function envelopeIdentity(envelope) {
  if (envelope.schema === LEGACY_ATOMIC_SNAPSHOT_SCHEMA) return legacyEnvelopeIdentity(envelope);
  return { ...legacyEnvelopeIdentity(envelope), checkpoint: envelope.checkpoint ?? null };
}

function snapshotIdFor(envelope) {
  return `AS_${sha256(JSON.stringify(envelopeIdentity(envelope))).slice(0, 24)}`;
}

export function createAtomicSnapshotEnvelope(
  world,
  { generation, parentSnapshotId = null, checkpoint = null },
) {
  if (!Number.isInteger(generation) || generation < 1) {
    throw new AtomicSnapshotError(
      'INVALID_GENERATION',
      'Snapshot generation must be an integer of at least 1.',
      { generation },
    );
  }
  if (parentSnapshotId !== null && typeof parentSnapshotId !== 'string') {
    throw new AtomicSnapshotError(
      'INVALID_PARENT_SNAPSHOT_ID',
      'parentSnapshotId must be null or a string.',
    );
  }
  if (checkpoint !== null) {
    const checkpointValidation = validateCheckpointAgainstWorld(checkpoint, world);
    if (!checkpointValidation.valid) {
      throw new AtomicSnapshotError(
        checkpointValidation.reason,
        'Checkpoint admission does not match the world being serialized.',
        { checkpoint },
      );
    }
    if (
      checkpoint.admittedBaseGeneration !== generation - 1
      || checkpoint.admittedBaseSnapshotId !== parentSnapshotId
    ) {
      throw new AtomicSnapshotError(
        'CHECKPOINT_BASE_MISMATCH',
        'Checkpoint admission does not match the snapshot parent generation.',
        {
          admittedBaseGeneration: checkpoint.admittedBaseGeneration,
          admittedBaseSnapshotId: checkpoint.admittedBaseSnapshotId,
          generation,
          parentSnapshotId,
        },
      );
    }
  }

  const payload = persistWorld(world);
  const envelope = {
    schema: ATOMIC_SNAPSHOT_SCHEMA,
    generation,
    parentSnapshotId,
    worldSchema: world.schema,
    canonicalHash: canonicalHash(world),
    payloadHash: sha256(payload),
    payloadEncoding: 'utf8-json',
    payload,
    checkpoint,
  };
  return { ...envelope, snapshotId: snapshotIdFor(envelope) };
}

export function serializeAtomicSnapshotEnvelope(envelope) {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

function invalid(reason, details = {}) {
  return { valid: false, reason, details, envelope: null, world: null };
}

export function validateAtomicSnapshotText(text) {
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch (error) {
    return invalid('JSON_PARSE_FAILED', { message: error.message });
  }

  if (!SUPPORTED_ATOMIC_SNAPSHOT_SCHEMAS.includes(envelope?.schema)) {
    return invalid('SCHEMA_MISMATCH', { schema: envelope?.schema ?? null });
  }
  if (!Number.isInteger(envelope.generation) || envelope.generation < 1) {
    return invalid('INVALID_GENERATION', { generation: envelope.generation });
  }
  if (typeof envelope.payload !== 'string' || envelope.payloadEncoding !== 'utf8-json') {
    return invalid('INVALID_PAYLOAD');
  }
  if (sha256(envelope.payload) !== envelope.payloadHash) {
    return invalid('PAYLOAD_HASH_MISMATCH');
  }
  if (snapshotIdFor(envelope) !== envelope.snapshotId) {
    return invalid('SNAPSHOT_ID_MISMATCH');
  }
  if (envelope.schema === LEGACY_ATOMIC_SNAPSHOT_SCHEMA && envelope.checkpoint !== undefined) {
    return invalid('LEGACY_CHECKPOINT_NOT_ALLOWED');
  }
  if (envelope.schema === ATOMIC_SNAPSHOT_SCHEMA && envelope.checkpoint !== null) {
    const checkpointValidation = validateCheckpointAdmission(envelope.checkpoint);
    if (!checkpointValidation.valid) return invalid(checkpointValidation.reason);
    if (
      envelope.checkpoint.admittedBaseGeneration !== envelope.generation - 1
      || envelope.checkpoint.admittedBaseSnapshotId !== envelope.parentSnapshotId
    ) {
      return invalid('CHECKPOINT_BASE_MISMATCH');
    }
  }

  let world;
  try {
    world = reloadWorld(envelope.payload, { recoverMemoryCompactions: false });
  } catch (error) {
    return invalid('WORLD_RELOAD_FAILED', { message: error.message });
  }
  if (world.schema !== envelope.worldSchema) {
    return invalid('WORLD_SCHEMA_MISMATCH', {
      expected: envelope.worldSchema,
      actual: world.schema,
    });
  }
  const actualCanonicalHash = canonicalHash(world);
  if (actualCanonicalHash !== envelope.canonicalHash) {
    return invalid('CANONICAL_HASH_MISMATCH', {
      expected: envelope.canonicalHash,
      actual: actualCanonicalHash,
    });
  }
  if (envelope.checkpoint !== null && envelope.checkpoint !== undefined) {
    const checkpointWorldValidation = validateCheckpointAgainstWorld(envelope.checkpoint, world);
    if (!checkpointWorldValidation.valid) return invalid(checkpointWorldValidation.reason);
  }

  let recoveredWorld;
  try {
    recoveredWorld = reloadWorld(envelope.payload);
  } catch (error) {
    return invalid('WORLD_RECOVERY_FAILED', { message: error.message });
  }
  if (canonicalHash(recoveredWorld) !== envelope.canonicalHash) {
    return invalid('RECOVERED_CANONICAL_HASH_MISMATCH');
  }

  return { valid: true, reason: null, details: {}, envelope, world: recoveredWorld };
}
