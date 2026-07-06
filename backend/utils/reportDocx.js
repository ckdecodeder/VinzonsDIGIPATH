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

const metadataColumnWidths = () => scaleWidths([1, 1, 1, 1]);

const computeReportTypography = (summaryRowCount = 0, detailRowCount = 0) => {
  const totalRows = summaryRowCount + detailRowCount;
  if (totalRows <= 12) {
    return {
      headerLine: 22,
      headerTitle: 32,
      headerSub: 22,
      reportTitle: 32,
      reportSubtitle: 22,
      metaLabel: 16,
      metaValue: 18,
      metaPadX: 160,
      metaPadY: 200,
      sectionTitle: 22,
      tableHeader: 20,
      tableBody: 20,
      signoffLabel: 18,
      signoffName: 22,
      cellPadding: 100,
    };
  }
  if (totalRows <= 24) {
    return {
      headerLine: 20,
      headerTitle: 28,
      headerSub: 20,
      reportTitle: 28,
      reportSubtitle: 20,
      metaLabel: 16,
      metaValue: 18,
      metaPadX: 150,
      metaPadY: 180,
      sectionTitle: 20,
      tableHeader: 18,
      tableBody: 18,
      signoffLabel: 18,
      signoffName: 20,
      cellPadding: 85,
    };
  }
  if (totalRows <= 40) {
    return {
      headerLine: 18,
      headerTitle: 26,
      headerSub: 18,
      reportTitle: 26,
      reportSubtitle: 18,
      metaLabel: 14,
      metaValue: 16,
      metaPadX: 140,
      metaPadY: 160,
      sectionTitle: 18,
      tableHeader: 16,
      tableBody: 16,
      signoffLabel: 16,
      signoffName: 18,
      cellPadding: 70,
    };
  }
  return {
    headerLine: 18,
    headerTitle: 24,
    headerSub: 18,
    reportTitle: 24,
    reportSubtitle: 18,
    metaLabel: 14,
    metaValue: 16,
    metaPadX: 130,
    metaPadY: 150,
    sectionTitle: 16,
    tableHeader: 14,
    tableBody: 14,
    signoffLabel: 14,
    signoffName: 16,
    cellPadding: 60,
  };
};

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

const sectionTitle = (text, typography) => [
  '<w:p>',
  '<w:pPr>',
  '<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="E5E7EB"/></w:pBdr>',
  '<w:spacing w:before="200" w:after="80"/>',
  '</w:pPr>',
  textRun(String(text || '').toUpperCase(), { bold: true, size: typography.sectionTitle, color: '374151' }),
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
  const size = spec.size || defaults.size || 20;
  const align = spec.align || defaults.align || 'left';
  const bold = Boolean(spec.bold ?? defaults.bold);
  const caps = Boolean(spec.caps ?? defaults.caps);
  const vertical = spec.vertical || 'center';
  const colSpan = Number(spec.colSpan || 1);
  const width = spec.width || defaults.width || 1728;
  const padding = spec.cellPadding || defaults.cellPadding || 85;
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
    `<w:top w:w="${spec.padTop ?? padding}" w:type="dxa"/>`,
    `<w:left w:w="${spec.padLeft ?? padding}" w:type="dxa"/>`,
    `<w:bottom w:w="${spec.padBottom ?? padding}" w:type="dxa"/>`,
    `<w:right w:w="${spec.padRight ?? padding}" w:type="dxa"/>`,
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
  size = 20,
  color = '000000',
  cellPadding = 85,
} = {}) => {
  let widthIndex = 0;
  const renderedCells = cells.map((cell) => {
    const spec = normalizeCell(cell);
    const colSpan = Number(spec.colSpan || 1);
    const width = widths.slice(widthIndex, widthIndex + colSpan).reduce((sum, item) => sum + item, 0) || widths[widthIndex] || 1728;
    widthIndex += colSpan;
    return tableCell(spec, { fill, bold, size, color, width, cellPadding });
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
  headerSize = 20,
  bodySize = 20,
  cellPadding = 85,
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
    size: index < headerRows ? headerSize : bodySize,
    cellPadding,
  })).join(''),
  '</w:tbl>',
].join('');

