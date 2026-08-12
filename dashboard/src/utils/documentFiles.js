import { isPdfMedia, getAttachmentUrl } from './mediaUrl';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

const extractUploadPath = (raw) => {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('/uploads/')) return trimmed;
  if (trimmed.startsWith('uploads/')) return `/${trimmed}`;

  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;

  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.pathname.startsWith('/uploads/')) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Ignore parse errors.
  }

  if (/\.(jpe?g|png|webp|pdf)$/i.test(trimmed) && !trimmed.includes('/')) {
    return `/uploads/scans/${trimmed}`;
  }

  return trimmed;
};

const inferMedia = (raw, fallbackName = 'scanned-document') => {
  if (!raw) {
    return { name: fallbackName, type: 'application/octet-stream' };
  }

  if (raw.startsWith('data:')) {
    const mime = raw.match(/^data:([^;]+)/)?.[1] || 'application/octet-stream';
    const ext = mime === 'application/pdf' ? 'pdf' : mime.split('/')[1] || 'bin';
    const base = fallbackName.replace(/\.[^.]+$/, '');
    return { name: `${base}.${ext}`, type: mime };
  }

  const path = extractUploadPath(raw);
  const filename = path.split('/').pop() || fallbackName;
  const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
  return {
    name: filename,
    type: MIME_BY_EXT[ext] || 'application/octet-stream',
  };
};

const normalizeAttachment = (file) => {
  if (!file) return file;

  const raw = file.url || file.dataUrl || '';
  const storagePath = file.storagePath
    ? (file.storagePath.startsWith('/') ? file.storagePath : `/${file.storagePath}`)
    : '';

  if (raw.startsWith('data:') || raw.startsWith('blob:')) {
    return file;
  }

  const path = extractUploadPath(raw || storagePath);
  if (!path || path.startsWith('data:') || path.startsWith('blob:')) {
    return raw ? file : null;
  }

  const media = inferMedia(path, file.name || 'scanned-document');
  return {
    ...file,
    name: file.name || media.name,
    type: file.type || media.type,
    url: path,
    dataUrl: undefined,
  };
};

export const getDocumentFiles = (doc) => {
  if (!doc) return [];

  if (doc.scannedFiles?.length) {
    return doc.scannedFiles
      .map(normalizeAttachment)
      .filter(Boolean);
  }

  const raw = doc.scannedImageUrl?.trim();
  if (!raw) return [];

  const fallbackName = `${doc.trackingNumber || doc.id}-scan`;
  const media = inferMedia(raw, fallbackName);
  const path = extractUploadPath(raw);

  if (raw.startsWith('data:') || raw.startsWith('blob:')) {
    return [{
      id: `${doc.id}-scan`,
      name: media.name,
      type: media.type,
      dataUrl: raw,
      uploadedAt: doc.dateReceived,
      uploadedBy: null,
      source: 'camera',
    }];
  }

  return [{
    id: `${doc.id}-scan`,
    name: media.name,
    type: media.type,
    url: path,
    uploadedAt: doc.dateReceived,
    uploadedBy: null,
    source: 'camera',
  }];
};

export const isImageAttachment = (file) => {
  const source = getAttachmentUrl(file);
  if (file?.type?.startsWith('image/')) return true;
  if (source.startsWith('data:image/')) return true;
  const ext = (file?.name || source).split('.').pop()?.toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
};

export const isPdfAttachment = (file) => {
  const source = getAttachmentUrl(file);
  return isPdfMedia(source, file?.type || '')
    || file?.name?.toLowerCase().endsWith('.pdf')
    || source.startsWith('data:application/pdf');
};
