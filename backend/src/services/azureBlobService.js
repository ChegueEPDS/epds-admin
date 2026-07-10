const { BlobServiceClient } = require('@azure/storage-blob');

const AZURE_STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER_NAME = process.env.AZURE_BLOB_CONTAINER_NAME || 'epds-admin';

if (!AZURE_STORAGE_CONNECTION_STRING) {
  console.warn('[blob] AZURE_STORAGE_CONNECTION_STRING is not configured; blob operations will fail until it is set.');
}

const blobServiceClient = AZURE_STORAGE_CONNECTION_STRING
  ? BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING)
  : null;
const containerClient = blobServiceClient?.getContainerClient(CONTAINER_NAME);
let containerReadyPromise = null;

function requireContainer() {
  if (!containerClient) {
    throw new Error('Azure Blob Storage is not configured');
  }
  return containerClient;
}

async function ensureContainer() {
  const client = requireContainer();
  if (!containerReadyPromise) {
    containerReadyPromise = client.createIfNotExists();
  }
  await containerReadyPromise;
  return client;
}

function toBlobPath(input) {
  if (!input) return '';
  const value = String(input).trim();
  try {
    if (value.startsWith('http://') || value.startsWith('https://')) {
      const url = new URL(value);
      const parts = url.pathname.split('/').filter(Boolean);
      const containerIndex = parts.findIndex((part) => part === CONTAINER_NAME);
      return containerIndex >= 0 ? parts.slice(containerIndex + 1).join('/') : parts.slice(1).join('/');
    }
  } catch {}
  return value.split('?')[0].replace(/^\/+/, '');
}

function getBlobUrl(blobPath) {
  const path = toBlobPath(blobPath);
  return requireContainer().getBlockBlobClient(path).url;
}

async function uploadBuffer(blobNameOrPath, buffer, contentType = 'application/octet-stream') {
  const blobPath = toBlobPath(blobNameOrPath);
  if (!blobPath) throw new Error('uploadBuffer: missing blob name/path');
  const blockBlobClient = (await ensureContainer()).getBlockBlobClient(blobPath);
  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType }
  });
  return blobPath;
}

async function downloadToBuffer(blobNameOrPath) {
  const blobPath = toBlobPath(blobNameOrPath);
  if (!blobPath) throw new Error('downloadToBuffer: missing blob name/path');
  const blockBlobClient = requireContainer().getBlockBlobClient(blobPath);
  const response = await blockBlobClient.download();
  const stream = response.readableStreamBody;
  if (!stream) return Buffer.alloc(0);
  const chunks = [];
  await new Promise((resolve, reject) => {
    stream.on('data', (data) => chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data)));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return Buffer.concat(chunks);
}

async function deleteFile(blobNameOrPath) {
  const blobPath = toBlobPath(blobNameOrPath);
  if (!blobPath) return { succeeded: false };
  return requireContainer().getBlockBlobClient(blobPath).deleteIfExists();
}

module.exports = {
  uploadBuffer,
  downloadToBuffer,
  deleteFile,
  getBlobUrl,
  toBlobPath
};
