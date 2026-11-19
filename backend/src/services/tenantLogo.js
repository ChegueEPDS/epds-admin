const maxLogoBytes = 256 * 1024;
const signatures = {
  png: (bytes) => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  jpeg: (bytes) => bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')),
  webp: (bytes) => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
};

function tenantLogoError(value) {
  if (value === undefined || value === null) return null;
  const error = 'Choose a PNG, JPEG or WebP image up to 256 KB.';
  if (typeof value !== 'string' || value.length > Math.ceil(maxLogoBytes / 3) * 4 + 24) return error;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return error;
  const [, format, encoded] = match;
  const bytes = Buffer.from(encoded, 'base64');
  return bytes.length <= maxLogoBytes && bytes.toString('base64') === encoded && signatures[format](bytes)
    ? null : error;
}

module.exports = { tenantLogoError };
