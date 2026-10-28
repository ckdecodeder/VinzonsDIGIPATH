import React, { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

// One canvas regardless of page count, including browsers without a PDF plugin.
export default function ReportPdfPreview({ file }) {
  const canvasRef = useRef(null);
  const renderRef = useRef(Promise.resolve());
  const [pdf, setPdf] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setPdf(null); setBusy(true); setError('');
    const loading = pdfjs.getDocument({ url: file.url, isEvalSupported: false });
    loading.promise.then((document) => { if (active) setPdf(document); }).catch(() => {
      if (active) { setError('The PDF preview could not load. Retry, or download the PDF.'); setBusy(false); }
    });
    return () => { active = false; loading.destroy().catch(() => {}); };
  }, [file.url, attempt]);

  useEffect(() => {
    if (!pdf) return undefined;
    let cancelled = false;
    let task;
    let page;
    setBusy(true); setError('');
    // Wait for cancelled rendering to release the canvas before reusing it.
    renderRef.current = renderRef.current.catch(() => {}).then(async () => {
      try {
        if (cancelled) return;
        page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        task = page.render({ canvasContext: canvas.getContext('2d'), viewport, background: 'white' });
        await task.promise;
        if (!cancelled) setBusy(false);
      } catch {
        if (!cancelled) { setError('This page could not render. Retry, or download the PDF.'); setBusy(false); }
      } finally { page?.cleanup(); }
    });
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, pageNumber]);

  const navigate = (value) => {
    const next = Math.max(1, Math.min(file.pageCount, Math.trunc(Number(value)) || 1));
    setPageNumber(next); setPageInput(String(next));
  };

  return <div className="report-pdf-preview">
    <form className="report-generation-status" onSubmit={(event) => { event.preventDefault(); navigate(pageInput); }}>
      <button type="button" className="btn btn-secondary btn-sm" disabled={pageNumber === 1 || busy} onClick={() => navigate(pageNumber - 1)}>Previous</button>
      <label>Page <input aria-label="Report preview page" type="number" min="1" max={file.pageCount} value={pageInput} onChange={(event) => setPageInput(event.target.value)} /></label>
      <span>of {file.pageCount.toLocaleString()}</span>
      <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>Go</button>
      <button type="button" className="btn btn-secondary btn-sm" disabled={pageNumber === file.pageCount || busy} onClick={() => navigate(pageNumber + 1)}>Next</button>
      {busy && <span role="status">Loading page…</span>}
    </form>
    {error && <div className="report-generation-status" role="alert">{error}<button className="btn btn-secondary btn-sm" onClick={() => setAttempt((value) => value + 1)}>Retry preview</button></div>}
    <div className="report-pdf-page-scroll" aria-busy={busy}>
      <canvas ref={canvasRef} role="img" aria-label={`Report page ${pageNumber} of ${file.pageCount}`} />
    </div>
  </div>;
}
