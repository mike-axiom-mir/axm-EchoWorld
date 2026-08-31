import { acquirePlatformWriteLock } from '../../src/persistence/platform-lock.js';

const [directory, exitStage] = process.argv.slice(2);
if (!directory || !exitStage) {
  process.stderr.write('usage: platform-lock-crash-worker <directory> <stage>\n');
  process.exit(2);
}

await acquirePlatformWriteLock({
  directory,
  ownerId: 'crash-lock-owner',
  leaseId: 'crash-lock-lease',
  fencingToken: 1,
  logicalNowMs: 1_000,
  lockDurationMs: 50,
  onStage(stage) {
    if (stage === exitStage) process.exit(86);
  },
});

process.stderr.write(`requested stage was not reached: ${exitStage}\n`);
process.exit(4);
