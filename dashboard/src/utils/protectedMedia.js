import { requestWithDeadline } from '../api/httpClient.mjs';
import { resolveUploadUrl } from './mediaUrl';

// Only send the bearer token to the verified backend's managed upload path.
export const mediaRequest = (source) => {
  const url = resolveUploadUrl(source);
  if (!url) throw new Error('No scanned file is available.');
  const parsed = new URL(url, window.location.origin);
  const managed = parsed.pathname.startsWith('/uploads/scans/');
  const token = managed ? sessionStorage.getItem('dp_authToken') : null;
  return { url, headers: token ? { Authorization: `Bearer ${token}` } : {} };
};
export const readMediaBlob = async (source, signal) => {
  const { url, headers } = mediaRequest(source);
  return requestWithDeadline(url, { headers, signal, responseType: 'blob', timeoutMs: 90000, retries: 1 });
};
