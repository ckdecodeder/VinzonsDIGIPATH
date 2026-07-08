/** Turn stored upload URLs into same-origin paths the Vite proxy can serve. */
export function resolveUploadUrl(url) {
  if (!url || typeof url !== 'string') return null;

  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;
  if (trimmed.startsWith('/uploads/')) return trimmed;

  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.pathname.startsWith('/uploads/')) {
      return `${parsed.pathname}${parsed.search}`;
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
