import { getApiBase } from '../api/apiBase';

/** Backend root when the API is on another host (Vercel, remote tunnel). */
function resolveBackendRoot() {
  if (typeof window === 'undefined') return null;

  const apiBase = getApiBase();
  if (!apiBase || apiBase.startsWith('/')) {
    return null;
  }

  try {
    const root = apiBase.replace(/\/api\/?$/, '').replace(/\/$/, '');
    const backendOrigin = new URL(root).origin;
    if (backendOrigin === window.location.origin) {
      return null;
    }
    return root;
  } catch {
    return null;
  }
}

function withBackendOrigin(uploadPath) {
  const backendRoot = resolveBackendRoot();
  if (!backendRoot) return uploadPath;
  return `${backendRoot}${uploadPath}`;
}

/** Resolve stored upload URLs for display and download. */
export function resolveUploadUrl(url) {
  if (!url || typeof url !== 'string') return null;

  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;

  if (trimmed.startsWith('/uploads/')) {
    return withBackendOrigin(trimmed);
  }

  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.pathname.startsWith('/uploads/')) {
      return withBackendOrigin(`${parsed.pathname}${parsed.search}`);
    }
  } catch {
    // Keep original if parsing fails.
  }

  return trimmed;
}

export function isPdfMedia(url, mimeType = '') {
  if (mimeType === 'application/pdf') return true;
  if (!url) return false;
  return /\.pdf($|[?#])/i.test(url);
}

/** Resolve display URL from an attachment file object. */
export function getAttachmentUrl(file) {
  return resolveUploadUrl(file?.url || file?.dataUrl || '') || '';
}
