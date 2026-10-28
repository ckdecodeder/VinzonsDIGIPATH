const fs = require('fs');
const path = require('path');
const { generateId } = require('./helpers');

const { scansRoot: uploadRoot, resolveScanPath } = require('../config/storage');
const maxAttachmentsPerDocument = Number(process.env.MAX_ATTACHMENTS_PER_DOCUMENT || 50);
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

const getUploadUrl = (req, filename) => `/uploads/scans/${filename}`;

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

const resolveStoredScanPath = resolveScanPath;

/** Attachments plus the scanner page images stored inside a combined scan PDF. */
const flattenAttachmentFiles = (files = []) => (files || []).flatMap((file) => (
  file ? [file, ...(Array.isArray(file.pages) ? file.pages.filter(Boolean) : [])] : []
));

const isScannerPdf = (file) => Boolean(file && Array.isArray(file.pages));

const isImageAttachment = (file) => {
  const type = String(file?.type || '').toLowerCase();
  if (type) return type.startsWith('image/');
  return /\.(jpe?g|png|webp)(\?|#|$)/i.test(String(file?.url || file?.name || ''));
};

/** Scanner page images of a document: pages inside the scan PDF, or legacy scanner JPEG attachments. */
const getScannerPages = (files = []) => (files || []).flatMap((file) => {
  if (isScannerPdf(file)) return file.pages.filter(Boolean);
  if (file?.source === 'scanner' && isImageAttachment(file)) return [file];
  return [];
});

const readJpegInfo = (buffer) => {
  if (!buffer || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
        components: buffer[offset + 9],
      };
    }
    offset += 2 + length;
  }
  return null;
};

const PDF_PAGE_SHORT_SIDE_PT = 595.28;

/** Minimal PDF with one page per JPEG (embedded as-is via DCTDecode, no re-encoding). */
const buildJpegPdf = (jpegBuffers = []) => {
  const pages = jpegBuffers
    .map((buffer) => ({ buffer, info: readJpegInfo(buffer) }))
    .filter((page) => page.info?.width && page.info?.height);
  if (!pages.length) return null;

  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (data) => {
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data, 'binary');
    chunks.push(chunk);
    length += chunk.length;
  };
  const beginObject = (number) => {
    offsets[number] = length;
    push(`${number} 0 obj\n`);
  };

  const objectCount = 2 + pages.length * 3;
  const pageObjectNumbers = pages.map((_, index) => 3 + index * 3);

  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  beginObject(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  beginObject(2);
  push(`<< /Type /Pages /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach(({ buffer, info }, index) => {
    const pageNumber = pageObjectNumbers[index];
    const imageNumber = pageNumber + 1;
    const contentNumber = pageNumber + 2;
    const portrait = info.height >= info.width;
    const pageWidth = portrait ? PDF_PAGE_SHORT_SIDE_PT : PDF_PAGE_SHORT_SIDE_PT * (info.width / info.height);
    const pageHeight = portrait ? PDF_PAGE_SHORT_SIDE_PT * (info.height / info.width) : PDF_PAGE_SHORT_SIDE_PT;
    const w = pageWidth.toFixed(2);
    const h = pageHeight.toFixed(2);
    const colorSpace = info.components === 1 ? '/DeviceGray' : info.components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    const decode = info.components === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q\n`;

    beginObject(pageNumber);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${imageNumber} 0 R >> >> /Contents ${contentNumber} 0 R >>\nendobj\n`);
    beginObject(imageNumber);
    push(`<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${colorSpace} /BitsPerComponent 8${decode} /Filter /DCTDecode /Length ${buffer.length} >>\nstream\n`);
    push(buffer);
    push('\nendstream\nendobj\n');
    beginObject(contentNumber);
    push(`<< /Length ${Buffer.byteLength(content, 'binary')} >>\nstream\n${content}endstream\nendobj\n`);
  });

  const xrefOffset = length;
  push(`xref\n0 ${objectCount + 1}\n0000000000 65535 f\r\n`);
  for (let number = 1; number <= objectCount; number += 1) {
    push(`${String(offsets[number]).padStart(10, '0')} 00000 n\r\n`);
  }
  push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.concat(chunks);
};

/**
 * Build the combined PDF attachment for scanner pages. The page images stay on
 * disk and are kept in `pages` so the scanner review flow can still show them.
 */
const buildScanPdfAttachment = async (req, pages = [], { baseName = 'scanned-document', uploadedAt } = {}) => {
  const usablePages = [];
  const buffers = [];
  for (const page of pages) {
    const diskPath = resolveStoredScanPath(page);
    if (!diskPath) continue;
    try {
      const buffer = await fs.promises.readFile(diskPath);
      if (!readJpegInfo(buffer)) continue;
      usablePages.push(page);
      buffers.push(buffer);
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`Unable to read scan page ${diskPath}:`, err.message);
    }
  }

  const pdfBuffer = buildJpegPdf(buffers);
  if (!pdfBuffer) return null;

  await fs.promises.mkdir(uploadRoot, { recursive: true });
  const cleanBaseName = sanitizeFileName(baseName);
  const filename = `${Date.now()}-${Math.floor(Math.random() * 10000)}-${cleanBaseName}.pdf`;
  await fs.promises.writeFile(path.join(uploadRoot, filename), pdfBuffer);

  return {
    id: generateId('ATT'),
    name: `${cleanBaseName}.pdf`,
    type: 'application/pdf',
    size: pdfBuffer.length,
    url: getUploadUrl(req, filename),
    storagePath: `uploads/scans/${filename}`,
    uploadedAt: uploadedAt || new Date().toISOString(),
    uploadedBy: 'hardware',
    source: 'scanner',
    pages: usablePages,
  };
};

/** Delete scan files that were dropped from a document's scannedFiles list. */
const removeOrphanedAttachments = async (previous = [], next = []) => {
  const nextFiles = flattenAttachmentFiles(next);
  const keptIds = new Set(nextFiles.map((file) => file?.id).filter(Boolean));
  const keptPaths = new Set(
    nextFiles
      .map((file) => resolveStoredScanPath(file))
      .filter(Boolean)
      .map((p) => path.normalize(p)),
  );

  await Promise.all(flattenAttachmentFiles(previous).map(async (file) => {
    if (file?.id && keptIds.has(file.id)) return;
    const diskPath = resolveStoredScanPath(file);
    if (!diskPath) return;
    if (keptPaths.has(path.normalize(diskPath))) return;
    try {
      await fs.promises.unlink(diskPath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`Unable to remove orphaned attachment ${diskPath}:`, err.message);
      }
    }
  }));
};

module.exports = {
  maxAttachmentsPerDocument,
  sanitizeFileName,
  extensionFromAttachment,
  getUploadUrl,
  persistAttachment,
  persistAttachments,
  removeOrphanedAttachments,
  buildJpegPdf,
  buildScanPdfAttachment,
  getScannerPages,
  isScannerPdf,
};