const metaLabelParagraph = (text, size = 16) => paragraph(String(text || '').toUpperCase(), {
  align: 'left',
  bold: true,
  size,
  color: '6B7280',
  after: 50,
});

const metaValueParagraph = (text, size = 18) => paragraph(text, {
  align: 'left',
  bold: true,
  size,
  color: '111827',
  after: 0,
  before: 0,
});

const metaCell = (label, value, typography) => ({
  fill: 'FAFAFA',
  vertical: 'top',
  padLeft: typography.metaPadX,
  padRight: typography.metaPadX,
  padTop: typography.metaPadY,
  padBottom: typography.metaPadY,
  paragraphs: [
    metaLabelParagraph(label, typography.metaLabel),
    metaValueParagraph(value, typography.metaValue),
  ],
});

const buildMetadataRow = (report, typography) => [[
  metaCell('Prepared By', report.preparedBy, typography),
  metaCell('Coverage', report.coverage, typography),
  metaCell('Generated', report.generatedAt, typography),
  metaCell('Record Count', String(report.recordCount), typography),
]];

const signoffNameParagraph = (text, size = 22) => [
  '<w:p>',
  '<w:pPr>',
  '<w:jc w:val="center"/>',
  '<w:pBdr><w:top w:val="single" w:sz="6" w:space="4" w:color="1F2937"/></w:pBdr>',
  '<w:spacing w:before="480" w:after="0"/>',
  '</w:pPr>',
  textRun(text || '____________________________', { bold: Boolean(text), size, color: text ? '111827' : '9CA3AF' }),
  '</w:p>',
].join('');

const buildSignoffBlock = (report, typography) => {
  const half = Math.floor(REPORT_WIDTH / 2);
  const widths = [half, REPORT_WIDTH - half];
  return table([
    [
      {
        paragraphs: [paragraph('Prepared by', { size: typography.signoffLabel, color: '6B7280', caps: true })],
      },
      {
        paragraphs: [paragraph('Verified / Noted by', { size: typography.signoffLabel, color: '6B7280', caps: true })],
      },
    ],
    [
      {
        paragraphs: [signoffNameParagraph(report.preparedBy, typography.signoffName)],
      },
      {
        paragraphs: [signoffNameParagraph(report.reviewedBy || '', typography.signoffName)],
      },
    ],
  ], widths, { headerRows: 0, bordered: false, cellPadding: typography.cellPadding });
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

const DOCUMENT_NAMESPACES = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
].join(' ');

const DEFAULT_SECTION = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';

const createBaseDocxZip = () => {
  const zip = new AdmZip();
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-officedocument.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
  const packageRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr/></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
</w:styles>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>DigiPath Report</dc:title>
<dc:creator>DigiPath</dc:creator>
<cp:lastModifiedBy>DigiPath</cp:lastModifiedBy>
</cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>DigiPath</Application>
</Properties>`;
  const shellDocument = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${DOCUMENT_NAMESPACES}>
<w:body><w:p><w:r><w:t></w:t></w:r></w:p>${DEFAULT_SECTION}</w:body>
</w:document>`;

  zip.addFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(packageRels, 'utf8'));
  zip.addFile('word/_rels/document.xml.rels', Buffer.from(docRels, 'utf8'));
  zip.addFile('word/document.xml', Buffer.from(shellDocument, 'utf8'));
  zip.addFile('word/styles.xml', Buffer.from(styles, 'utf8'));
  zip.addFile('docProps/core.xml', Buffer.from(core, 'utf8'));
  zip.addFile('docProps/app.xml', Buffer.from(app, 'utf8'));
  return zip;
};

const extractSectionProperties = (templatePath) => {
  if (!templatePath || !fs.existsSync(templatePath)) return DEFAULT_SECTION;
  try {
    const templateZip = new AdmZip(templatePath);
    const templateDoc = templateZip.readAsText('word/document.xml');
    const sectMatch = templateDoc.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
    return sectMatch ? removeDocumentHeaders(sectMatch[0]) : DEFAULT_SECTION;
  } catch {
    return DEFAULT_SECTION;
  }
};

