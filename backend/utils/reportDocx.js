const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const REPORT_WIDTH = 10368;
const SEAL_IMAGE_NAME = 'seal_of_vinzons.png';
const SEAL_CANDIDATE_PATHS = [
  process.env.REPORT_SEAL_PATH,
  path.join(__dirname, '..', 'assets', 'Seal_of_Vinzons.png'),
  path.join(__dirname, '..', '..', 'dashboard', 'public', 'Seal_of_Vinzons.png'),
  path.join(__dirname, '..', '..', 'Seal_of_Vinzons.png'),
].filter(Boolean);

const scaleWidths = (ratios) => {
  const total = ratios.reduce((sum, value) => sum + value, 0);
  const widths = ratios.map((ratio) => Math.floor((REPORT_WIDTH * ratio) / total));
  const used = widths.reduce((sum, value) => sum + value, 0);
  widths[widths.length - 1] += REPORT_WIDTH - used;
  return widths;
};

const summaryColumnWidths = () => scaleWidths([18, 30, 12, 40]);

const detailColumnWidths = (category, columnCount) => {
  const presets = {
    documents: [13, 30, 12, 14, 11, 20],
    transmissions: [9, 27, 14, 14, 16, 20],
    offices: [18, 14, 14, 10, 10, 34],
    activity: [16, 14, 10, 12, 12, 36],
  };
  const ratios = presets[category];
  if (ratios && ratios.length === columnCount) return scaleWidths(ratios);
  return scaleWidths(Array.from({ length: columnCount }, () => 1));
};

const resolveSealPath = () => {
  for (const candidate of SEAL_CANDIDATE_PATHS) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

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

const runProperties = ({ bold = false, size = 18, color = '000000', caps = false } = {}) => [
  '<w:rPr>',
  bold ? '<w:b/>' : '',
  caps ? '<w:caps/>' : '',
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
  caps = false,
  before = 0,
  after = 0,
} = {}) => [
  '<w:p>',
  '<w:pPr>',
  `<w:jc w:val="${align}"/>`,
  `<w:spacing w:before="${before}" w:after="${after}" w:line="240" w:lineRule="auto"/>`,
  '</w:pPr>',
  textRun(text, { bold, size, color, caps }),
  '</w:p>',
].join('');

const emptyParagraph = (height = 120) => paragraph('', { before: height, after: 0 });

const sectionTitle = (text) => [
  '<w:p>',
  '<w:pPr>',
  '<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="E5E7EB"/></w:pBdr>',
  '<w:spacing w:before="200" w:after="80"/>',
  '</w:pPr>',
  textRun(String(text || '').toUpperCase(), { bold: true, size: 16, color: '374151' }),
  '</w:p>',
].join('');

const headerDivider = () => [
  '<w:p>',
  '<w:pPr>',
  '<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="4" w:color="1F2937"/></w:pBdr>',
  '<w:spacing w:before="80" w:after="160"/>',
  '</w:pPr>',
  '</w:p>',
].join('');

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
  const caps = Boolean(spec.caps ?? defaults.caps);
  const vertical = spec.vertical || 'center';
  const colSpan = Number(spec.colSpan || 1);
  const width = spec.width || defaults.width || 1728;
  const paragraphs = Array.isArray(spec.paragraphs)
    ? spec.paragraphs
    : [paragraph(spec.text ?? '', { align, bold, size, color, caps })];

  return [
    '<w:tc>',
    '<w:tcPr>',
    `<w:tcW w:type="dxa" w:w="${width}"/>`,
    colSpan > 1 ? `<w:gridSpan w:val="${colSpan}"/>` : '',
    `<w:vAlign w:val="${vertical}"/>`,
    fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : '',
    '<w:tcMar>',
    '<w:top w:w="70" w:type="dxa"/>',
    '<w:left w:w="80" w:type="dxa"/>',
    '<w:bottom w:w="70" w:type="dxa"/>',
    '<w:right w:w="80" w:type="dxa"/>',
    '</w:tcMar>',
    '</w:tcPr>',
    paragraphs.join(''),
    '</w:tc>',
  ].join('');
};

