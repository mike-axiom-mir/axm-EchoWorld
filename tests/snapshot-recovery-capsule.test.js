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

import { canonicalHash, createWorld } from '../src/core/state.js';
import { processEvent } from '../src/core/world.js';
import {
  atomicSnapshotPaths,
  createAtomicSnapshotEnvelope,
  createSnapshotRecoveryCapsule,
  inspectAtomicSnapshotStore,
  loadAtomicWorldSnapshot,
  restoreSnapshotLineageRecords,
  restoreSnapshotRecoveryCapsule,
  saveAtomicWorldSnapshot,
  serializeAtomicSnapshotEnvelope,
  validateSnapshotRecoveryCapsuleText,
} from '../src/persistence/index.js';

async function makeDirectory(t, label) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `axm-echoworld-${label}-`));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function move(world, eventId, x) {
  const result = processEvent(world, {
    eventId,
    type: 'MOVE',
    actorId: 'A',
    x,
    y: 1,
    rare: true,
  });
  assert.equal(result.committed, true);
  return world;
}

async function createThreeGenerationStore(t) {
  const directory = await makeDirectory(t, 'capsule-source');
  const firstWorld = createWorld();
  await saveAtomicWorldSnapshot({ directory, world: firstWorld });
  const secondWorld = move(structuredClone(firstWorld), 'CAPSULE_MOVE_2', 2);
  await saveAtomicWorldSnapshot({ directory, world: secondWorld });
  const thirdWorld = move(structuredClone(secondWorld), 'CAPSULE_MOVE_3', 3);
  const third = await saveAtomicWorldSnapshot({ directory, world: thirdWorld });
  return { directory, thirdWorld, third };
}

function expectCode(code) {
  return (error) => {
    assert.equal(error?.code, code);
    return true;
  };
}

test('recovery capsule is byte-deterministic and binds the complete selected lineage', async (t) => {
  const source = await createThreeGenerationStore(t);
  const first = await createSnapshotRecoveryCapsule({ directory: source.directory });
  const second = await createSnapshotRecoveryCapsule({ directory: source.directory });

  assert.equal(first.capsuleId, second.capsuleId);
  assert.equal(first.text, second.text);
  assert.equal(first.lineageLength, 3);
  assert.equal(first.snapshotId, source.third.snapshotId);
  assert.equal(first.canonicalHash, canonicalHash(source.thirdWorld));
});

test('capsule carries only the selected chain after a local rollback branch', async (t) => {
  const source = await createThreeGenerationStore(t);
  const oldThirdId = source.third.snapshotId;
  const paths = atomicSnapshotPaths(source.directory);
  await writeFile(paths.primary, '{"corrupt-primary":', 'utf8');
  const rolledBack = await loadAtomicWorldSnapshot({ directory: source.directory });
  assert.equal(rolledBack.generation, 2);
  const replacementWorld = move(structuredClone(rolledBack.world), 'CAPSULE_BRANCH_3', 4);
  const replacement = await saveAtomicWorldSnapshot({ directory: source.directory, world: replacementWorld });
  const recovery = await createSnapshotRecoveryCapsule({ directory: source.directory });

  assert.equal(recovery.lineageLength, 3);
  assert.equal(recovery.snapshotId, replacement.snapshotId);
  assert.ok(!recovery.capsule.lineageRecords.some((record) => record.snapshotId === oldThirdId));
});

test('capsule creation cannot promote a higher uncommitted temporary snapshot', async (t) => {
  const directory = await makeDirectory(t, 'capsule-transient-source');
  const first = await saveAtomicWorldSnapshot({ directory, world: createWorld() });
  const uncommittedWorld = move(createWorld(), 'UNCOMMITTED_CAPSULE_MOVE', 2);
  const uncommitted = createAtomicSnapshotEnvelope(uncommittedWorld, {
    generation: 2,
    parentSnapshotId: first.snapshotId,
  });
  await writeFile(
    atomicSnapshotPaths(directory).temp,
    serializeAtomicSnapshotEnvelope(uncommitted),
    'utf8',
  );

  await assert.rejects(
    () => createSnapshotRecoveryCapsule({ directory }),
    expectCode('RECOVERY_CAPSULE_PRIMARY_REQUIRED'),
  );
  assert.equal((await inspectAtomicSnapshotStore({ directory })).selected.role, 'temp');
});

test('pinned capsule restores canonical state after every source candidate is corrupt', async (t) => {
  const source = await createThreeGenerationStore(t);
  const recovery = await createSnapshotRecoveryCapsule({ directory: source.directory });
  const sourcePaths = atomicSnapshotPaths(source.directory);
  await writeFile(sourcePaths.primary, '{"corrupt-primary":', 'utf8');
  await writeFile(sourcePaths.backup, '{"corrupt-backup":', 'utf8');
  const broken = await inspectAtomicSnapshotStore({ directory: source.directory });
  assert.equal(broken.anyValid, false);

  const target = await makeDirectory(t, 'capsule-target');
  const receipt = await restoreSnapshotRecoveryCapsule({
    directory: target,
    capsuleText: recovery.text,
    expectedCapsuleId: recovery.capsuleId,
  });
  const loaded = await loadAtomicWorldSnapshot({ directory: target });

  assert.equal(receipt.status, 'RESTORED');
  assert.equal(receipt.capsuleId, recovery.capsuleId);
  assert.equal(loaded.snapshotId, source.third.snapshotId);
  assert.equal(loaded.lineage.chainLength, 3);
  assert.equal(canonicalHash(loaded.world), canonicalHash(source.thirdWorld));
});