const ensurePngContentType = (contentTypesXml) => {
  let next = contentTypesXml;
  if (!next.includes('Extension="png"')) {
    next = next.replace(
      '</Types>',
      '<Default Extension="png" ContentType="image/png"/></Types>',
    );
  }
  const partName = `/word/media/${SEAL_IMAGE_NAME}`;
  if (!next.includes(partName)) {
    next = next.replace(
      '</Types>',
      `<Override PartName="${partName}" ContentType="image/png"/></Types>`,
    );
  }
  return next;
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
  '<wp:docPr id="100" name="Seal of Vinzons"/>',
  '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>',
  '<a:graphic>',
  '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">',
  '<pic:pic>',
  '<pic:nvPicPr><pic:cNvPr id="101" name="Seal"/><pic:cNvPicPr/></pic:nvPicPr>',
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

const HEADER_TABLE_WIDTH = 5800;
const HEADER_LOGO_COL = 1320;
const HEADER_TEXT_COL = HEADER_TABLE_WIDTH - HEADER_LOGO_COL;
const SEAL_SIZE_EMU = 590000;

const officialReportHeader = (imageRelId, typography) => {
  const logoCell = imageRelId
    ? {
      paragraphs: [imageParagraph(imageRelId, SEAL_SIZE_EMU, SEAL_SIZE_EMU)],
      vertical: 'center',
      width: HEADER_LOGO_COL,
      padRight: 40,
      cellPadding: 40,
    }
    : {
      text: '',
      vertical: 'center',
      width: HEADER_LOGO_COL,
      padRight: 40,
      cellPadding: 40,
    };
  const textCell = {
    width: HEADER_TEXT_COL,
    vertical: 'center',
    padLeft: 60,
    cellPadding: 40,
    paragraphs: [
      paragraph('Republic of the Philippines', { align: 'center', size: typography.headerLine, color: '374151' }),
      paragraph('Province of Camarines Norte', { align: 'center', size: typography.headerLine, color: '374151' }),
      paragraph('Municipality of Vinzons', { align: 'center', bold: true, size: typography.headerTitle, color: '111827', caps: true }),
      paragraph('DigiPath Document Tracking System', { align: 'center', size: typography.headerSub, color: '4B5563' }),
    ],
  };

  return [
    table([[logoCell, textCell]], [HEADER_LOGO_COL, HEADER_TEXT_COL], {
      headerRows: 0,
      bordered: false,
      cellPadding: 40,
    }),
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
  const zip = createBaseDocxZip();
  const sectionProperties = extractSectionProperties(templatePath);
  const sealPath = resolveSealPath();
  const imageRelId = sealPath ? addImageToZip(zip, sealPath) : null;
  const metadataWidths = metadataColumnWidths();
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
  const typography = computeReportTypography(summaryRows.length, rows.length);

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
    officialReportHeader(imageRelId, typography),
    paragraph(`${categoryLabel} Report`.toUpperCase(), {
      align: 'center',
      bold: true,
      size: typography.reportTitle,
      color: '111827',
      after: 30,
    }),
    paragraph('Official generated report from DigiPath records', {
      align: 'center',
      size: typography.reportSubtitle,
      color: '6B7280',
      after: 220,
    }),
    table(buildMetadataRow(report, typography), metadataWidths, {
      headerRows: 0,
      bordered: true,
    }),
    emptyParagraph(120),
    sectionTitle('Summary', typography),
    table(normalizedSummaryRows, summaryWidths, {
      headerRows: 1,
      bordered: true,
      headerSize: typography.tableHeader,
      bodySize: typography.tableBody,
      cellPadding: typography.cellPadding,
    }),
    hasDetailTable ? sectionTitle(tableTitle || `${categoryLabel} Details`, typography) : '',
    hasDetailTable ? table(detailRows, detailWidths, {
      headerRows: 1,
      bordered: true,
      headerSize: typography.tableHeader,
      bodySize: typography.tableBody,
      cellPadding: typography.cellPadding,
    }) : '',
    emptyParagraph(120),
    buildSignoffBlock(report, typography),
    sectionProperties,
  ].join('');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${DOCUMENT_NAMESPACES}>
<w:body>${bodyContent}</w:body>
</w:document>`;

  zip.updateFile('word/document.xml', Buffer.from(documentXml, 'utf8'));
  return zip.toBuffer();
};

module.exports = {
  WORD_MIME,
  buildOfficialReportDocx,
};
