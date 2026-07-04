const fs = require('fs');
const AdmZip = require('adm-zip');

const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const REPORT_WIDTH = 10368;

const xml = (value = '') => String(value ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const textValue = (value, fallback = '') => {
  const normalized = value === undefined || value === null ? '' : String(value);
  return normalized.trim() || fallback;
};

const runProperties = ({ bold = false, size = 18, color = '000000' } = {}) => [
  '<w:rPr>',
  bold ? '<w:b/>' : '',
  `<w:color w:val="${color}"/>`,
  `<w:sz w:val="${size}"/>`,
  `<w:szCs w:val="${size}"/>`,
  '</w:rPr>',
].join('');

const textRun = (text, options = {}) => {
  const lines = textValue(text).split(/\r?\n/);
  const body = lines.map((line, index) => [
    index ? '<w:br/>' : '',
    `<w:t xml:space="preserve">${xml(line)}</w:t>`,
  ].join('')).join('');

  return `<w:r>${runProperties(options)}${body}</w:r>`;
};

const paragraph = (text, {
  align = 'left',
  bold = false,
  size = 18,
  color = '000000',
  before = 0,
  after = 0,
} = {}) => [
  '<w:p>',
  '<w:pPr>',
  `<w:jc w:val="${align}"/>`,
  `<w:spacing w:before="${before}" w:after="${after}" w:line="240" w:lineRule="auto"/>`,
  '</w:pPr>',
  textRun(text, { bold, size, color }),
  '</w:p>',
].join('');

const sectionHeading = (text) => paragraph(text, {
  align: 'left',
  bold: true,
  size: 22,
  color: '1F3A8A',
  before: 220,
  after: 80,
});

const emptyParagraph = (height = 120) => paragraph('', { before: height, after: 0 });

const normalizeCell = (cell) => {
  if (cell && typeof cell === 'object' && !Array.isArray(cell)) return cell;
  return { text: cell };
};

const tableCell = (cell, defaults = {}) => {
  const spec = { ...defaults, ...normalizeCell(cell) };
  const fill = spec.fill || defaults.fill || '';
  const color = spec.color || defaults.color || '000000';
  const size = spec.size || defaults.size || 18;
  const align = spec.align || defaults.align || 'left';
  const bold = Boolean(spec.bold ?? defaults.bold);
  const vertical = spec.vertical || 'center';
  const colSpan = Number(spec.colSpan || 1);
  const width = spec.width || defaults.width || 1728;
  const paragraphs = Array.isArray(spec.paragraphs)
    ? spec.paragraphs
    : [paragraph(spec.text ?? '', { align, bold, size, color })];

  return [
    '<w:tc>',
    '<w:tcPr>',
    `<w:tcW w:type="dxa" w:w="${width}"/>`,
    colSpan > 1 ? `<w:gridSpan w:val="${colSpan}"/>` : '',
    `<w:vAlign w:val="${vertical}"/>`,
    fill ? `<w:shd w:fill="${fill}"/>` : '',
    '<w:tcMar>',
    '<w:top w:w="90" w:type="dxa"/>',
    '<w:left w:w="90" w:type="dxa"/>',
    '<w:bottom w:w="90" w:type="dxa"/>',
    '<w:right w:w="90" w:type="dxa"/>',
    '</w:tcMar>',
    '</w:tcPr>',
    paragraphs.join(''),
    '</w:tc>',
  ].join('');
};

const tableRow = (cells, widths, { header = false, fill = '', bold = false, size = 18, color = '000000' } = {}) => {
  let widthIndex = 0;
  const renderedCells = cells.map((cell) => {
    const spec = normalizeCell(cell);
    const colSpan = Number(spec.colSpan || 1);
    const width = widths.slice(widthIndex, widthIndex + colSpan).reduce((sum, item) => sum + item, 0) || widths[widthIndex] || 1728;
    widthIndex += colSpan;
    return tableCell(spec, { fill, bold, size, color, width });
  });

  return [
    '<w:tr>',
    header ? '<w:trPr><w:tblHeader/></w:trPr>' : '',
    renderedCells.join(''),
    '</w:tr>',
  ].join('');
};

const table = (rows, widths, { headerRows = 1 } = {}) => [
  '<w:tbl>',
  '<w:tblPr>',
  `<w:tblW w:type="dxa" w:w="${widths.reduce((sum, item) => sum + item, 0)}"/>`,
  '<w:jc w:val="center"/>',
  '<w:tblLayout w:type="fixed"/>',
  '<w:tblBorders>',
  '<w:top w:val="single" w:sz="8" w:space="0" w:color="000000"/>',
  '<w:left w:val="single" w:sz="8" w:space="0" w:color="000000"/>',
  '<w:bottom w:val="single" w:sz="8" w:space="0" w:color="000000"/>',
  '<w:right w:val="single" w:sz="8" w:space="0" w:color="000000"/>',
  '<w:insideH w:val="single" w:sz="8" w:space="0" w:color="000000"/>',
  '<w:insideV w:val="single" w:sz="8" w:space="0" w:color="000000"/>',
  '</w:tblBorders>',
  '<w:tblCellMar>',
  '<w:top w:w="90" w:type="dxa"/>',
  '<w:left w:w="90" w:type="dxa"/>',
  '<w:bottom w:w="90" w:type="dxa"/>',
  '<w:right w:w="90" w:type="dxa"/>',
  '</w:tblCellMar>',
  '<w:tblLook w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1" w:val="04A0"/>',
  '</w:tblPr>',
  '<w:tblGrid>',
  widths.map(width => `<w:gridCol w:w="${width}"/>`).join(''),
  '</w:tblGrid>',
  rows.map((row, index) => tableRow(row, widths, {
    header: index < headerRows,
    fill: index < headerRows ? 'E7EEF8' : '',
    bold: index < headerRows,
    color: index < headerRows ? '1F2937' : '000000',
    size: index < headerRows ? 17 : 16,
  })).join(''),
  '</w:tbl>',
].join('');

const keepTogetherParagraph = (text) => [
  '<w:p>',
  '<w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/></w:pPr>',
  textRun(text, { bold: true, size: 18, color: '1F2937' }),
  '</w:p>',
].join('');

const buildMetadataRows = (report) => [
  [
    { text: 'Report Type', fill: 'F3F4F6', bold: true },
    report.title,
    { text: 'Category', fill: 'F3F4F6', bold: true },
    report.categoryLabel,
  ],
  [
    { text: 'Prepared By', fill: 'F3F4F6', bold: true },
    report.preparedBy,
    { text: 'User Level', fill: 'F3F4F6', bold: true },
    report.role,
  ],
  [
    { text: 'Office', fill: 'F3F4F6', bold: true },
    report.office,
    { text: 'Coverage', fill: 'F3F4F6', bold: true },
    report.coverage,
  ],
  [
    { text: 'Generated At', fill: 'F3F4F6', bold: true },
    report.generatedAt,
    { text: 'Records Included', fill: 'F3F4F6', bold: true },
    String(report.recordCount),
  ],
];

const buildSignoffRows = (report) => [
  [
    { text: 'Prepared By', fill: 'F3F4F6', bold: true, align: 'center' },
    { text: 'Reviewed / Noted By', fill: 'F3F4F6', bold: true, align: 'center' },
    { text: 'Date', fill: 'F3F4F6', bold: true, align: 'center' },
  ],
  [
    { text: '\n\n', align: 'center' },
    { text: '\n\n', align: 'center' },
    { text: '\n\n', align: 'center' },
  ],
  [
    { text: report.preparedBy, align: 'center', bold: true },
    { text: report.reviewedBy || '', align: 'center' },
    { text: report.generatedDate, align: 'center' },
  ],
];

const noRows = (columnCount) => [[{
  text: 'No records matched the selected report filters.',
  colSpan: columnCount,
  align: 'center',
  color: '6B7280',
}]];

const removeDocumentHeaders = (sectionProperties) => {
  if (!sectionProperties) return sectionProperties;
  return sectionProperties
    .replace(/<w:headerReference\b[^>]*\/>/g, '')
    .replace(/<w:titlePg\/>/g, '');
};

const officialTemplateHeaderGrid = () => table([
  [
    { text: '' },
    {
      colSpan: 2,
      align: 'center',
      paragraphs: [
        paragraph('Republic of the Philippines', { align: 'center', size: 18 }),
        paragraph('Province of Camarines Norte', { align: 'center', size: 18 }),
        paragraph('MUNICIPALITY OF\nVINZONS', { align: 'center', bold: true, size: 24, color: '1F3A8A' }),
      ],
    },
    { text: '' },
  ],
  [
    { text: '' },
    { text: 'OFFICIAL REPORT TEMPLATE', colSpan: 2, align: 'center', bold: true, size: 24 },
    { text: '' },
  ],
  [{ text: '\n' }, { text: '\n' }, { text: '\n' }, { text: '\n' }],
  [{ text: '\n' }, { text: '\n' }, { text: '\n' }, { text: '\n' }],
  [{ text: '\n' }, { text: '\n' }, { text: '\n' }, { text: '\n' }],
], [2592, 2592, 2592, 2592], { headerRows: 0 });

const limitCellText = (value, max = 220) => {
  const text = textValue(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
};

const buildOfficialReportDocx = ({
  templatePath,
  title,
  categoryLabel,
  preparedBy,
  role,
  office,
  coverage,
  generatedAt,
  generatedDate,
  recordCount,
  reviewedBy = '',
  summaryRows = [],
  tableTitle,
  headers = [],
  rows = [],
}) => {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Report template not found at ${templatePath}`);
  }

  const zip = new AdmZip(templatePath);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) {
    throw new Error('Report template is missing word/document.xml');
  }

  const originalDocument = entry.getData().toString('utf8');
  const bodyOpen = '<w:body>';
  const bodyStart = originalDocument.indexOf(bodyOpen);
  const bodyEnd = originalDocument.lastIndexOf('</w:body>');
  if (bodyStart < 0 || bodyEnd < 0) {
    throw new Error('Report template has an unsupported Word document structure');
  }

  const originalBody = originalDocument.slice(bodyStart + bodyOpen.length, bodyEnd);
  const sectionMatch = originalBody.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
  const sectionProperties = removeDocumentHeaders(sectionMatch ? sectionMatch[0] : '');
  const metadataWidths = [2592, 2592, 2592, 2592];
  const summaryWidths = [2592, 2592, 2592, 2592];
  const detailWidths = [1728, 1728, 1728, 1728, 1728, 1728];
  const signoffWidths = [3456, 3456, 3456];
  const hasDetailTable = headers.length > 0;
  const detailRows = hasDetailTable && rows.length
    ? [headers.map(header => ({ text: header, align: 'center' })), ...rows.map(row => row.map(cell => limitCellText(cell)))]
    : [headers.map(header => ({ text: header, align: 'center' })), ...noRows(headers.length || 6)];
  const normalizedSummaryRows = summaryRows.length
    ? [['Section', 'Metric', 'Value', 'Notes'], ...summaryRows]
    : [['Section', 'Metric', 'Value', 'Notes'], ...noRows(4)];

  const report = {
    title,
    categoryLabel,
    preparedBy,
    role,
    office,
    coverage,
    generatedAt,
    generatedDate,
    reviewedBy,
    recordCount: recordCount ?? rows.length,
  };

  const bodyContent = [
    officialTemplateHeaderGrid(),
    emptyParagraph(160),
    table(buildMetadataRows(report), metadataWidths, { headerRows: 0 }),
    sectionHeading('Report Overview'),
    table(normalizedSummaryRows, summaryWidths, { headerRows: 1 }),
    hasDetailTable ? sectionHeading(tableTitle || `${categoryLabel} Details`) : '',
    hasDetailTable ? table(detailRows, detailWidths, { headerRows: 1 }) : '',
    keepTogetherParagraph('Certification'),
    table(buildSignoffRows(report), signoffWidths, { headerRows: 1 }),
    sectionProperties,
  ].join('');

  const nextDocument = [
    originalDocument.slice(0, bodyStart + bodyOpen.length),
    bodyContent,
    originalDocument.slice(bodyEnd),
  ].join('');

  zip.updateFile('word/document.xml', Buffer.from(nextDocument, 'utf8'));
  return zip.toBuffer();
};

module.exports = {
  WORD_MIME,
  buildOfficialReportDocx,
};
