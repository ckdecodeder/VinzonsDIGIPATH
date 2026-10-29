export const escapePrintText = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
export const imagePrintMarkup = (name, source) => {
  if (!/^(blob:|data:image\/(jpeg|png|webp);base64,)/i.test(source)) throw new Error('Invalid print image source.');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapePrintText(name || 'Scanned document')}</title><style>@page{margin:.4in}body{margin:0;display:grid;place-items:center}img{max-width:100%;max-height:100vh;object-fit:contain}</style></head><body><img src="${escapePrintText(source)}" alt="Scanned document"></body></html>`;
};
