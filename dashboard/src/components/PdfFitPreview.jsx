import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export default function PdfFitPreview({ src, alt = 'Scanned document PDF' }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!src) return undefined;

    let cancelled = false;
    let renderTask = null;

    const render = async () => {
      setLoading(true);
      setError('');

      try {
        const doc = await pdfjs.getDocument(src).promise;
        if (cancelled) return;

        const page = await doc.getPage(1);
        if (cancelled) return;

        const containerWidth = Math.max(wrapRef.current?.clientWidth || 640, 280);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = containerWidth / baseViewport.width;
        const viewport = page.getViewport({ scale });

        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        renderTask = page.render({ canvasContext: context, viewport });
        await renderTask.promise;

        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Could not render PDF preview.');
          setLoading(false);
        }
      }
    };

    render();

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          if (!cancelled) render();
        })
      : null;

    if (observer && wrapRef.current) {
      observer.observe(wrapRef.current);
    }

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel?.();
      } catch {
        // Ignore render cancellation errors.
      }
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
