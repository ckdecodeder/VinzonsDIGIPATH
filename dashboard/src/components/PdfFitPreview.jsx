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
  const lastRenderedWidthRef = useRef(0);
  const hasRenderedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!src) return undefined;

    let cancelled = false;
    lastRenderedWidthRef.current = 0;
    hasRenderedRef.current = false;

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

      const containerWidth = Math.max(
        Math.round(wrapRef.current?.clientWidth || 0),
        0,
      );
      if (containerWidth < 80) {
        // Grid layout may report 0 width on first paint — wait for a real size.
        scheduleRender(120);
        return;
      }
      const renderWidth = Math.max(containerWidth, 280);

      // Avoid the resize feedback loop: only the first paint or a real width
      // change should trigger a re-render.
      if (hasRenderedRef.current && containerWidth === lastRenderedWidthRef.current) {
        return;
      }

      // Only show the loading overlay before the very first successful paint,
      // so resize re-renders don't flicker.
      if (!hasRenderedRef.current) {
        setLoading(true);
      }
      setError('');

      try {
        const doc = await pdfjs.getDocument(src).promise;
        if (cancelled || generation !== renderGenerationRef.current) return;

        const page = await doc.getPage(1);
        if (cancelled || generation !== renderGenerationRef.current) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const scale = renderWidth / baseViewport.width;
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
        lastRenderedWidthRef.current = renderWidth;
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
      ? new ResizeObserver((entries) => {
          const width = Math.round(entries[0]?.contentRect?.width || 0);
          // Ignore height-only changes (canvas grows vertically after paint)
          // and sub-pixel jitter that would otherwise cause a render loop.
          if (Math.abs(width - lastRenderedWidthRef.current) < 2) return;
          scheduleRender(200);
        })
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
      {loading && !error && (
        <div className="scanner-pdf-fit-status">Loading preview...</div>
      )}
      {error && (
        <div className="scanner-pdf-fit-status scanner-pdf-fit-status-error">{error}</div>
      )}
      <canvas ref={canvasRef} className="scanner-pdf-canvas" />
    </div>
  );
}
