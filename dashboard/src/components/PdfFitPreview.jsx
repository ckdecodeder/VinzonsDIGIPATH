import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export default function PdfFitPreview({ src, alt = 'Scanned document PDF' }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const renderGenerationRef = useRef(0);
  const resizeTimerRef = useRef(null);
  const lastWidthRef = useRef(0);
  const hasRenderedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!src) return undefined;

    let cancelled = false;
    hasRenderedRef.current = false;
    lastWidthRef.current = 0;
    setLoading(true);
    setError('');

    const cancelActiveRender = async () => {
      const task = renderTaskRef.current;
      renderTaskRef.current = null;
      if (!task) return;
      try {
        task.cancel();
        await task.promise.catch(() => {});
      } catch {
        // Ignore cancellation errors.
      }
    };

    const render = async () => {
      const generation = ++renderGenerationRef.current;
      await cancelActiveRender();
      if (cancelled || generation !== renderGenerationRef.current) return;

      const containerWidth = Math.max(wrapRef.current?.clientWidth || 640, 280);
      const isResize = hasRenderedRef.current;
      const widthDelta = Math.abs(containerWidth - lastWidthRef.current);

      if (isResize && widthDelta < 12) return;

      lastWidthRef.current = containerWidth;

      if (!isResize) {
        setLoading(true);
        setError('');
      }

      try {
        const doc = await pdfjs.getDocument(src).promise;
        if (cancelled || generation !== renderGenerationRef.current) return;

        const page = await doc.getPage(1);
        if (cancelled || generation !== renderGenerationRef.current) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const scale = containerWidth / baseViewport.width;
        const viewport = page.getViewport({ scale });

        const canvas = canvasRef.current;
        if (!canvas || cancelled || generation !== renderGenerationRef.current) return;

        const context = canvas.getContext('2d');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        const task = page.render({ canvasContext: context, viewport, canvas });
        renderTaskRef.current = task;
        await task.promise;

        if (cancelled || generation !== renderGenerationRef.current) return;
        renderTaskRef.current = null;
        hasRenderedRef.current = true;
        setLoading(false);
      } catch (err) {
        if (cancelled || generation !== renderGenerationRef.current) return;
        if (err?.name === 'RenderingCancelledException') return;
        setError(err.message || 'Could not render PDF preview.');
        setLoading(false);
      }
    };

    const scheduleRender = (delayMs = 0) => {
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = setTimeout(() => {
        resizeTimerRef.current = null;
        if (!cancelled) render();
      }, delayMs);
    };

    scheduleRender(0);

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => scheduleRender(200))
      : null;

    if (observer && wrapRef.current) {
      observer.observe(wrapRef.current);
    }

    return () => {
      cancelled = true;
      renderGenerationRef.current += 1;
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      cancelActiveRender();
      observer?.disconnect();
    };
  }, [src]);

  return (
    <div ref={wrapRef} className="scanner-pdf-fit-wrap" aria-label={alt}>
      <canvas
        ref={canvasRef}
        className={`scanner-pdf-canvas${loading && !error ? ' is-loading' : ''}`}
      />
      {loading && !error && (
        <div className="scanner-pdf-fit-status" aria-live="polite">
          Loading preview...
        </div>
      )}
      {error && (
        <div className="scanner-pdf-fit-status scanner-pdf-fit-status-error">{error}</div>
      )}
    </div>
  );
}
