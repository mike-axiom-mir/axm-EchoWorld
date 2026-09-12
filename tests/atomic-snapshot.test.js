import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  canonicalHash,
  createWorld,
} from '../src/core/state.js';
import { processEvent } from '../src/core/world.js';
import {
  AtomicSnapshotError,
  atomicSnapshotPaths,
  createAtomicSnapshotEnvelope,
  inspectAtomicSnapshotStore,
  loadAtomicWorldSnapshot,
  recoverAtomicWorldSnapshot,
  saveAtomicWorldSnapshot,
  serializeAtomicSnapshotEnvelope,
  validateAtomicSnapshotText,
} from '../src/persistence/atomic-store.js';

async function makeStoreDir(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'axm-echoworld-atomic-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function advanceWorld(world, eventId = 'ATOMIC_MOVE') {
  const result = processEvent(world, {
    eventId,
    type: 'MOVE',
    actorId: 'A',
    x: 2,
    y: 1,
    rare: true,
  });
  assert.equal(result.committed, true);
  return world;
}

test('atomic snapshots form a verified generation chain and retain one backup', async (t) => {
  const directory = await makeStoreDir(t);
  const firstWorld = createWorld({ memoryEnabled: true });
  const first = await saveAtomicWorldSnapshot({ directory, world: firstWorld });

  const secondWorld = advanceWorld(createWorld({ memoryEnabled: true }), 'ATOMIC_CHAIN_MOVE');
  const second = await saveAtomicWorldSnapshot({ directory, world: secondWorld });
  const loaded = await loadAtomicWorldSnapshot({ directory });
  const inspection = await inspectAtomicSnapshotStore({ directory });
  const backup = inspection.candidates.find((candidate) => candidate.role === 'backup');

  assert.equal(first.status, 'COMMITTED');
  assert.equal(first.generation, 1);
  assert.equal(second.generation, 2);
  assert.equal(second.parentSnapshotId, first.snapshotId);
  assert.equal(second.primaryDirectorySync.synced, true);
  assert.equal(loaded.generation, 2);
  assert.equal(loaded.snapshotId, second.snapshotId);
  assert.equal(loaded.world.actors.A.x, 2);
  assert.equal(canonicalHash(loaded.world), second.canonicalHash);
  assert.equal(backup.valid, true);
  assert.equal(backup.envelope.generation, 1);
  assert.equal(backup.envelope.snapshotId, first.snapshotId);
});

test('corrupt primary deterministically falls back to the valid backup and promotes it', async (t) => {
  const directory = await makeStoreDir(t);
  const first = await saveAtomicWorldSnapshot({ directory, world: createWorld() });
  await saveAtomicWorldSnapshot({
    directory,
    world: advanceWorld(createWorld(), 'ATOMIC_CORRUPT_PRIMARY_MOVE'),
  });

  const paths = atomicSnapshotPaths(directory);
  await writeFile(paths.primary, '{"truncated":', 'utf8');

  const recovered = await recoverAtomicWorldSnapshot({ directory });
  const primaryText = await readFile(paths.primary, 'utf8');
  const primaryValidation = validateAtomicSnapshotText(primaryText);

  assert.equal(recovered.status, 'RECOVERED_AND_PROMOTED');
  assert.equal(recovered.selectedRole, 'backup');
  assert.equal(recovered.generation, 1);
  assert.equal(recovered.snapshotId, first.snapshotId);
  assert.equal(recovered.world.actors.A.x, 1);
  assert.equal(primaryValidation.valid, true);
  assert.equal(primaryValidation.envelope.snapshotId, first.snapshotId);
});

test('a valid higher-generation temp snapshot wins deterministic recovery and is promoted', async (t) => {
  const directory = await makeStoreDir(t);
  const first = await saveAtomicWorldSnapshot({ directory, world: createWorld() });
  const nextWorld = advanceWorld(createWorld(), 'ATOMIC_TEMP_MOVE');
  const envelope = createAtomicSnapshotEnvelope(nextWorld, {
    generation: 2,
    parentSnapshotId: first.snapshotId,
  });
  const paths = atomicSnapshotPaths(directory);
  await writeFile(paths.temp, serializeAtomicSnapshotEnvelope(envelope), 'utf8');

  const recovered = await recoverAtomicWorldSnapshot({ directory });
  const inspection = await inspectAtomicSnapshotStore({ directory });

  assert.equal(recovered.selectedRole, 'temp');
  assert.equal(recovered.promoted, true);
  assert.equal(recovered.generation, 2);
  assert.equal(recovered.world.actors.A.x, 2);
  assert.equal(inspection.selected.role, 'primary');
  assert.equal(inspection.selected.envelope.snapshotId, envelope.snapshotId);
  assert.equal(inspection.candidates.find((item) => item.role === 'temp').exists, false);
});

