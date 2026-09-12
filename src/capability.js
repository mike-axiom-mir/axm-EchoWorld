import fs from 'node:fs';

const packageUrl = new URL('../package.json', import.meta.url);

export function describeCapability() {
  const document = JSON.parse(fs.readFileSync(packageUrl, 'utf8'));
  const capability = document.axmCapability;
  if (!capability || capability.schema !== 'axm.capability/v1') {
    throw new Error('ECHOWORLD_CAPABILITY_METADATA_MISSING');
  }
  return structuredClone(capability);
}
