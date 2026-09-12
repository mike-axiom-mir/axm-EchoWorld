import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, cwd = root, options = {}) {
  const completed = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    input: options.input,
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
  });
  if (!options.allowFailure) assert.equal(completed.status, 0, completed.stderr || completed.stdout);
  return completed;
}

test('offline tarball exposes replay through library and installed command', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'echoworld-consumer-'));
  const packed = JSON.parse(run('npm', [
    'pack', '--json', '--ignore-scripts', '--pack-destination', temp,
  ]).stdout)[0];
  const files = packed.files.map((entry) => entry.path);

  assert.ok(packed.size < 100_000, `package is unexpectedly large: ${packed.size}`);
  for (const required of ['src/index.js', 'src/portable-replay.js', 'scripts/portable-replay-cli.js', 'CONSUMER.md', 'LICENSE', 'THIRD_PARTY.json']) {
    assert.ok(files.includes(required), `missing package file ${required}`);
  }
  assert.equal(files.some((name) => name.startsWith('tests/')), false);
  assert.equal(files.some((name) => name.startsWith('evidence/')), false);
  assert.equal(files.some((name) => name.startsWith('docs/')), false);
  assert.equal(files.some((name) => name.startsWith('src/persistence/')), false);

  const consumer = path.join(temp, 'consumer');
  run('npm', [
    'install', '--offline', '--ignore-scripts', '--prefix', consumer,
    path.join(temp, packed.filename),
  ]);

  const imported = run(process.execPath, [
    '--input-type=module',
    '-e',
    [
      "import { createPortableReplay, verifyPortableReplay, describeCapability } from 'axm-echoworld';",
      "const input = { schema: 'axm.echoworld.event-stream/v0.01', width: 8, height: 8, events: [{ eventId: 'MOVE', type: 'MOVE', actorId: 'A', x: 2, y: 1 }] };",
      'const receipt = createPortableReplay(input);',
      'const verified = verifyPortableReplay(receipt);',
      'process.stdout.write(JSON.stringify({ id: describeCapability().id, equivalent: receipt.canonicalEquivalent, verified: verified.verified, revision: verified.finalRevision }));',
    ].join('\n'),
  ], consumer);
  assert.deepEqual(JSON.parse(imported.stdout), {
    id: 'axm.echoworld.deterministic-event-replay',
    equivalent: true,
    verified: true,
    revision: 1,
  });

  const command = path.join(consumer, 'node_modules', '.bin', 'echoworld-replay');
  const described = JSON.parse(run(command, ['describe'], consumer).stdout);
  assert.equal(described.capability.contracts.receipt, 'axm.echoworld.portable-replay/v0.01');

  const example = run(command, ['example'], consumer).stdout;
  const receipt = run(command, ['run', '-'], consumer, { input: example }).stdout;
  const verification = JSON.parse(run(command, ['verify', '-'], consumer, { input: receipt }).stdout);
  assert.equal(verification.verified, true);
  assert.equal(verification.events, 3);

  const altered = JSON.parse(receipt);
  altered.memoryEnabled.finalRevision = 99;
  const rejected = run(command, ['verify', '-'], consumer, {
    input: JSON.stringify(altered),
    allowFailure: true,
  });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /INTEGRITY_MISMATCH/);
});
