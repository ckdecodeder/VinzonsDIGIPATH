import { runReportWorker, reportAbortError, waitForReportTask } from './reportWorkerClient.js';

const checkAbort = (signal) => { if (signal?.aborted) throw reportAbortError(); };

export const triggerReportDownload = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  // Give the browser time to consume the download before revoking its URL.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

export async function prepareReportPdf(model, options = {}) {
  checkAbort(options.signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 5000);
  let sealBytes;
  try {
    const response = await fetch('/Seal_of_Vinzons.png', { signal: controller.signal });
    if (!response.ok) throw new Error('Seal unavailable');
    sealBytes = await response.arrayBuffer();
  } catch {
    checkAbort(options.signal);
    throw new Error('The report seal could not load. Check the connection and retry.');
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  checkAbort(options.signal);
  return runReportWorker({ ...model, sealBytes }, options);
}

export const exportReportPagesAsPdf = (file, filename) => triggerReportDownload(new Blob([file.buffer], { type: 'application/pdf' }), filename);

// One reusable canvas and one image per sheet. Multi-page JPEG reports are a
// complete ZIP, never a browser-sized canvas or a silent first-page truncation.
export async function exportReportPagesAsJpeg(file, filename, { signal, onProgress } = {}) {
  checkAbort(signal);
  const [pdfjs, { Zip, ZipPassThrough }] = await waitForReportTask(Promise.all([import('pdfjs-dist'), import('fflate')]), signal);
  checkAbort(signal);
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const loading = pdfjs.getDocument({ data: new Uint8Array(file.buffer.slice(0)), isEvalSupported: false });
  let pdf;
  let rendering;
  const canvas = document.createElement('canvas');
  const chunks = [];
  let archiveBytes = 0;
  let complete = false;
  let archiveError;
  const zip = new Zip((error, bytes, final) => {
    if (error) { archiveError = error; return; }
    archiveBytes += bytes.length;
    if (archiveBytes > 128 * 1024 * 1024) { archiveError = new Error('The image archive is too large. Download the complete report as PDF instead.'); return; }
    chunks.push(bytes); complete = final;
  });
  const abort = () => { rendering?.cancel(); loading.destroy().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    pdf = await loading.promise;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      checkAbort(signal);
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.5 });
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      rendering = page.render({ canvasContext: canvas.getContext('2d'), viewport, background: 'white' });
      await rendering.promise;
      const image = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      checkAbort(signal);
      if (!image) throw new Error('Unable to generate a report image. Please retry.');
      if (pdf.numPages === 1) {
        triggerReportDownload(image, filename);
      } else {
        const entry = new ZipPassThrough(`page-${String(pageNumber).padStart(4, '0')}.jpg`);
        zip.add(entry); entry.push(new Uint8Array(await image.arrayBuffer()), true);
        if (archiveError) throw archiveError;
      }
      onProgress?.({ completedRows: pageNumber, totalRows: pdf.numPages, pages: pdf.numPages, stage: 'images' });
      page.cleanup();
      canvas.width = 0; canvas.height = 0;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (pdf.numPages > 1) {
      zip.end();
      if (archiveError) throw archiveError;
      if (!complete) throw new Error('The image archive could not finish. Download the PDF or retry.');
      checkAbort(signal);
      triggerReportDownload(new Blob(chunks, { type: 'application/zip' }), filename.replace(/\.jpe?g$/i, '.zip'));
    }
  } catch (error) { checkAbort(signal); throw error; }
  finally {
    signal?.removeEventListener('abort', abort); zip.terminate();
    canvas.width = 0; canvas.height = 0; chunks.length = 0;
    if (pdf) await pdf.destroy(); else await loading.destroy().catch(() => {});
  }
}

export const buildReportFilename = (label, format) => {
  const date = new Date().toISOString().split('T')[0];
  const safeLabel = String(label || 'Report').replace(/[^a-zA-Z0-9_-]+/g, '-');
  return `DigiPath-${safeLabel}-${date}.${format === 'jpeg' ? 'jpg' : format}`;
};
