const path = require('path');
const { TextDecoder } = require('util');
const azureBlob = require('./azureBlobService');
const { transitionStatus } = require('./licenseIntegrationService');

const MAX_LICENSE_FILE_SIZE = 3 * 1024 * 1024;
const MAX_MOBILE_APP_FILE_SIZE = 100 * 1024 * 1024;
const LICENSE_ALLOWED_EXTENSIONS = new Set(['.zip', '.txt', '.docx']);
const MOBILE_APP_ALLOWED_EXTENSIONS = new Set(['.apk']);
const ZIP_SIGNATURES = new Set(['504b0304', '504b0506', '504b0708']);

function safePathSegment(input, fallback = 'file') {
  return String(input || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._ -]+/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[/.\\]+$/g, '')
    .slice(0, 120) || fallback;
}

function cleanFileName(input) {
  return safePathSegment(path.basename(String(input || 'license-file')), 'license-file').replace(/[\\/]/g, '_');
}

function normalizeMobileAppVersion(input) {
  return String(input || '').trim().slice(0, 64);
}

function validateLicenseFile(file) {
  if (!file?.buffer?.length) {
    const error = new Error('No file provided');
    error.statusCode = 400;
    throw error;
  }
  if (file.buffer.length > MAX_LICENSE_FILE_SIZE) {
    const error = new Error('License file must not exceed 3 MB');
    error.statusCode = 413;
    throw error;
  }

  const extension = path.extname(String(file.originalname || '')).toLowerCase();
  if (!LICENSE_ALLOWED_EXTENSIONS.has(extension)) {
    const error = new Error('Only ZIP, TXT and DOCX license files are allowed');
    error.statusCode = 415;
    throw error;
  }

  if (extension === '.zip' || extension === '.docx') {
    const signature = file.buffer.subarray(0, 4).toString('hex');
    if (!ZIP_SIGNATURES.has(signature)) {
      const error = new Error('Invalid ZIP or DOCX file content');
      error.statusCode = 415;
      throw error;
    }
  } else {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
    } catch {
      const error = new Error('TXT license file must contain valid UTF-8 text');
      error.statusCode = 415;
      throw error;
    }
  }

  return { fileName: cleanFileName(file.originalname), extension };
}

function validateMobileAppFile(file) {
  if (!file?.buffer?.length) {
    const error = new Error('No file provided');
    error.statusCode = 400;
    throw error;
  }
  if (file.buffer.length > MAX_MOBILE_APP_FILE_SIZE) {
    const error = new Error('Mobile app file must not exceed 100 MB');
    error.statusCode = 413;
    throw error;
  }

  const extension = path.extname(String(file.originalname || '')).toLowerCase();
  if (!MOBILE_APP_ALLOWED_EXTENSIONS.has(extension)) {
    const error = new Error('Only APK mobile app files are allowed');
    error.statusCode = 415;
    throw error;
  }

  const signature = file.buffer.subarray(0, 4).toString('hex');
  if (!ZIP_SIGNATURES.has(signature)) {
    const error = new Error('Invalid APK file content');
    error.statusCode = 415;
    throw error;
  }

  return { fileName: cleanFileName(file.originalname), extension };
}

function buildFileMetadata(blobPath, fileName, file, actor) {
  return {
    fileName,
    blobPath,
    blobUrl: azureBlob.getBlobUrl(blobPath),
    contentType: file.mimetype || 'application/octet-stream',
    size: file.buffer.length,
    uploadedAt: new Date(),
    uploadedBy: actor.userId || undefined,
    uploadedByName: actor.name || 'API integration',
    integrationClientId: actor.integrationClientId || undefined,
    idempotencyKeyHash: actor.idempotencyKeyHash || undefined
  };
}

async function replaceLicenseFile(license, file, actor) {
  const { fileName } = validateLicenseFile(file);
  const customerSegment = safePathSegment(license.customerName, String(license._id));
  const blobPath = `EPDS_Admin/License/${customerSegment}/${Date.now()}_${fileName}`;
  const contentType = file.mimetype || 'application/octet-stream';
  const previousBlobPath = license.licenseFile?.blobPath || '';

  await azureBlob.uploadBuffer(blobPath, file.buffer, contentType);
  try {
    license.licenseFile = buildFileMetadata(blobPath, fileName, file, actor);
    if (license.status === 'ordered') transitionStatus(license, 'pending');
    if (actor.userId) license.updatedBy = actor.userId;
    await license.save();
  } catch (error) {
    try { await azureBlob.deleteFile(blobPath); } catch {}
    throw error;
  }

  if (previousBlobPath) {
    try { await azureBlob.deleteFile(previousBlobPath); } catch (error) {
      console.warn('[license-file] previous blob delete failed:', error?.message || error);
    }
  }
  return license;
}

async function replaceMobileAppFile(license, file, actor, version) {
  if (license.mobileApp !== true) {
    const error = new Error('Mobile app must be enabled before uploading APK');
    error.statusCode = 400;
    throw error;
  }

  const { fileName } = validateMobileAppFile(file);
  const customerSegment = safePathSegment(license.customerName, String(license._id));
  const blobPath = `EPDS_Admin/License/${customerSegment}/MobileApp/${Date.now()}_${fileName}`;
  const contentType = file.mimetype || 'application/vnd.android.package-archive';
  const previousBlobPath = license.mobileAppFile?.blobPath || '';

  await azureBlob.uploadBuffer(blobPath, file.buffer, contentType);
  try {
    license.mobileAppFile = buildFileMetadata(blobPath, fileName, { buffer: file.buffer, mimetype: contentType }, actor);
    if (version !== undefined) license.mobileAppVersion = normalizeMobileAppVersion(version);
    if (actor.userId) license.updatedBy = actor.userId;
    await license.save();
  } catch (error) {
    try { await azureBlob.deleteFile(blobPath); } catch {}
    throw error;
  }

  if (previousBlobPath) {
    try { await azureBlob.deleteFile(previousBlobPath); } catch (error) {
      console.warn('[mobile-app-file] previous blob delete failed:', error?.message || error);
    }
  }
  return license;
}

module.exports = {
  LICENSE_ALLOWED_EXTENSIONS,
  MAX_LICENSE_FILE_SIZE,
  MAX_MOBILE_APP_FILE_SIZE,
  MOBILE_APP_ALLOWED_EXTENSIONS,
  cleanFileName,
  normalizeMobileAppVersion,
  replaceLicenseFile,
  replaceMobileAppFile,
  validateLicenseFile,
  validateMobileAppFile
};
