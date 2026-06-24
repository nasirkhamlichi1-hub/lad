'use strict';

// Azure Blob Storage for large course materials (SCORM packages, videos, big
// PDFs). Files upload straight from the browser to the container via a
// short-lived write SAS URL, and download through a short-lived read SAS URL
// after the backend has checked the lawyer is enrolled — bytes never pass
// through this server.
//
// Configure with EITHER:
//   AZURE_STORAGE_CONNECTION_STRING   (recommended)
//   AZURE_STORAGE_CONTAINER           (optional, default 'course-materials')
// or:
//   AZURE_STORAGE_ACCOUNT + AZURE_STORAGE_KEY + AZURE_STORAGE_CONTAINER
//
// When unset, isConfigured() is false and the app cleanly falls back to inline
// (≤10 MB) uploads and links — nothing here is required to boot.

const CONTAINER = process.env.AZURE_STORAGE_CONTAINER || 'course-materials';
const UPLOAD_TTL_MIN = 30; // write window for an upload
const DOWNLOAD_TTL_MIN = 15; // read window for a download

let _creds = null; // { account, key }
function parseCreds() {
  if (_creds !== null) return _creds;
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING || '';
  if (conn) {
    const m = {};
    conn.split(';').forEach((kv) => { const i = kv.indexOf('='); if (i > 0) m[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); });
    if (m.AccountName && m.AccountKey) { _creds = { account: m.AccountName, key: m.AccountKey }; return _creds; }
  }
  if (process.env.AZURE_STORAGE_ACCOUNT && process.env.AZURE_STORAGE_KEY) {
    _creds = { account: process.env.AZURE_STORAGE_ACCOUNT, key: process.env.AZURE_STORAGE_KEY };
    return _creds;
  }
  _creds = false;
  return _creds;
}

function isConfigured() { return !!parseCreds(); }

// Lazy-require the SDK so the app boots even when the package isn't installed
// and Azure isn't configured.
function sdk() { return require('@azure/storage-blob'); }

function sharedKey() {
  const c = parseCreds();
  const { StorageSharedKeyCredential } = sdk();
  return new StorageSharedKeyCredential(c.account, c.key);
}

function blobBase() { return `https://${parseCreds().account}.blob.core.windows.net`; }

// A storage key (object path) for a course material.
function makeKey(courseId, fileName) {
  const safeCourse = String(courseId || 'course').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60);
  const safeName = String(fileName || 'file').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
  const rand = require('crypto').randomBytes(6).toString('hex');
  return `${safeCourse}/${Date.now()}-${rand}-${safeName}`;
}

// Presigned URL the browser PUTs the file to (Content-Type set by the client,
// x-ms-blob-type: BlockBlob header required).
function getUploadUrl(key, contentType) {
  const { generateBlobSASQueryParameters, BlobSASPermissions, SASProtocol } = sdk();
  const now = Date.now();
  const sas = generateBlobSASQueryParameters({
    containerName: CONTAINER, blobName: key,
    permissions: BlobSASPermissions.parse('cw'), // create + write
    startsOn: new Date(now - 5 * 60 * 1000),
    expiresOn: new Date(now + UPLOAD_TTL_MIN * 60 * 1000),
    protocol: SASProtocol.Https,
    contentType: contentType || undefined,
  }, sharedKey()).toString();
  return `${blobBase()}/${CONTAINER}/${encodeURI(key)}?${sas}`;
}

// Short-lived read URL, forcing a download with the original filename.
function getDownloadUrl(key, fileName) {
  const { generateBlobSASQueryParameters, BlobSASPermissions, SASProtocol } = sdk();
  const now = Date.now();
  const disp = fileName ? `attachment; filename="${String(fileName).replace(/"/g, '')}"` : undefined;
  const sas = generateBlobSASQueryParameters({
    containerName: CONTAINER, blobName: key,
    permissions: BlobSASPermissions.parse('r'),
    startsOn: new Date(now - 5 * 60 * 1000),
    expiresOn: new Date(now + DOWNLOAD_TTL_MIN * 60 * 1000),
    protocol: SASProtocol.Https,
    contentDisposition: disp,
  }, sharedKey()).toString();
  return `${blobBase()}/${CONTAINER}/${encodeURI(key)}?${sas}`;
}

async function deleteBlob(key) {
  try {
    const { BlobServiceClient } = sdk();
    const svc = new BlobServiceClient(blobBase(), sharedKey());
    await svc.getContainerClient(CONTAINER).getBlockBlobClient(key).deleteIfExists();
    return true;
  } catch (_) { return false; }
}

// Ensure the container exists (private). Best-effort, called on first upload.
async function ensureContainer() {
  try {
    const { BlobServiceClient } = sdk();
    const svc = new BlobServiceClient(blobBase(), sharedKey());
    await svc.getContainerClient(CONTAINER).createIfNotExists();
    return true;
  } catch (_) { return false; }
}

module.exports = { isConfigured, makeKey, getUploadUrl, getDownloadUrl, deleteBlob, ensureContainer, CONTAINER };
