export const reportAbortError = () => Object.assign(new Error('Report generation cancelled.'), { name: 'AbortError' });

// Dynamic module downloads cannot be aborted themselves. Stop waiting on them
// immediately so Cancel/deadlines still release the UI if a chunk stalls.
export function waitForReportTask(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(reportAbortError());
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

export function runReportWorker(model, { signal, onProgress, timeoutMs = 120000, workerFactory = () => new Worker(new URL('../workers/reportPdf.worker.js', import.meta.url), { type: 'module' }) } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(reportAbortError()); return; }
    let worker;
    let timer;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      worker?.terminate();
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(reportAbortError());
    try {
      worker = workerFactory();
      worker.onmessage = ({ data }) => {
        if (settled) return;
        if (data.type === 'progress') onProgress?.(data.progress);
        if (data.type === 'complete') finish(null, data);
        if (data.type === 'error') finish(new Error(data.message));
      };
      worker.onerror = () => finish(new Error('Report generation stopped unexpectedly. Please retry.'));
      worker.onmessageerror = () => finish(new Error('Unable to read the generated report. Please retry.'));
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish(new Error('Report generation took too long. Retry or select a smaller date range.')), timeoutMs);
      worker.postMessage({ type: 'generate', model });
    } catch { finish(new Error('Unable to start report generation. Please retry in a supported browser.')); }
  });
}
