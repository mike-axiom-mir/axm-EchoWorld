import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computePortableReplayHash,
  createPortableReplay,
  verifyPortableReplay,
} from '../src/portable-replay.js';

const input = {
  schema: 'axm.echoworld.event-stream/v0.01',
  width: 8,
  height: 8,
  events: [
    { eventId: 'MOVE_1', type: 'MOVE', actorId: 'A', x: 2, y: 1, relationshipRelevant: true },
    { eventId: 'DAMAGE_1', type: 'DAMAGE_STRUCTURE', actorId: 'A', cellId: 'C_2_1', amount: 25 },
    { eventId: 'REJECTED_MOVE', type: 'MOVE', actorId: 'A', x: 99, y: 99 },
    { eventId: 'FIRE_1', type: 'FIRE', cellId: 'C_2_1' },
  ],
};

test('portable replay preserves canonical truth with memory disabled or enabled', () => {
  const receipt = createPortableReplay(input);
  assert.equal(receipt.canonicalEquivalent, true);
  assert.equal(receipt.memoryDisabled.finalCanonicalHash, receipt.memoryEnabled.finalCanonicalHash);
  assert.equal(receipt.memoryDisabled.finalRevision, 3);
  assert.equal(receipt.memoryEnabled.finalRevision, 3);
  assert.equal(receipt.memoryDisabled.memoryReceiptCount, 0);
  assert.ok(receipt.memoryEnabled.memoryReceiptCount > 0);
  assert.deepEqual(receipt.memoryEnabled.events.map((event) => event.committed), [true, true, false, true]);
  assert.equal(receipt.memoryEnabled.events[2].reason, 'OUT_OF_BOUNDS');
  assert.equal(receipt.finalCanonicalState.revision, 3);
  assert.equal(verifyPortableReplay(receipt).verified, true);
});

test('same event stream produces byte-equivalent replay evidence', () => {
  assert.deepEqual(createPortableReplay(input), createPortableReplay(structuredClone(input)));
});

test('tampered and re-sealed false results fail closed', () => {
  const altered = structuredClone(createPortableReplay(input));
  altered.memoryEnabled.finalRevision = 99;
  assert.throws(() => verifyPortableReplay(altered), /INTEGRITY_MISMATCH/);

  altered.receiptHash = computePortableReplayHash(altered);
  assert.throws(() => verifyPortableReplay(altered), /EXECUTION_MISMATCH/);
});

test('ambiguous and oversized input contracts are rejected', () => {
  const duplicate = structuredClone(input);
  duplicate.events[1].eventId = duplicate.events[0].eventId;
  assert.throws(() => createPortableReplay(duplicate), /DUPLICATE_EVENT_ID/);

  assert.throws(
    () => createPortableReplay({ ...input, unexpectedAuthority: true }),
    /unsupported fields/,
  );
  assert.throws(() => createPortableReplay({ ...input, width: 65 }), /width/);
});
