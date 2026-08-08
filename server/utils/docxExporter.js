const sanitizeHtml = require('sanitize-html');
const { Document, Packer, Paragraph, TextRun } = require('docx');

function htmlToPlainText(html) {
  const withBreaks = String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n');
  return sanitizeHtml(withBreaks, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: 'discard'
  }).replace(/\r\n/g, '\n').trim();
}

async function htmlToSafeDocx(html) {
  const text = htmlToPlainText(html);
  const paragraphs = (text || ' ').split('\n').map((line) => new Paragraph({
    children: [new TextRun({ text: line, font: 'SimSun', size: 28 })]
  }));
  const document = new Document({ sections: [{ children: paragraphs }] });
  return Packer.toBuffer(document);
}

module.exports = { htmlToPlainText, htmlToSafeDocx };
