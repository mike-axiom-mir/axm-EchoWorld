import { readFile } from 'node:fs/promises';

import { restoreSnapshotRecoveryCapsule } from '../../src/persistence/index.js';

const [directory, name, capsulePath, expectedCapsuleId, crashStage] = process.argv.slice(2);

if (!directory || !name || !capsulePath || !expectedCapsuleId || !crashStage) {
  process.stderr.write(
    'usage: snapshot-recovery-capsule-crash-worker <directory> <name> <capsule> <capsule-id> <stage>\n',
  );
  process.exit(2);
}

const capsuleText = await readFile(capsulePath, 'utf8');
await restoreSnapshotRecoveryCapsule({
  directory,
  name,
  capsuleText,
  expectedCapsuleId,
  onStage(stage) {
    if (stage === crashStage) process.exit(86);
  },
});

process.stderr.write(`requested recovery stage was not reached: ${crashStage}\n`);
process.exit(4);
