import * as pdfjs from 'pdfjs-dist';
import { isPdfMedia, resolveUploadUrl } from './mediaUrl';
import { readMediaBlob, mediaRequest } from './protectedMedia';
import { imagePrintMarkup } from './printMarkup';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export const getAttachmentSource = (file) => resolveUploadUrl(file?.url || file?.dataUrl || '') || '';

const pathOnly = (source = '') => String(source).split('?')[0].split('#')[0];

export const isImageAttachment = (file) => {
  const source = getAttachmentSource(file);
  const path = pathOnly(source);
  return (
    file?.type?.startsWith('image/')
    || source.startsWith('data:image/')
    || /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(path)
    || /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(file?.name || '')
  );
};

export const isPdfAttachment = (file) => isPdfMedia(getAttachmentSource(file), file?.type || file?.name || '');

export const isConvertibleAttachment = (file) => isImageAttachment(file) || isPdfAttachment(file);

const getDownloadName = (file, extension) => {
  const base = (file?.name || 'scanned-document').replace(/\.[^.]+$/, '');
  return `${base}.${extension}`;
};

const triggerDownload = (url, filename) => {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
};

const loadImageElement = async (source) => {
  const objectUrl = URL.createObjectURL(await readMediaBlob(source));
  try { return await new Promise((resolve, reject) => {
  const img = new window.Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Unable to load the scanned file for conversion.'));
  img.src = objectUrl;
  }); } finally { URL.revokeObjectURL(objectUrl); }
};

const canvasToBlob = (canvas, mime, quality = 0.92) => new Promise((resolve) => {
  canvas.toBlob(resolve, mime, quality);
});

const imageToCanvas = (image) => {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  return canvas;
};

const canvasToDataUrl = (canvas, mime = 'image/jpeg', quality = 0.92) => canvas.toDataURL(mime, quality);

const rotateCanvas = (canvas, degrees) => {
  const normalized = ((degrees % 360) + 360) % 360;
  if (!normalized) return canvas;

  const radians = (normalized * Math.PI) / 180;
  const sideways = normalized === 90 || normalized === 270;
  const rotated = document.createElement('canvas');
  rotated.width = sideways ? canvas.height : canvas.width;
  rotated.height = sideways ? canvas.width : canvas.height;
  const ctx = rotated.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, rotated.width, rotated.height);
  ctx.translate(rotated.width / 2, rotated.height / 2);
  ctx.rotate(radians);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return rotated;
};

/** Rotate a scanned image attachment by the given degrees and return a new attachment payload. */
export const rotateImageAttachment = async (file, degrees = 90) => {
  const normalized = ((degrees % 360) + 360) % 360;
  if (!normalized) return file;
  if (!isImageAttachment(file)) {
    throw new Error('Only image scans can be rotated.');
  }

  const source = getAttachmentSource(file);
  if (!source) throw new Error('No scanned file is available to rotate.');

  const image = await loadImageElement(source);
  const canvas = rotateCanvas(imageToCanvas(image), normalized);
  const mime = file?.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const dataUrl = canvasToDataUrl(canvas, mime, 0.92);

  return {
    ...file,
    type: mime,
    dataUrl,
    url: undefined,
    storagePath: undefined,
    size: undefined,
  };
};

const pdfFirstPageToCanvas = async (source) => {
  const request = mediaRequest(source);
  const doc = await pdfjs.getDocument({ url: request.url, httpHeaders: request.headers }).promise;
  try {
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  return canvas;
  } finally { await doc.destroy(); }
};

const attachmentToCanvas = async (file) => {
  const source = getAttachmentSource(file);
  if (!source) throw new Error('No scanned file is available to convert.');

  if (isPdfAttachment(file)) {
    return pdfFirstPageToCanvas(source);
  }
  if (isImageAttachment(file)) {
    const image = await loadImageElement(source);
    return imageToCanvas(image);
  }
  throw new Error('This file type cannot be converted.');
};

export const printImageAsPdf = async (file) => {
  const source = getAttachmentSource(file);
  const popup = window.open('', '_blank', 'width=900,height=1100');
  if (!popup) {
    throw new Error('Allow popups to save the scanned file as PDF.');
  }
  let objectUrl;
  try {
    objectUrl = URL.createObjectURL(await readMediaBlob(source));
    popup.document.write(imagePrintMarkup(file?.name, objectUrl));
    popup.document.close();
    const image = popup.document.querySelector('img');
    await image.decode();
    popup.focus(); popup.print();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  } catch (error) { if (objectUrl) URL.revokeObjectURL(objectUrl); popup.close(); throw error; }
};

const downloadRaster = async (file, format) => {
  const canvas = await attachmentToCanvas(file);
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const blob = await canvasToBlob(canvas, mime, 0.92);
  if (!blob) throw new Error('Unable to convert the scanned file.');
  const url = URL.createObjectURL(blob);
  triggerDownload(url, getDownloadName(file, format === 'jpeg' ? 'jpg' : 'png'));
  URL.revokeObjectURL(url);
};

const printCanvasAsPdf = (canvas, file) => {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const popup = window.open('', '_blank', 'width=900,height=1100');
  if (!popup) {
    throw new Error('Allow popups to save the scanned file as PDF.');
  }
  popup.document.write(imagePrintMarkup(file?.name, dataUrl));
  popup.document.close();
  popup.focus();
  popup.print();
};

/** Download a scanned attachment in original, pdf, jpeg, or png format. */
export const downloadAttachment = async (file, format = 'original') => {
  const source = getAttachmentSource(file);
  if (!source) return;

  if (format === 'original') {
    const objectUrl = URL.createObjectURL(await readMediaBlob(source));
    triggerDownload(objectUrl, file?.name || 'scanned-document');
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    return;
  }

  if (format === 'pdf') {
    if (isPdfAttachment(file)) {
      await downloadAttachment(file, 'original');
      return;
    }
    if (isImageAttachment(file)) {
      await printImageAsPdf(file);
      return;
    }
    const canvas = await attachmentToCanvas(file);
    printCanvasAsPdf(canvas, file);
    return;
  }

  if (format === 'jpeg' || format === 'png') {
    if (!isConvertibleAttachment(file)) {
      throw new Error('This scanned file cannot be converted to an image.');
    }
    await downloadRaster(file, format);
    return;
  }

  throw new Error('Unsupported download format.');
};
