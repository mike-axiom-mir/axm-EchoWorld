import { createHash } from 'node:crypto';

import { canonicalHash, canonicalProjection, createWorld } from './core/state.js';
import { processEvent } from './core/world.js';

const INPUT_SCHEMA = 'axm.echoworld.event-stream/v0.01';
const RECEIPT_SCHEMA = 'axm.echoworld.portable-replay/v0.01';
const VERIFICATION_SCHEMA = 'axm.echoworld.portable-replay-verification/v0.01';
const MAX_DIMENSION = 64;
const MAX_EVENTS = 128;
const COMMON_EVENT_KEYS = [
  'eventId',
  'type',
  'actorId',
  'relationshipRelevant',
  'rare',
  'structuralChange',
  'injuryOrDestruction',
];

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function requireExactKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} contains unsupported fields: ${unexpected.sort().join(', ')}`);
  }
}

function boundedString(value, label) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
    throw new TypeError(`${label} must be a non-empty string of at most 128 characters`);
  }
  return value;
}

function optionalBoolean(source, target, key, label) {
  if (!(key in source)) return;
  if (typeof source[key] !== 'boolean') throw new TypeError(`${label}.${key} must be boolean`);
  target[key] = source[key];
}

function normalizeEvent(event, index) {
  const label = `events[${index}]`;
  requireObject(event, label);
  const type = boundedString(event.type, `${label}.type`);
  let allowed;
  if (type === 'MOVE') allowed = [...COMMON_EVENT_KEYS, 'x', 'y'];
  else if (type === 'DAMAGE_STRUCTURE') allowed = [...COMMON_EVENT_KEYS, 'cellId', 'amount'];
  else if (type === 'FIRE') allowed = [...COMMON_EVENT_KEYS, 'cellId'];
  else throw new Error(`${label}.type is unsupported`);
  requireExactKeys(event, allowed, label);

  const normalized = {
    eventId: boundedString(event.eventId, `${label}.eventId`),
    type,
  };
  if ('actorId' in event) normalized.actorId = boundedString(event.actorId, `${label}.actorId`);

  if (type === 'MOVE') {
    normalized.actorId = boundedString(event.actorId, `${label}.actorId`);
    if (!Number.isSafeInteger(event.x) || !Number.isSafeInteger(event.y)) {
      throw new TypeError(`${label} MOVE coordinates must be safe integers`);
    }
    normalized.x = event.x;
    normalized.y = event.y;
  } else {
    normalized.cellId = boundedString(event.cellId, `${label}.cellId`);
    if (type === 'DAMAGE_STRUCTURE') {
      if (!Number.isFinite(event.amount) || Math.abs(event.amount) > 1_000_000_000) {
        throw new TypeError(`${label}.amount must be a bounded finite number`);
      }
      normalized.amount = event.amount;
    }
  }

  for (const key of ['relationshipRelevant', 'rare', 'structuralChange', 'injuryOrDestruction']) {
    optionalBoolean(event, normalized, key, label);
  }
  return normalized;
}

function normalizeInput(input) {
  requireObject(input, 'input');
  requireExactKeys(input, ['schema', 'width', 'height', 'events'], 'input');
  if (input.schema !== INPUT_SCHEMA) throw new Error('ECHOWORLD_INPUT_SCHEMA_UNSUPPORTED');
  for (const key of ['width', 'height']) {
    if (!Number.isInteger(input[key]) || input[key] < 5 || input[key] > MAX_DIMENSION) {
      throw new RangeError(`${key} must be an integer from 5 through ${MAX_DIMENSION}`);
    }
  }
  if (!Array.isArray(input.events) || input.events.length < 1 || input.events.length > MAX_EVENTS) {
    throw new RangeError(`events must contain 1 through ${MAX_EVENTS} entries`);
  }
  const events = input.events.map(normalizeEvent);
  const ids = new Set(events.map((event) => event.eventId));
  if (ids.size !== events.length) throw new Error('ECHOWORLD_DUPLICATE_EVENT_ID');
  return { schema: INPUT_SCHEMA, width: input.width, height: input.height, events };
}

function execute(normalizedInput, memoryEnabled) {
  const world = createWorld({
    width: normalizedInput.width,
    height: normalizedInput.height,
    memoryEnabled,
  });
  const events = normalizedInput.events.map((event) => {
    const result = processEvent(world, event);
    return {
      eventId: result.eventId,
      committed: result.committed,
      reason: result.reason ?? null,
      revision: result.revision,
      canonicalHash: result.canonicalHash,
      affectedCellIds: result.affectedCellIds ?? [],
    };
  });
  return {
    memoryEnabled,
    events,
    finalRevision: world.revision,
    finalCanonicalHash: canonicalHash(world),
    truthReceiptCount: world.receipts.truth.length,
    memoryReceiptCount: world.receipts.memory.length,
    handoffReceiptCount: world.receipts.handoffs.length,
    world,
  };
}

function publicRun(run) {
  const { world: _world, ...publicFields } = run;
  return publicFields;
}

export function computePortableReplayHash(receipt) {
  requireObject(receipt, 'receipt');
  const { receiptHash: _receiptHash, ...payload } = receipt;
  return sha256(canonicalJson(payload));
}

export function createPortableReplay(input) {
  const normalizedInput = normalizeInput(input);
  const withoutMemory = execute(normalizedInput, false);
  const withMemory = execute(normalizedInput, true);
  const canonicalEquivalent = (
    withoutMemory.finalCanonicalHash === withMemory.finalCanonicalHash
    && canonicalJson(withoutMemory.events) === canonicalJson(withMemory.events)
  );
  if (!canonicalEquivalent) throw new Error('ECHOWORLD_CANONICAL_EQUIVALENCE_BREACH');

  const payload = {
    schema: RECEIPT_SCHEMA,
    provider: {
      id: 'axm.echoworld.deterministic-event-replay',
      version: '0.1.0',
    },
    inputHash: sha256(canonicalJson(normalizedInput)),
    input: normalizedInput,
    memoryDisabled: publicRun(withoutMemory),
    memoryEnabled: publicRun(withMemory),
    canonicalEquivalent,
    finalCanonicalState: canonicalProjection(withMemory.world),
    authority: {
      canonical: false,
      authorshipVerified: false,
      physicalRealismProven: false,
      automaticMerge: false,
    },
  };
  return { ...payload, receiptHash: computePortableReplayHash(payload) };
}

export function verifyPortableReplay(receipt) {
  requireObject(receipt, 'receipt');
  if (receipt.schema !== RECEIPT_SCHEMA) throw new Error('ECHOWORLD_REPLAY_SCHEMA_UNSUPPORTED');
  if (typeof receipt.receiptHash !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.receiptHash)) {
    throw new Error('ECHOWORLD_REPLAY_HASH_MALFORMED');
  }
  if (computePortableReplayHash(receipt) !== receipt.receiptHash) {
    throw new Error('ECHOWORLD_REPLAY_INTEGRITY_MISMATCH');
  }
  const replayed = createPortableReplay(receipt.input);
  if (canonicalJson(replayed) !== canonicalJson(receipt)) {
    throw new Error('ECHOWORLD_REPLAY_EXECUTION_MISMATCH');
  }
  return {
    schema: VERIFICATION_SCHEMA,
    verified: true,
    receiptHash: receipt.receiptHash,
    inputHash: receipt.inputHash,
    events: receipt.input.events.length,
    committedEvents: receipt.memoryEnabled.events.filter((event) => event.committed).length,
    finalRevision: receipt.memoryEnabled.finalRevision,
    finalCanonicalHash: receipt.memoryEnabled.finalCanonicalHash,
    canonicalEquivalent: true,
    authority: structuredClone(receipt.authority),
  };
}
