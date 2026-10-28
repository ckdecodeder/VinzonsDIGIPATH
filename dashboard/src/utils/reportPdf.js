// The self-contained build avoids optional HTML-renderer dynamic chunks in the
// worker (Vite 4 cannot share those emitted assets with the main application).
import * as jsPdfModule from 'jspdf/dist/jspdf.umd.min.js';

// Node's CommonJS namespace and Vite's browser interop expose this differently.
const jsPDF = jsPdfModule.jsPDF ?? jsPdfModule.default?.jsPDF ?? jsPdfModule.default;

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 36;
const BOTTOM = 750;
const BODY_FONT = 8;
const LINE_HEIGHT = 10;
const PADDING = 4;
const text = (value) => String(value ?? '').replace(/[\u00a0\u202f]/g, ' ').replace(/[\u2010-\u2015]/g, '-');

// Runs in a worker in the browser and directly in Node for layout/content tests.
// Text stays selectable; memory does not scale with full-page bitmap screenshots.
export function buildReportPdf(model, { onProgress = () => {} } = {}) {
  const pdf = new jsPDF({ unit: 'pt', format: 'letter', compress: true, putOnlyUsedFonts: true });
  pdf.setProperties({ title: `${text(model.categoryLabel)} Report`, author: text(model.preparedBy), creator: 'Vinzons DigiPath' });
  let y = MARGIN;
  let completedRows = 0;
  const totalRows = model.table?.title ? model.table.rows.length : 0;
  const write = (value, x, at, size = BODY_FONT, bold = false, options = {}) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    pdf.setTextColor(31, 41, 55);
    pdf.text(value, x, at, { lineHeightFactor: LINE_HEIGHT / size, ...options });
  };
  const newPage = () => {
    pdf.addPage(); y = MARGIN;
    write(`${text(model.categoryLabel)} Report - Continued`, MARGIN, y + 8, 9, true);
    write(text(model.coverageText), PAGE_WIDTH - MARGIN, y + 8, 8, false, { align: 'right' });
    y += 24;
  };
  const sectionTitle = (title) => {
    if (y + 35 > BOTTOM) newPage();
    write(text(title).toUpperCase(), MARGIN, y + 10, 10, true);
    y += 20;
  };
  const drawTable = (headers, rows, columnWidths, reportRows = false) => {
    const weights = columnWidths?.length === headers.length
      ? columnWidths.map((width) => Number.parseFloat(width)) : headers.map(() => 1);
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
    const widths = weights.map((weight) => (PAGE_WIDTH - MARGIN * 2) * weight / weightTotal);
    const wrap = (row, header = false) => {
      pdf.setFont('helvetica', header ? 'bold' : 'normal'); pdf.setFontSize(header ? 7.5 : BODY_FONT);
      return headers.map((_, index) => pdf.splitTextToSize(text(row[index]) || '-', widths[index] - PADDING * 2));
    };
    const paint = (cells, height, header, rowIndex = 0) => {
      let x = MARGIN;
      for (let column = 0; column < widths.length; column += 1) {
        pdf.setDrawColor(203, 213, 225); pdf.setLineWidth(0.35);
        pdf.setFillColor(...(header ? [239, 242, 246] : rowIndex % 2 ? [249, 250, 251] : [255, 255, 255]));
        pdf.rect(x, y, widths[column], height, 'FD');
        if (cells[column].length) write(cells[column], x + PADDING, y + PADDING + BODY_FONT, header ? 7.5 : BODY_FONT, header);
        x += widths[column];
      }
      y += height;
    };
    const headerCells = wrap(headers, true);
    const headerHeight = Math.max(...headerCells.map((cell) => cell.length)) * LINE_HEIGHT + PADDING * 2;
    const heading = () => {
      if (y + headerHeight + LINE_HEIGHT + PADDING * 2 > BOTTOM) newPage();
      paint(headerCells, headerHeight, true);
    };
    heading();
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const cells = wrap(rows[rowIndex]);
      const lineCount = Math.max(1, ...cells.map((cell) => cell.length));
      const wholeHeight = lineCount * LINE_HEIGHT + PADDING * 2;
      const freshRoom = BOTTOM - (MARGIN + 24) - headerHeight;
      if (wholeHeight <= freshRoom && y + wholeHeight > BOTTOM) { newPage(); heading(); }
      let line = 0;
      // Oversized individual rows continue across pages instead of being clipped.
      while (line < lineCount) {
        let available = Math.floor((BOTTOM - y - PADDING * 2) / LINE_HEIGHT);
        if (available < 1) { newPage(); heading(); available = Math.floor((BOTTOM - y - PADDING * 2) / LINE_HEIGHT); }
        const count = Math.min(available, lineCount - line);
        paint(cells.map((cell) => cell.slice(line, line + count)), count * LINE_HEIGHT + PADDING * 2, false, rowIndex);
        line += count;
        if (line < lineCount) { newPage(); heading(); }
      }
      if (reportRows) {
        completedRows += 1;
        if (completedRows % 100 === 0 || completedRows === totalRows) onProgress({ completedRows, totalRows, pages: pdf.getNumberOfPages() });
      }
    }
    y += 14;
  };

  if (model.sealBytes) pdf.addImage(new Uint8Array(model.sealBytes), 'PNG', MARGIN + 42, y, 46, 46);
  write('Republic of the Philippines', PAGE_WIDTH / 2 + 18, y + 7, 9, false, { align: 'center' });
  write('Province of Camarines Norte', PAGE_WIDTH / 2 + 18, y + 20, 9, false, { align: 'center' });
  write('MUNICIPALITY OF VINZONS', PAGE_WIDTH / 2 + 18, y + 35, 13, true, { align: 'center' });
  write('DigiPath Document Tracking System', PAGE_WIDTH / 2 + 18, y + 49, 9, true, { align: 'center' });
  y += 65;
  pdf.setDrawColor(31, 41, 55); pdf.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  write(`${text(model.categoryLabel)} REPORT`.toUpperCase(), PAGE_WIDTH / 2, y + 23, 12, true, { align: 'center' });
  y += 39;
  drawTable(['Prepared by', 'Coverage', 'Generated', 'Record count'], [[model.preparedBy, model.coverageText, model.generatedAt, model.recordCount]], [25, 25, 32, 18]);
  sectionTitle('Summary');
  drawTable(['Section', 'Metric', 'Value', 'Notes'], model.summaryRows || [], [18, 30, 12, 40]);
  if (model.table?.title) {
    sectionTitle(model.table.title);
    drawTable(model.table.headers, model.table.rows.length ? model.table.rows : [model.table.headers.map((_, index) => index ? '' : 'No records found for the selected coverage.')], model.table.columnWidths, model.table.rows.length > 0);
  }
  if (y + 55 > BOTTOM) newPage();
  write('Prepared by', MARGIN, y + 15, 8);
  write('Verified / Noted by', PAGE_WIDTH / 2 + 25, y + 15, 8);
  write(text(model.preparedBy), MARGIN, y + 33, 9, true);
  write('____________________________', PAGE_WIDTH / 2 + 25, y + 33, 9);
  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    write(`Page ${page} of ${pageCount}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 20, 8, false, { align: 'right' });
  }
  onProgress({ completedRows: totalRows, totalRows, pages: pageCount, finalizing: true });
  return { buffer: pdf.output('arraybuffer'), pageCount, rowCount: totalRows };
}
