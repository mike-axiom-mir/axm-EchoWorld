import { performance } from 'node:perf_hooks';
import process from 'node:process';

import { canonicalHash, createWorld } from '../src/core/state.js';
import { neighborHandoffs } from '../src/handoff/events.js';
import { runHandoffScheduler } from '../src/handoff/scheduler.js';

const cases = [
  { width: 16, height: 16, hopLimit: 8, repeats: 25 },
  { width: 32, height: 32, hopLimit: 12, repeats: 15 },
  { width: 64, height: 64, hopLimit: 16, repeats: 10 },
];

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction));
  return sorted[index];
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

const results = [];
for (const benchmarkCase of cases) {
  const durations = [];
  let witness = null;

  for (let run = 0; run < benchmarkCase.repeats; run += 1) {
    const world = createWorld({
      width: benchmarkCase.width,
      height: benchmarkCase.height,
      memoryEnabled: false,
    });
    const x = Math.floor(world.width / 2);
    const y = Math.floor(world.height / 2);
    const initial = neighborHandoffs(
      world,
      world.cells[`C_${x}_${y}`],
      { eventId: `BENCH_${benchmarkCase.width}x${benchmarkCase.height}`, type: 'FIRE' },
      { hopLimit: benchmarkCase.hopLimit },
    );

    const before = canonicalHash(world);
    const start = performance.now();
    const receipt = runHandoffScheduler(world, initial, {
      maxProcessed: 16384,
      maxQueueSize: 16384,
    });
    durations.push(performance.now() - start);

    if (receipt.status !== 'DRAINED' || receipt.canonicalMutationApplied || canonicalHash(world) !== before) {
      throw new Error(`Benchmark invariant failed for ${benchmarkCase.width}x${benchmarkCase.height}.`);
    }
    witness = receipt;
  }

  results.push({
    ...benchmarkCase,
    durationMs: {
      min: round(Math.min(...durations)),
      median: round(percentile(durations, 0.5)),
      p95: round(percentile(durations, 0.95)),
      max: round(Math.max(...durations)),
    },
    deterministicCounts: {
      processed: witness.cumulative.processedCount,
      accepted: witness.cumulative.acceptedCount,
      rejected: witness.cumulative.rejectedCount,
      generated: witness.cumulative.generatedCount,
      coalescedBeforeQueue: witness.cumulative.coalescedBeforeQueue,
      maxQueueObserved: witness.maxQueueObserved,
    },
    canonicalMutationApplied: witness.canonicalMutationApplied,
  });
}

console.log(JSON.stringify({
  schema: 'axm.echoworld.scheduler-benchmark/v0.01',
  observedAt: new Date().toISOString(),
  environment: {
    runtime: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  method: {
    scheduler: 'deterministic queued handoff propagation',
    timing: 'performance.now wall-clock milliseconds',
    warning: 'Local microbenchmark only; not a production-scale claim.',
  },
  results,
}, null, 2));
