import { buildReportPdf } from '../utils/reportPdf.js';

self.onmessage = ({ data }) => {
  if (data?.type !== 'generate') return;
  try {
    let lastProgress = 0;
    const result = buildReportPdf(data.model, { onProgress: (progress) => {
      const now = Date.now();
      if (progress.finalizing || progress.completedRows === progress.totalRows || now - lastProgress >= 100) {
        lastProgress = now;
        self.postMessage({ type: 'progress', progress });
      }
    } });
    self.postMessage({ type: 'complete', ...result }, [result.buffer]);
  } catch {
    self.postMessage({ type: 'error', message: 'Unable to generate the report. Please retry.' });
  }
};
