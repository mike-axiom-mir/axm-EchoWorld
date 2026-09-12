import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { buildDemo, buildObserverPayload } from '../src/observer/demo.js';

test('observer demo is generated from committed and rejected core transitions', () => {
  const demo = buildDemo({ memoryEnabled: true });
  assert.equal(demo.frames.length, 6);
  assert.deepEqual(demo.frames.map((frame) => frame.world.revision), [0, 1, 2, 2, 3, 4]);

  const rejected = demo.frames[3];
  assert.equal(rejected.outcome.committed, false);
  assert.equal(rejected.outcome.reason, 'OUT_OF_BOUNDS');
  assert.equal(rejected.receipts.delta.truth, 0);
  assert.equal(rejected.receipts.delta.memory, 0);
  assert.equal(rejected.world.canonicalHash, demo.frames[2].world.canonicalHash);

  const collapse = demo.frames[5].world.cells.find((cell) => cell.cellId === 'C_2_1');
  assert.equal(collapse.integrity, 0);
  assert.equal(collapse.destroyed, true);
  assert.equal(collapse.material, 'debris');
});

test('observer exposes handoff evidence without granting it canonical authority', () => {
  const payload = buildObserverPayload();
  assert.equal(payload.truthComparison.every((entry) => entry.equal), true);

  for (const frame of payload.frames.filter((candidate) => candidate.observation.scheduler)) {
    assert.equal(frame.observation.scheduler.status, 'DRAINED');
    assert.equal(frame.observation.scheduler.canonicalMutationApplied, false);
    assert.equal(frame.observation.scheduler.canonicalHashBefore, frame.observation.scheduler.canonicalHashAfter);
    assert.ok(frame.observation.perceivedCellIds.length > 0);
  }
});

test('checked-in observer is a deterministic build of the current core payload', async () => {
  const template = await readFile(resolve('observer/template.html'), 'utf8');
  const index = await readFile(resolve('observer/index.html'), 'utf8');
  const serialized = JSON.stringify(buildObserverPayload()).replaceAll('<', '\\u003c');
  assert.equal(index, template.replace('/*__ECHOWORLD_DEMO__*/', serialized));
});

test('browser observer script parses without executing browser globals', async () => {
  const source = await readFile(resolve('observer/app.js'), 'utf8');
  assert.doesNotThrow(() => new Function(source));
});

test('observer grid is one-tab-stop navigable with a truthful selected-cell receipt', async () => {
  const template = await readFile(resolve('observer/template.html'), 'utf8');
  const source = await readFile(resolve('observer/app.js'), 'utf8');

  assert.match(template, /id="world-grid"[^>]+role="grid"/);
  assert.match(template, /aria-rowcount="16" aria-colcount="16"/);
  assert.match(template, /id="cell-inspector"[^>]+aria-live="polite"/);
  assert.match(source, /row\.setAttribute\('role', 'row'\)/);
  assert.match(source, /setAttribute\('role', 'gridcell'\)/);
  assert.match(source, /node\.tabIndex = cell\.cellId === state\.selectedCellId \? 0 : -1/);
  assert.match(source, /\['Truth changed', changed \? 'Yes' : 'No'\]/);
  assert.match(source, /\['Observed', observedDepth == null \? 'No' : `Depth \$\{observedDepth\}`\]/);
  assert.match(source, /\['Memory', state\.memoryVisible \? `\$\{cell\.memoryCount\} records` : 'Layer hidden'\]/);
});

test('observer consequence navigator routes only through receipt-declared changed cells', async () => {
  const source = await readFile(resolve('observer/app.js'), 'utf8');
  const styles = await readFile(resolve('observer/styles.css'), 'utf8');

  assert.match(source, /function affectedCellIds\(frame\)/);
  assert.match(source, /frame\.outcome\.affectedCellIds\.filter/);
  assert.match(source, /function focusNextChangedCell\(\)/);
  assert.match(source, /selectCell\(targetId, \{ focus: true, announce: false \}\)/);
  assert.match(source, /Navigation only; canonical truth is unchanged\./);
  assert.match(source, /event\.key\.toLowerCase\(\) === 'c'/);
  assert.match(source, /No canonical cell changed in this step\./);
  assert.match(styles, /\.consequence-nav/);
  assert.match(styles, /\.consequence-button[\s\S]*min-height: 44px/);
});