const tableRow = (cells, widths, {
  header = false,
  fill = '',
  bold = false,
  size = 18,
  color = '000000',
} = {}) => {
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

const borderSpec = (bordered, color, size) => {
  if (!bordered) {
    return [
      '<w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>',
      '<w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>',
      '<w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>',
      '<w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>',
      '<w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>',
      '<w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>',
    ].join('');
  }

  const edge = (val) => `<w:${val} w:val="single" w:sz="${size}" w:space="0" w:color="${color}"/>`;
  return [
    edge('top'),
    edge('left'),
    edge('bottom'),
    edge('right'),
    edge('insideH'),
    edge('insideV'),
  ].join('');
};

const table = (rows, widths, {
  headerRows = 1,
  bordered = true,
  borderColor = 'D1D5DB',
  borderSize = 4,
  headerFill = 'F3F4F6',
} = {}) => [
  '<w:tbl>',
  '<w:tblPr>',
  `<w:tblW w:type="dxa" w:w="${widths.reduce((sum, item) => sum + item, 0)}"/>`,
  '<w:jc w:val="center"/>',
  '<w:tblLayout w:type="fixed"/>',
  '<w:tblBorders>',
  borderSpec(bordered, borderColor, borderSize),
  '</w:tblBorders>',
  '<w:tblCellMar>',
  '<w:top w:w="0" w:type="dxa"/>',
  '<w:left w:w="0" w:type="dxa"/>',
  '<w:bottom w:w="0" w:type="dxa"/>',
  '<w:right w:w="0" w:type="dxa"/>',
  '</w:tblCellMar>',
  '<w:tblLook w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1" w:val="04A0"/>',
  '</w:tblPr>',
  '<w:tblGrid>',
  widths.map(width => `<w:gridCol w:w="${width}"/>`).join(''),
  '</w:tblGrid>',
  rows.map((row, index) => tableRow(row, widths, {
    header: index < headerRows,
    fill: index < headerRows ? headerFill : '',
    bold: index < headerRows,
    color: index < headerRows ? '4B5563' : '111827',
    size: index < headerRows ? 13 : 14,
  })).join(''),
  '</w:tbl>',
].join('');

const metaLabelParagraph = (text) => paragraph(text, {
  bold: true,
  size: 12,
  color: '6B7280',
  caps: true,
  after: 20,
});

const metaValueParagraph = (text, { bold = false } = {}) => paragraph(text, {
  bold,
  size: 14,
  color: '111827',
  after: 0,
});

const buildMetadataRow = (report) => [[
  {
    fill: 'FAFAFA',
    paragraphs: [
      metaLabelParagraph('Prepared By'),
      metaValueParagraph(report.preparedBy),
    ],
  },
  {
    fill: 'FAFAFA',
    paragraphs: [
      metaLabelParagraph('Coverage'),
      metaValueParagraph(report.coverage),
    ],
  },
  {
    fill: 'FAFAFA',
    paragraphs: [
      metaLabelParagraph('Generated'),
      metaValueParagraph(report.generatedAt),
    ],
  },
  {
    fill: 'FAFAFA',
    paragraphs: [
      metaLabelParagraph('Record Count'),
      metaValueParagraph(String(report.recordCount), { bold: true }),
    ],
  },
]];

const signoffNameParagraph = (text) => [
  '<w:p>',
  '<w:pPr>',
  '<w:jc w:val="center"/>',
  '<w:pBdr><w:top w:val="single" w:sz="6" w:space="4" w:color="1F2937"/></w:pBdr>',
  '<w:spacing w:before="480" w:after="0"/>',
  '</w:pPr>',
  textRun(text || '____________________________', { bold: Boolean(text), size: 14, color: text ? '111827' : '9CA3AF' }),
  '</w:p>',
].join('');

const buildSignoffBlock = (report) => {
  const half = Math.floor(REPORT_WIDTH / 2);
  const widths = [half, REPORT_WIDTH - half];
  return table([
    [
      {
        paragraphs: [paragraph('Prepared by', { size: 12, color: '6B7280', caps: true })],
      },
      {
        paragraphs: [paragraph('Verified / Noted by', { size: 12, color: '6B7280', caps: true })],
      },
    ],
    [
      {
        paragraphs: [signoffNameParagraph(report.preparedBy)],
      },
      {
        paragraphs: [signoffNameParagraph(report.reviewedBy || '')],
      },
    ],
  ], widths, { headerRows: 0, bordered: false });
};

const noRows = (columnCount) => [[{
  text: 'No records matched the selected report filters.',
  colSpan: columnCount,
  align: 'center',
  color: '6B7280',
}]];

const getNextRelId = (relsXml) => {
  const ids = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1]));
  return `rId${Math.max(0, ...ids) + 1}`;
};

const ensurePngContentType = (contentTypesXml) => {
  if (contentTypesXml.includes('Extension="png"')) return contentTypesXml;
  return contentTypesXml.replace(
    '</Types>',
    '<Default Extension="png" ContentType="image/png"/></Types>',
  );
};

const addImageToZip = (zip, imagePath) => {
  const mediaPath = `word/media/${SEAL_IMAGE_NAME}`;
  zip.addFile(mediaPath, fs.readFileSync(imagePath));

  const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
  if (!relsEntry) {
    throw new Error('Report template is missing word/_rels/document.xml.rels');
  }

  let relsXml = relsEntry.getData().toString('utf8');
  const relId = getNextRelId(relsXml);
  const relationship = `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${SEAL_IMAGE_NAME}"/>`;
  relsXml = relsXml.replace('</Relationships>', `${relationship}</Relationships>`);
  zip.updateFile('word/_rels/document.xml.rels', Buffer.from(relsXml, 'utf8'));

  const contentTypesEntry = zip.getEntry('[Content_Types].xml');
  if (contentTypesEntry) {
    let contentTypesXml = contentTypesEntry.getData().toString('utf8');
    contentTypesXml = ensurePngContentType(contentTypesXml);
    zip.updateFile('[Content_Types].xml', Buffer.from(contentTypesXml, 'utf8'));
  }

  return relId;
};

