import { open, rename, rm } from 'node:fs/promises';

import { AtomicSnapshotError } from './atomic-types.js';

export async function writeFileWithSync(filePath, text) {
  const handle = await open(filePath, 'w', 0o600);
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close().catch(() => {});
  }
}

export async function syncDirectory(directory, { requireDirectorySync = true } = {}) {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
    return { synced: true, unsupportedCode: null };
  } catch (error) {
    if (['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].includes(error?.code)) {
      if (requireDirectorySync) {
        throw new AtomicSnapshotError(
          'DIRECTORY_FSYNC_UNSUPPORTED',
          'The current platform did not permit directory fsync.',
          { code: error.code, directory },
        );
      }
      return { synced: false, unsupportedCode: error.code };
    }
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function renameReplacing(source, destination) {
  try {
    await rename(source, destination);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
    await rm(destination, { force: true });
    await rename(source, destination);
  }
}

export async function cleanupTransientSnapshotPaths(paths) {
  for (const filePath of [paths.temp, paths.recoveryTemp, paths.backupTemp]) {
    await rm(filePath, { force: true });
  }
}
