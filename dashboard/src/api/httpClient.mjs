export class ApiError extends Error {
  constructor(message, details = {}) { super(message); this.name = 'ApiError'; Object.assign(this, details); }
}
const cancelled = () => new ApiError('Request cancelled.', { code: 'ABORTED', name: 'AbortError' });
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(cancelled()); return; }
  const abort = () => { clearTimeout(timer); reject(cancelled()); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  signal?.addEventListener('abort', abort, { once: true });
});

// Keep the deadline active until the complete response body has been consumed.
export async function requestWithDeadline(url, options = {}, dependencies = {}) {
  const { timeoutMs = 15000, retries = 1, responseType = 'json', signal, ...fetchOptions } = options;
  const fetchFn = dependencies.fetch || globalThis.fetch;
  const safe = ['GET', 'HEAD'].includes((fetchOptions.method || 'GET').toUpperCase());
  const attempts = safe ? Math.min(Math.max(retries, 0), 2) + 1 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal?.aborted) throw cancelled();
    const controller = new AbortController();
    let timer;
    let abort;
    let retryDelay = Math.min(250 * (2 ** attempt) + Math.random() * 100, 2000);
    try {
      const deadline = new Promise((_, reject) => {
        abort = () => { controller.abort(); reject(cancelled()); };
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => {
          controller.abort();
          reject(new ApiError('The request took too long. Please retry.', { code: 'TIMEOUT' }));
        }, Math.max(1, timeoutMs));
      });
      return await Promise.race([deadline, (async () => {
        const res = await fetchFn(url, { ...fetchOptions, signal: controller.signal });
        const isJson = /\bapplication\/(?:[\w.-]+\+)?json\b/i.test(res.headers.get('content-type') || '');
        let data;
        if (res.ok && responseType === 'blob') data = await res.blob();
        else {
          const body = await res.text();
          if (isJson && body) {
            try { data = JSON.parse(body); }
            catch { throw new ApiError('The server returned invalid JSON. Please retry.', { code: 'INVALID_RESPONSE', status: res.status }); }
          } else if (res.ok && body) {
            throw new ApiError('The server returned a page instead of API data. Check the connection.', { code: 'INVALID_RESPONSE' });
          }
        }
        if (!res.ok) {
          const retryAfter = res.headers.get('retry-after');
          const retryAfterMs = retryAfter && (/^\d+(\.\d+)?$/.test(retryAfter)
            ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()));
          throw new ApiError(data?.message || data?.error || `Request failed (${res.status}). Please retry.`, {
            code: 'HTTP_ERROR', status: res.status, data, retryAfterMs,
          });
        }
        return data ?? null;
      })()]);
    } catch (cause) {
      const error = signal?.aborted ? cancelled() : cause instanceof ApiError ? cause
        : new ApiError('Unable to reach the server. Check your connection and retry.', { code: 'NETWORK_ERROR', cause });
      const retryable = ['TIMEOUT', 'NETWORK_ERROR'].includes(error.code) || [408, 429, 502, 503, 504].includes(error.status);
      if (!safe || !retryable || attempt + 1 >= attempts || error.retryAfterMs > 2000) throw error;
      if (Number.isFinite(error.retryAfterMs)) retryDelay = Math.max(retryDelay, error.retryAfterMs);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
    await sleep(retryDelay, signal);
  }
}
