const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const templateDir = path.join(__dirname, '..', 'templates');
const templatePath = path.join(templateDir, 'Vinzons_Report_Template.docx');

if (fs.existsSync(templatePath)) {
  console.log(`Template already exists at ${templatePath}`);
  process.exit(0);
}

fs.mkdirSync(templateDir, { recursive: true });

const zip = new AdmZip();
const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body><w:p><w:r><w:t></w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

zip.addFile('[Content_Types].xml', Buffer.from(contentTypes));
zip.addFile('_rels/.rels', Buffer.from(rels));
zip.addFile('word/_rels/document.xml.rels', Buffer.from(docRels));
zip.addFile('word/document.xml', Buffer.from(document));
zip.writeZip(templatePath);
console.log(`Created ${templatePath}`);