test('an invalid higher-looking temp is ignored and removed while the valid primary remains authoritative', async (t) => {
  const directory = await makeStoreDir(t);
  const primaryReceipt = await saveAtomicWorldSnapshot({ directory, world: createWorld() });
  const paths = atomicSnapshotPaths(directory);
  await writeFile(paths.temp, '{"schema":"axm.echoworld.atomic-snapshot/v0.01","generation":999}', 'utf8');

  const recovered = await recoverAtomicWorldSnapshot({ directory });
  const inspection = await inspectAtomicSnapshotStore({ directory });

  assert.equal(recovered.status, 'PRIMARY_VALID');
  assert.equal(recovered.snapshotId, primaryReceipt.snapshotId);
  assert.equal(inspection.candidates.find((item) => item.role === 'temp').exists, false);
});

test('same-generation valid snapshots with different identities fail closed', async (t) => {
  const directory = await makeStoreDir(t);
  const paths = atomicSnapshotPaths(directory);
  const worldA = createWorld();
  const worldB = advanceWorld(createWorld(), 'ATOMIC_CONFLICT_MOVE');
  const envelopeA = createAtomicSnapshotEnvelope(worldA, { generation: 3 });
  const envelopeB = createAtomicSnapshotEnvelope(worldB, { generation: 3 });
  await writeFile(paths.primary, serializeAtomicSnapshotEnvelope(envelopeA), 'utf8');
  await writeFile(paths.temp, serializeAtomicSnapshotEnvelope(envelopeB), 'utf8');

  await assert.rejects(
    () => recoverAtomicWorldSnapshot({ directory }),
    (error) => {
      assert.ok(error instanceof AtomicSnapshotError);
      assert.equal(error.code, 'SNAPSHOT_GENERATION_CONFLICT');
      assert.equal(error.details.conflict.generation, 3);
      assert.equal(error.details.conflict.candidates.length, 2);
      return true;
    },
  );
});

test('save refuses to overwrite an existing store when no candidate is valid', async (t) => {
  const directory = await makeStoreDir(t);
  const paths = atomicSnapshotPaths(directory);
  await writeFile(paths.primary, 'not a snapshot', 'utf8');

  await assert.rejects(
    () => saveAtomicWorldSnapshot({ directory, world: createWorld() }),
    (error) => error instanceof AtomicSnapshotError && error.code === 'NO_VALID_SNAPSHOT',
  );
  assert.equal(await readFile(paths.primary, 'utf8'), 'not a snapshot');
});

test('payload tampering is rejected before world reload', () => {
  const envelope = createAtomicSnapshotEnvelope(createWorld(), { generation: 1 });
  envelope.payload += '\n';
  const validation = validateAtomicSnapshotText(serializeAtomicSnapshotEnvelope(envelope));

  assert.equal(validation.valid, false);
  assert.equal(validation.reason, 'PAYLOAD_HASH_MISMATCH');
});

test('identical same-generation duplicates resolve to primary by stable role priority', async (t) => {
  const directory = await makeStoreDir(t);
  const paths = atomicSnapshotPaths(directory);
  const envelope = createAtomicSnapshotEnvelope(createWorld(), { generation: 5 });
  const text = serializeAtomicSnapshotEnvelope(envelope);
  await writeFile(paths.primary, text, 'utf8');
  await writeFile(paths.temp, text, 'utf8');
  await writeFile(paths.backup, text, 'utf8');

  const inspection = await inspectAtomicSnapshotStore({ directory });

  assert.equal(inspection.conflict, null);
  assert.equal(inspection.selected.role, 'primary');
  assert.equal(inspection.selected.envelope.snapshotId, envelope.snapshotId);
});
