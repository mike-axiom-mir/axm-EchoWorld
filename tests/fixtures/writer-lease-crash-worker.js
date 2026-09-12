import {
  acquireWriterLease,
  releaseWriterLease,
} from '../../src/persistence/writer-lease.js';

const [directory, action, exitStage] = process.argv.slice(2);
if (!directory || !action || !exitStage) {
  process.stderr.write('usage: writer-lease-crash-worker <directory> <acquire|release> <stage>\n');
  process.exit(2);
}

const stageHook = (stage) => {
  if (stage === exitStage) process.exit(86);
};

const lease = await acquireWriterLease({
  directory,
  writerId: `crash-worker-${action}`,
  nowMs: 15_000,
  leaseDurationMs: 100,
  provisionalDurationMs: 50,
  onStage: stageHook,
});

if (action === 'release') {
  await releaseWriterLease({
    directory,
    lease,
    nowMs: 15_001,
    onStage: stageHook,
  });
}

process.stderr.write(`requested stage was not reached: ${exitStage}\n`);
process.exit(4);