const imageParagraph = (relId, cx = 647700, cy = 647700) => [
  '<w:p>',
  '<w:pPr><w:jc w:val="center"/></w:pPr>',
  '<w:r>',
  '<w:drawing>',
  '<wp:inline distT="0" distB="0" distL="0" distR="0">',
  `<wp:extent cx="${cx}" cy="${cy}"/>`,
  '<wp:effectExtent l="0" t="0" r="0" b="0"/>',
  '<wp:docPr id="1" name="Seal of Vinzons"/>',
  '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>',
  '<a:graphic>',
  '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">',
  '<pic:pic>',
  '<pic:nvPicPr><pic:cNvPr id="0" name="Seal"/><pic:cNvPicPr/></pic:nvPicPr>',
  '<pic:blipFill>',
  `<a:blip r:embed="${relId}"/>`,
  '<a:stretch><a:fillRect/></a:stretch>',
  '</pic:blipFill>',
  '<pic:spPr>',
  '<a:xfrm><a:off x="0" y="0"/>',
  `<a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`,
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
  '</pic:spPr>',
  '</pic:pic>',
  '</a:graphicData>',
  '</a:graphic>',
  '</wp:inline>',
  '</w:drawing>',
  '</w:r>',
  '</w:p>',
].join('');

const officialReportHeader = (imageRelId) => {
  const logoWidth = 1700;
  const textWidth = REPORT_WIDTH - logoWidth;
  const logoCell = imageRelId
    ? { paragraphs: [imageParagraph(imageRelId)], vertical: 'center', width: logoWidth }
    : { text: '', vertical: 'center', width: logoWidth };
  const textCell = {
    width: textWidth,
    vertical: 'center',
    paragraphs: [
      paragraph('Republic of the Philippines', { align: 'center', size: 15, color: '374151' }),
      paragraph('Province of Camarines Norte', { align: 'center', size: 15, color: '374151' }),
      paragraph('Municipality of Vinzons', { align: 'center', bold: true, size: 22, color: '111827', caps: true }),
      paragraph('DigiPath Document Tracking System', { align: 'center', size: 14, color: '4B5563' }),
    ],
  };

  return [
    table([[logoCell, textCell]], [logoWidth, textWidth], { headerRows: 0, bordered: false }),
    headerDivider(),
  ].join('');
};

const removeDocumentHeaders = (sectionProperties) => {
  if (!sectionProperties) return sectionProperties;
  return sectionProperties
    .replace(/<w:headerReference\b[^>]*\/>/g, '')
    .replace(/<w:titlePg\/>/g, '');
};

const limitCellText = (value, max = 220) => {
  const text = textValue(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
};

const buildOfficialReportDocx = ({
  templatePath,
  category = 'summary',
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

  const sealPath = resolveSealPath();
  const imageRelId = sealPath ? addImageToZip(zip, sealPath) : null;

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
  const metadataWidths = summaryColumnWidths();
  const summaryWidths = summaryColumnWidths();
  const hasDetailTable = headers.length > 0;
  const detailWidths = hasDetailTable ? detailColumnWidths(category, headers.length) : [];
  const detailRows = hasDetailTable && rows.length
    ? [headers.map(header => ({ text: header, align: 'left' })), ...rows.map(row => row.map(cell => limitCellText(cell, 320)))]
    : hasDetailTable
      ? [headers.map(header => ({ text: header, align: 'left' })), ...noRows(headers.length || 6)]
      : [];
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
    officialReportHeader(imageRelId),
    paragraph(`${categoryLabel} Report`.toUpperCase(), {
      align: 'center',
      bold: true,
      size: 20,
      color: '111827',
      after: 30,
    }),
    paragraph('Official generated report from DigiPath records', {
      align: 'center',
      size: 14,
      color: '6B7280',
      after: 140,
    }),
    table(buildMetadataRow(report), metadataWidths, { headerRows: 0, bordered: true }),
    emptyParagraph(80),
    sectionTitle('Summary'),
    table(normalizedSummaryRows, summaryWidths, { headerRows: 1, bordered: true }),
    hasDetailTable ? sectionTitle(tableTitle || `${categoryLabel} Details`) : '',
    hasDetailTable ? table(detailRows, detailWidths, { headerRows: 1, bordered: true }) : '',
    emptyParagraph(120),
    buildSignoffBlock(report),
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
