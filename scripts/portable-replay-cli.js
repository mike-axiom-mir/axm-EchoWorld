#!/usr/bin/env node
import fs from 'node:fs';

import { describeCapability } from '../src/capability.js';
import { createPortableReplay, verifyPortableReplay } from '../src/portable-replay.js';

const MAX_INPUT_BYTES = 256 * 1024;
const EXAMPLE = {
  schema: 'axm.echoworld.event-stream/v0.01',
  width: 8,
  height: 8,
  events: [
    { eventId: 'MOVE_1', type: 'MOVE', actorId: 'A', x: 2, y: 1, relationshipRelevant: true },
    { eventId: 'DAMAGE_1', type: 'DAMAGE_STRUCTURE', actorId: 'A', cellId: 'C_2_1', amount: 25 },
    { eventId: 'REJECTED_MOVE', type: 'MOVE', actorId: 'A', x: 99, y: 99 },
  ],
};

function usage() {
  return [
    'EchoWorld portable deterministic replay',
    '',
    'Commands:',
    '  describe        Print the machine-readable capability boundary',
    '  example         Print a valid bounded event stream',
    '  run [file|-]    Execute memory OFF/ON and emit a sealed replay receipt',
    '  verify [file|-] Verify integrity and deterministic re-execution',
  ].join('\n');
}

function readDocument(file) {
  const source = fs.readFileSync(!file || file === '-' ? 0 : file);
  if (source.length > MAX_INPUT_BYTES) throw new Error('ECHOWORLD_CLI_INPUT_TOO_LARGE');
  return JSON.parse(source.toString('utf8'));
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const [command, file] = process.argv.slice(2);

try {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(`${usage()}\n`);
  } else if (command === 'describe') {
    output({ command, capability: describeCapability() });
  } else if (command === 'example') {
    output(EXAMPLE);
  } else if (command === 'run') {
    output(createPortableReplay(readDocument(file)));
  } else if (command === 'verify') {
    output(verifyPortableReplay(readDocument(file)));
  } else {
    process.stderr.write(`Unknown command: ${command}\n\n${usage()}\n`);
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exitCode = 1;
}
