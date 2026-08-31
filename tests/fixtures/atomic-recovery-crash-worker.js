import { recoverAtomicWorldSnapshot } from '../../src/persistence/atomic-store.js';

const [directory, name, crashStage] = process.argv.slice(2);

if (!directory || !name || !crashStage) {
  process.stderr.write('usage: atomic-recovery-crash-worker <directory> <name> <stage>\n');
  process.exit(2);
}

await recoverAtomicWorldSnapshot({
  directory,
  name,
  onStage(stage) {
    if (stage === crashStage) process.exit(86);
  },
});

process.stderr.write(`requested recovery stage was not reached: ${crashStage}\n`);
process.exit(4);
