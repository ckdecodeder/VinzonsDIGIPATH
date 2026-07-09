import { getApiBase } from '../api/apiBase';

const isLocalApiBase = (apiBase = '') => (
  apiBase.startsWith('/')
  || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(apiBase)
);

const getBackendRoot = () => {
  const apiBase = getApiBase();
  if (isLocalApiBase(apiBase)) return '';
  return apiBase.replace(/\/api\/?$/, '');
};

/** Vite dev proxies /uploads to the configured backend — keep same-origin for previews. */
const prefersSameOriginUploads = () => (
  typeof window !== 'undefined' && import.meta.env.DEV
);

/** Turn stored upload URLs into browser-fetchable paths. */
export function resolveUploadUrl(url) {
  if (!url || typeof url !== 'string') return null;

  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;

  let path = trimmed;
  if (!path.startsWith('/uploads/')) {
    try {
      const parsed = new URL(trimmed, window.location.origin);
      if (parsed.pathname.startsWith('/uploads/')) {
        path = `${parsed.pathname}${parsed.search}`;
      }
    } catch {
      // Keep original if parsing fails.
    }
  }

  if (path.startsWith('/uploads/')) {
    if (prefersSameOriginUploads()) return path;
    const root = getBackendRoot();
    return root ? `${root}${path}` : path;
  }

  return trimmed;
}

export function getAttachmentUrl(file) {
  if (!file) return '';

  const raw = file.url || file.dataUrl || '';
  if (raw) return resolveUploadUrl(raw) || '';

  if (file.storagePath) {
    const path = file.storagePath.startsWith('/')
      ? file.storagePath
      : `/${file.storagePath}`;
    return resolveUploadUrl(path) || '';
  }

  return '';
}

export function isPdfMedia(url, mimeType = '') {
  if (mimeType === 'application/pdf') return true;
  if (!url) return false;
  return /\.pdf($|[?#])/i.test(url);
}
