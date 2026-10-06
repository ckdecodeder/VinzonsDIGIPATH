import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const LETTER_WIDTH_IN = 8.5;
const LETTER_HEIGHT_IN = 11;

const triggerDownload = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const getReportRoot = (root) => root || document.querySelector('.report-print-root');

const getReportPages = (root) => {
  const container = getReportRoot(root);
  if (!container) return [];
  return Array.from(container.querySelectorAll('.official-report-page:not(.report-measure-page)'));
};

const renderPageCanvas = async (pageEl) => {
  const canvas = await html2canvas(pageEl, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
  });
  return canvas;
};

const waitForReportPages = (root, timeoutMs = 5000) => new Promise((resolve, reject) => {
  const started = Date.now();
  const check = () => {
    const pages = getReportPages(root);
    if (pages.length) {
      resolve(pages);
      return;
    }
    if (Date.now() - started >= timeoutMs) {
      reject(new Error('Report preview is not ready yet. Open Preview and try again.'));
      return;
    }
    window.requestAnimationFrame(check);
  };
  check();
});

export const exportReportPagesAsPdf = async (root, filename) => {
  const pages = await waitForReportPages(root);
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'in',
    format: 'letter',
  });

  for (let index = 0; index < pages.length; index += 1) {
    const canvas = await renderPageCanvas(pages[index]);
    const imageData = canvas.toDataURL('image/jpeg', 0.92);
    if (index > 0) pdf.addPage();
    pdf.addImage(imageData, 'JPEG', 0, 0, LETTER_WIDTH_IN, LETTER_HEIGHT_IN);
  }

  pdf.save(filename);
};

export const exportReportPagesAsJpeg = async (root, filename) => {
  const pages = await waitForReportPages(root);
  const canvases = [];

  for (const page of pages) {
    canvases.push(await renderPageCanvas(page));
  }

  const width = Math.max(...canvases.map((canvas) => canvas.width));
  const height = canvases.reduce((total, canvas) => total + canvas.height, 0);
  const merged = document.createElement('canvas');
  merged.width = width;
  merged.height = height;
  const ctx = merged.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  let offsetY = 0;
  for (const canvas of canvases) {
    const x = Math.floor((width - canvas.width) / 2);
    ctx.drawImage(canvas, x, offsetY);
    offsetY += canvas.height;
  }

  const blob = await new Promise((resolve) => {
    merged.toBlob(resolve, 'image/jpeg', 0.92);
  });
  if (!blob) throw new Error('Unable to generate the JPEG report.');
  triggerDownload(blob, filename);
};

export const buildReportFilename = (label, format) => {
  const date = new Date().toISOString().split('T')[0];
  const safeLabel = String(label || 'Report').replace(/\s+/g, '-');
  const extension = format === 'jpeg' ? 'jpg' : format;
  return `DigiPath-${safeLabel}-${date}.${extension}`;
};
