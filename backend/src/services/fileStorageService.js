const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const STORAGE_ROOT = path.resolve(
  process.env.FILE_STORAGE_ROOT || path.resolve(__dirname, '..', '..', 'storage')
);

function resolveStoragePath(storageKey) {
  const normalized = String(storageKey || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!normalized) throw new Error('Missing storage key');

  const absolutePath = path.resolve(STORAGE_ROOT, normalized);
  const relativePath = path.relative(STORAGE_ROOT, absolutePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Invalid storage key');
  }
  return { absolutePath, storageKey: normalized };
}

async function uploadBuffer(storageKey, buffer) {
  const target = resolveStoragePath(storageKey);
  await fs.mkdir(path.dirname(target.absolutePath), { recursive: true });

  const temporaryPath = `${target.absolutePath}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, buffer, { flag: 'wx' });
    await fs.rename(temporaryPath, target.absolutePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  return target.storageKey;
}

async function downloadToBuffer(storageKey) {
  const { absolutePath } = resolveStoragePath(storageKey);
  return fs.readFile(absolutePath);
}

async function deleteFile(storageKey) {
  if (!storageKey) return { succeeded: false };
  const { absolutePath } = resolveStoragePath(storageKey);
  try {
    await fs.unlink(absolutePath);
    return { succeeded: true };
  } catch (error) {
    if (error.code === 'ENOENT') return { succeeded: false };
    throw error;
  }
}

// Files are deliberately private and are downloaded through authenticated API routes.
function getBlobUrl() {
  return '';
}

module.exports = {
  STORAGE_ROOT,
  deleteFile,
  downloadToBuffer,
  getBlobUrl,
  uploadBuffer
};
