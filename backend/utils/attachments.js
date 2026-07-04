const fs = require('fs');
const path = require('path');
const { generateId } = require('./helpers');

const uploadRoot = path.join(__dirname, '..', 'uploads', 'scans');
const maxAttachmentsPerDocument = Number(process.env.MAX_ATTACHMENTS_PER_DOCUMENT || 8);
const maxAttachmentBytes = Number(process.env.MAX_ATTACHMENT_BYTES || 10 * 1024 * 1024);
const allowedAttachmentMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const allowedAttachmentExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);

const sanitizeFileName = (name = 'scan') => {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'scan';
};

const extensionFromAttachment = (attachment) => {
  const nameExt = path.extname(attachment.name || '');
  if (nameExt) return nameExt;

  const mimeExtensions = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
  };

  return mimeExtensions[attachment.type] || '.bin';
};

const getUploadUrl = (req, filename) => `${req.protocol}://${req.get('host')}/uploads/scans/${filename}`;

const persistAttachment = async (req, attachment) => {
  if (!attachment) return attachment;

  const normalized = {
    ...attachment,
    id: attachment.id || generateId('ATT'),
    name: attachment.name || 'scan',
    uploadedAt: attachment.uploadedAt || new Date().toISOString(),
    source: attachment.source || 'upload',
  };

  if (normalized.size && normalized.size > maxAttachmentBytes) {
    const err = new Error(`Attachment exceeds the ${Math.round(maxAttachmentBytes / 1024 / 1024)}MB limit`);
    err.status = 400;
    throw err;
  }

  if (!normalized.dataUrl || normalized.url) return normalized;

  const match = normalized.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    const err = new Error('Invalid attachment data. Upload an image or PDF file.');
    err.status = 400;
    throw err;
  }

  await fs.promises.mkdir(uploadRoot, { recursive: true });

  const mimeType = normalized.type || match[1];
  if (!allowedAttachmentMimeTypes.has(mimeType)) {
    const err = new Error('Only JPG, PNG, WebP, and PDF files can be attached');
    err.status = 400;
    throw err;
  }

  const extension = extensionFromAttachment({ ...normalized, type: mimeType });
  if (!allowedAttachmentExtensions.has(extension.toLowerCase())) {
    const err = new Error('Only JPG, PNG, WebP, and PDF files can be attached');
    err.status = 400;
    throw err;
  }

  const cleanBaseName = sanitizeFileName(path.basename(normalized.name || 'scan', path.extname(normalized.name || '')));
  const filename = `${Date.now()}-${Math.floor(Math.random() * 10000)}-${cleanBaseName}${extension}`;
  const storagePath = path.join(uploadRoot, filename);
  const fileBuffer = Buffer.from(match[2], 'base64');
  if (fileBuffer.length > maxAttachmentBytes) {
    const err = new Error(`Attachment exceeds the ${Math.round(maxAttachmentBytes / 1024 / 1024)}MB limit`);
    err.status = 400;
    throw err;
  }

  await fs.promises.writeFile(storagePath, fileBuffer);

  return {
    ...normalized,
    type: mimeType,
    dataUrl: undefined,
    url: getUploadUrl(req, filename),
    storagePath: `uploads/scans/${filename}`,
  };
};

const persistAttachments = async (req, attachments = []) => {
  if (attachments.length > maxAttachmentsPerDocument) {
    const err = new Error(`A document can have at most ${maxAttachmentsPerDocument} attachments`);
    err.status = 400;
    throw err;
  }

  return Promise.all(attachments.map((attachment) => persistAttachment(req, attachment)));
};

module.exports = {
  sanitizeFileName,
  extensionFromAttachment,
  getUploadUrl,
  persistAttachment,
  persistAttachments,
};
