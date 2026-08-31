import { processEvent } from '../../src/core/world.js';
import {
  loadAtomicWorldSnapshot,
  saveAtomicWorldSnapshot,
} from '../../src/persistence/atomic-store.js';

const [directory, name, crashStage] = process.argv.slice(2);

if (!directory || !name || !crashStage) {
  process.stderr.write('usage: atomic-store-crash-worker <directory> <name> <stage>\n');
  process.exit(2);
}

const loaded = await loadAtomicWorldSnapshot({ directory, name });
const result = processEvent(loaded.world, {
  eventId: `PROCESS_EXIT_${crashStage}`,
  type: 'MOVE',
  actorId: 'A',
  x: 2,
  y: 1,
  rare: true,
});
if (!result.committed) {
  process.stderr.write(`canonical move failed: ${JSON.stringify(result)}\n`);
  process.exit(3);
}

await saveAtomicWorldSnapshot({
  directory,
  name,
  world: loaded.world,
  onStage(stage) {
    if (stage === crashStage) process.exit(86);
  },
});

process.stderr.write(`requested stage was not reached: ${crashStage}\n`);
process.exit(4);
