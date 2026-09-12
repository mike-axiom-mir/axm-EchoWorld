import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildObserverPayload } from '../src/observer/demo.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = resolve(root, 'observer/template.html');
const outputPath = resolve(root, 'observer/index.html');

const template = await readFile(templatePath, 'utf8');
const serialized = JSON.stringify(buildObserverPayload()).replaceAll('<', '\\u003c');
const output = template.replace('/*__ECHOWORLD_DEMO__*/', serialized);

if (output === template) throw new Error('Observer data marker not found.');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, output);
console.log(`Built ${outputPath}`);
