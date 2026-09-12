import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHash, createWorld } from '../src/core/state.js';
import { processEvent } from '../src/core/world.js';
import { mergeSpecialistProposals } from '../src/specialists/merge.js';

test('stale specialist proposal is rejected against current canonical revision', () => {
  const world = createWorld();
  const stale = {
    runId: 'STALE:R1',
    specialistId: 'structural',
    baseRevision: 0,
    status: 'PROPOSED',
    proposal: { targetKey: 'C_2_1.integrity', operation: 'SET', value: 50 },
  };
  processEvent(world, {
    eventId: 'ADVANCE',
    type: 'MOVE',
    actorId: 'A',
    x: 2,
    y: 1,
    rare: true,
  });
  const before = canonicalHash(world);
  const result = mergeSpecialistProposals(world, [stale]);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].reason, 'STALE_BASE_REVISION');
  assert.equal(result.canonicalMutationApplied, false);
  assert.equal(canonicalHash(world), before);
});

test('conflicting specialist proposals are order-independent and cannot mutate canonical truth', () => {
  const makeReceipts = () => [
    {
      runId: 'R:B',
      specialistId: 'structural',
      baseRevision: 0,
      status: 'PROPOSED',
      proposal: { targetKey: 'C_2_1.integrity', operation: 'SET', value: 40 },
    },
    {
      runId: 'R:A',
      specialistId: 'material',
      baseRevision: 0,
      status: 'PROPOSED',
      proposal: { targetKey: 'C_2_1.integrity', operation: 'SET', value: 60 },
    },
  ];
  const a = createWorld();
  const b = createWorld();
  const hashA = canonicalHash(a);
  const hashB = canonicalHash(b);
  const left = mergeSpecialistProposals(a, makeReceipts());
  const right = mergeSpecialistProposals(b, makeReceipts().reverse());
  assert.deepEqual(left, right);
  assert.equal(left.conflicts.length, 1);
  assert.equal(left.decisions[0].status, 'CONFLICT_REJECTED');
  assert.equal(left.decisions[0].selected, null);
  assert.equal(canonicalHash(a), hashA);
  assert.equal(canonicalHash(b), hashB);
});