test('restore requires a caller-owned capsule pin', async (t) => {
  const source = await createThreeGenerationStore(t);
  const recovery = await createSnapshotRecoveryCapsule({ directory: source.directory });
  const target = await makeDirectory(t, 'capsule-pin-required');

  await assert.rejects(
    () => restoreSnapshotRecoveryCapsule({ directory: target, capsuleText: recovery.text }),
    expectCode('RECOVERY_CAPSULE_PIN_REQUIRED'),
  );
  await assert.rejects(
    () => restoreSnapshotRecoveryCapsule({
      directory: target,
      capsuleText: recovery.text,
      expectedCapsuleId: 'SRC_000000000000000000000000',
    }),
    expectCode('RECOVERY_CAPSULE_PIN_MISMATCH'),
  );
});

test('capsule and lineage tampering fail before target mutation', async (t) => {
  const source = await createThreeGenerationStore(t);
  const recovery = await createSnapshotRecoveryCapsule({ directory: source.directory });
  const changedSnapshot = JSON.parse(recovery.text);
  changedSnapshot.headEnvelope.payload += '\n';
  const snapshotValidation = validateSnapshotRecoveryCapsuleText(`${JSON.stringify(changedSnapshot)}\n`);
  assert.equal(snapshotValidation.valid, false);
  assert.equal(snapshotValidation.reason, 'RECOVERY_CAPSULE_ID_MISMATCH');

  const changedLineage = JSON.parse(recovery.text);
  changedLineage.lineageRecords[0].canonicalHash = 'tampered';
  const lineageValidation = validateSnapshotRecoveryCapsuleText(`${JSON.stringify(changedLineage)}\n`);
  assert.equal(lineageValidation.valid, false);
  assert.equal(lineageValidation.reason, 'RECOVERY_CAPSULE_ID_MISMATCH');

  const target = await makeDirectory(t, 'capsule-tamper-target');
  await assert.rejects(
    () => restoreSnapshotRecoveryCapsule({
      directory: target,
      capsuleText: `${JSON.stringify(changedSnapshot)}\n`,
      expectedCapsuleId: recovery.capsuleId,
    }),
    expectCode('RECOVERY_CAPSULE_ID_MISMATCH'),
  );
  const targetInspection = await inspectAtomicSnapshotStore({ directory: target });
  assert.equal(targetInspection.anyExisting, false);
});

test('restore refuses to overwrite a different local store', async (t) => {
  const source = await createThreeGenerationStore(t);
  const recovery = await createSnapshotRecoveryCapsule({ directory: source.directory });
  const target = await makeDirectory(t, 'capsule-occupied-target');
  const local = await saveAtomicWorldSnapshot({ directory: target, world: createWorld() });
  const before = await readFile(atomicSnapshotPaths(target).primary, 'utf8');

  await assert.rejects(
    () => restoreSnapshotRecoveryCapsule({
      directory: target,
      capsuleText: recovery.text,
      expectedCapsuleId: recovery.capsuleId,
    }),
    expectCode('RECOVERY_TARGET_NOT_EMPTY'),
  );
  assert.equal(await readFile(atomicSnapshotPaths(target).primary, 'utf8'), before);
  assert.notEqual(local.snapshotId, recovery.snapshotId);
});

test('restore preserves an unfinished backup candidate instead of cleaning it', async (t) => {
  const source = await createThreeGenerationStore(t);
  const recovery = await createSnapshotRecoveryCapsule({ directory: source.directory });
  const target = await makeDirectory(t, 'capsule-backup-temp-target');
  const paths = atomicSnapshotPaths(target);
  await writeFile(paths.backupTemp, 'unresolved backup bytes', 'utf8');

  await assert.rejects(
    () => restoreSnapshotRecoveryCapsule({
      directory: target,
      capsuleText: recovery.text,
      expectedCapsuleId: recovery.capsuleId,
    }),
    expectCode('RECOVERY_TARGET_NOT_EMPTY'),
  );
  assert.equal(await readFile(paths.backupTemp, 'utf8'), 'unresolved backup bytes');
});

test('restore resumes after an interruption that wrote only matching lineage', async (t) => {
  const source = await createThreeGenerationStore(t);
  const recovery = await createSnapshotRecoveryCapsule({ directory: source.directory });
  const target = await makeDirectory(t, 'capsule-resume-target');
  await restoreSnapshotLineageRecords({
    directory: target,
    records: recovery.capsule.lineageRecords,
    headEnvelope: recovery.capsule.headEnvelope,
  });

  const receipt = await restoreSnapshotRecoveryCapsule({
    directory: target,
    capsuleText: recovery.text,
    expectedCapsuleId: recovery.capsuleId,
  });
  const loaded = await loadAtomicWorldSnapshot({ directory: target });
  assert.equal(receipt.status, 'RESTORED');
  assert.equal(loaded.lineage.chainLength, 3);
});

test('replaying an already restored capsule is explicitly idempotent', async (t) => {
  const source = await createThreeGenerationStore(t);
  const recovery = await createSnapshotRecoveryCapsule({ directory: source.directory });
  const target = await makeDirectory(t, 'capsule-idempotent-target');
  await restoreSnapshotRecoveryCapsule({
    directory: target,
    capsuleText: recovery.text,
    expectedCapsuleId: recovery.capsuleId,
  });
  const repeated = await restoreSnapshotRecoveryCapsule({
    directory: target,
    capsuleText: recovery.text,
    expectedCapsuleId: recovery.capsuleId,
  });

  assert.equal(repeated.status, 'ALREADY_RESTORED');
  assert.equal(repeated.snapshotId, recovery.snapshotId);
});
