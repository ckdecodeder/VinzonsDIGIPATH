import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { mediaRequest } from '../utils/protectedMedia';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export default function PdfFitPreview({ src, alt = 'Scanned document PDF', allPages = false }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const extraPagesRef = useRef(null);
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
    let loadingTask;
    let documentPromise;
    let deadline;
    let timedOut = false;
    const loadDocument = () => {
      if (!documentPromise) {
        const request = mediaRequest(src);
        loadingTask = pdfjs.getDocument({ url: request.url, httpHeaders: request.headers });
        deadline = setTimeout(() => { timedOut = true; Promise.resolve(loadingTask.destroy()).catch(() => {}); }, 90000);
        documentPromise = loadingTask.promise.finally(() => clearTimeout(deadline));
      }
      return documentPromise;
    };
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
        const doc = await loadDocument();
        if (cancelled || generation !== renderGenerationRef.current) return;

        const pageCount = allPages ? doc.numPages : 1;
        const extraPages = extraPagesRef.current;
        if (extraPages) extraPages.replaceChildren();

        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
          const page = await doc.getPage(pageNumber);
          if (cancelled || generation !== renderGenerationRef.current) return;

          const baseViewport = page.getViewport({ scale: 1 });
          const scale = renderWidth / baseViewport.width;
          const viewport = page.getViewport({ scale });

          let canvas = canvasRef.current;
          if (pageNumber > 1) {
            if (!extraPages) break;
            canvas = document.createElement('canvas');
            canvas.className = 'scanner-pdf-canvas';
            extraPages.appendChild(canvas);
          }
          if (!canvas || cancelled || generation !== renderGenerationRef.current) return;

          const context = canvas.getContext('2d');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);

          const task = page.render({ canvasContext: context, viewport, canvas });
          renderTaskRef.current = task;
          await task.promise;
          if (cancelled || generation !== renderGenerationRef.current) return;
          if (pageNumber === 1 && !hasRenderedRef.current) setLoading(false);
        }

        if (cancelled || generation !== renderGenerationRef.current) return;
        renderTaskRef.current = null;
        lastRenderedWidthRef.current = renderWidth;
        hasRenderedRef.current = true;
        setLoading(false);
      } catch (err) {
        if (cancelled || generation !== renderGenerationRef.current) return;
        if (err?.name === 'RenderingCancelledException') return;
        setError(timedOut ? 'Loading this scan took too long. Reopen it to retry.'
          : /401|403/.test(err.message || '') ? 'Your session cannot open this scan. Sign in again or check your office access.'
          : 'Unable to open this scan. Reopen it to retry; a missing original may need recovery.');
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
      clearTimeout(deadline);
      if (loadingTask) Promise.resolve(loadingTask.destroy()).catch(() => {});
      observer?.disconnect();
    };
  }, [src, allPages]);

  return (
    <div ref={wrapRef} className="scanner-pdf-fit-wrap" aria-label={alt}>
      {loading && !error && (
        <div className="scanner-pdf-fit-status">Loading preview...</div>
      )}
      {error && (
        <div className="scanner-pdf-fit-status scanner-pdf-fit-status-error">{error}</div>
      )}
      <canvas ref={canvasRef} className="scanner-pdf-canvas" />
      {allPages && <div ref={extraPagesRef} className="scanner-pdf-extra-pages" />}
    </div>
  );
}
