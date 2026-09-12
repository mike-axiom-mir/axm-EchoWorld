import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  buildArtifacts,
  canonicalJson,
  checkArtifacts,
  writeArtifacts,
} from '../tools/generate-public-capabilities.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const EXPECTED_ID = 'axm.echoworld.deterministic-event-replay';
const EXPECTED_SOURCE_BLOBS = new Map([
  ['package.json', 'b9e1e1eb6e427874d92f1d207ea4bc2621c778d6'],
  ['src/capability.js', '3256851d1094339056cf21241871fb386b9aca79'],
  ['LICENSE', '65ed171955b30c070809e9164d4e22d224e0437e'],
]);

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echoworld-discovery-'));
  fs.mkdirSync(path.join(root, '.axm'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  for (const relative of ['package.json', 'src/capability.js', 'LICENSE', '.axm/discovery-public.json']) {
    fs.copyFileSync(path.join(ROOT, relative), path.join(root, relative));
  }
  return root;
}

function cleanFixture(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test('committed discovery artifacts are exact, source-backed, and no-authority', async () => {
  const checked = await checkArtifacts(ROOT);
  assert.equal(checked.ok, true, checked.mismatches.join(', '));

  const registry = JSON.parse(checked.expected['registry/capabilities.jsonl'].trim());
  assert.equal(registry.schema, 'axm.public-capability/v1');
  assert.equal(registry.id, EXPECTED_ID);
  assert.equal(registry.status, 'EXPERIMENTAL');
  assert.deepEqual(registry.providers, ['mike-axiom-mir/axm-EchoWorld']);
  assert.equal(registry.runtime.networkRequired, false);
  assert.deepEqual(registry.runtime.dependencies, []);
  assert.equal(registry.authority.discoveryOnly, true);
  assert.equal(registry.authority.execution, false);
  assert.equal(registry.authority.automaticSelection, false);
  assert.equal(registry.authority.automaticInstall, false);
  assert.equal(registry.authority.merge, false);
  assert.equal(registry.authority.canon, false);

  const receipt = JSON.parse(checked.expected['registry/capabilities.receipt.json']);
  for (const source of receipt.sources) {
    assert.equal(source.git_blob_sha1, EXPECTED_SOURCE_BLOBS.get(source.path), source.path);
  }
  assert.equal(receipt.registry.sha256, sha256(checked.expected['registry/capabilities.jsonl']));
  const { receipt_sha256: sealed, ...body } = receipt;
  assert.equal(sealed, sha256(canonicalJson(body)));
  assert.equal(receipt.pattern_provenance.copied_runtime_code, false);
  assert.equal(receipt.truth_boundary.runtime_proof, false);
  assert.equal(receipt.truth_boundary.execution_authority, false);
  assert.equal(receipt.truth_boundary.merge_authority, false);
  assert.equal(receipt.truth_boundary.canon_authority, false);
});

test('source symlink substitution fails closed', async () => {
  const root = makeFixture();
  try {
    fs.rmSync(path.join(root, 'LICENSE'));
    fs.symlinkSync(path.join(ROOT, 'LICENSE'), path.join(root, 'LICENSE'));
    await assert.rejects(() => buildArtifacts(root), /regular non-symlink file/);
  } finally {
    cleanFixture(root);
  }
});

test('capability status or offline boundary drift fails closed', async () => {
  const root = makeFixture();
  try {
    const packagePath = path.join(root, 'package.json');
    const document = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    document.axmCapability.status = 'WORKING';
    fs.writeFileSync(packagePath, `${JSON.stringify(document, null, 2)}\n`);
    await assert.rejects(() => buildArtifacts(root), /preserve EXPERIMENTAL status/);

    fs.copyFileSync(path.join(ROOT, 'package.json'), packagePath);
    const restored = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    restored.axmCapability.runtime.networkRequired = true;
    fs.writeFileSync(packagePath, `${JSON.stringify(restored, null, 2)}\n`);
    await assert.rejects(() => buildArtifacts(root), /local\/offline runtime contract/);
  } finally {
    cleanFixture(root);
  }
});

test('executable descriptor drift fails closed', async () => {
  const root = makeFixture();
  try {
    fs.writeFileSync(
      path.join(root, 'src/capability.js'),
      `import fs from 'node:fs';\nconst packageUrl = new URL('../package.json', import.meta.url);\nexport function describeCapability() {\n  const capability = JSON.parse(fs.readFileSync(packageUrl, 'utf8')).axmCapability;\n  capability.version = '9.9.9';\n  return capability;\n}\n`,
      'utf8',
    );
    await assert.rejects(() => buildArtifacts(root), /descriptor drifted/);
  } finally {
    cleanFixture(root);
  }
});

test('public marker drift fails closed', async () => {
  const root = makeFixture();
  try {
    const markerPath = path.join(root, '.axm/discovery-public.json');
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    marker.public = false;
    fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
    await assert.rejects(() => buildArtifacts(root), /must explicitly opt in/);
  } finally {
    cleanFixture(root);
  }
});

test('generated registry drift is detected without rewriting it', async () => {
  const root = makeFixture();
  try {
    await writeArtifacts(root);
    const registryPath = path.join(root, 'registry/capabilities.jsonl');
    fs.appendFileSync(registryPath, '{}\n');
    const checked = await checkArtifacts(root);
    assert.equal(checked.ok, false);
    assert.deepEqual(checked.mismatches, ['registry/capabilities.jsonl']);
  } finally {
    cleanFixture(root);
  }
});
