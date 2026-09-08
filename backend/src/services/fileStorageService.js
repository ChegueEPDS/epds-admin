const fs = require('fs/promises');
const { createReadStream } = require('fs');
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

async function openDownloadStream(storageKey, rangeHeader = '') {
  const { absolutePath } = resolveStoragePath(storageKey);
  const stats = await fs.stat(absolutePath);
  let start = 0;
  let end = stats.size - 1;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader || '').trim());
  if (match) {
    if (match[1]) start = Number(match[1]);
    if (match[2]) end = Number(match[2]);
    if (!match[1] && match[2]) start = Math.max(0, stats.size - Number(match[2]));
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= stats.size) {
      const error = new Error('Requested range is not satisfiable');
      error.statusCode = 416;
      error.size = stats.size;
      throw error;
    }
    end = Math.min(end, stats.size - 1);
  }
  return { stream: createReadStream(absolutePath, { start, end }), size: stats.size, start, end, partial: Boolean(match) };
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
  openDownloadStream,
  getBlobUrl,
  uploadBuffer
};
