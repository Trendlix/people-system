// Filling a PDF template in (owner's decision, 15 October 2026): an official form uploaded as a PDF, with its fields
// placed on it, filled in by printing the values on top of the original pages. The documents and templates modules
// call only these.
//
//   fillPdfTemplate(pdf, fields, values, language): Promise<Buffer>      fill.ts
//   readPdfTemplate(data): Promise<PdfPageSize[]>, PdfTemplateError        pages.ts
//   shownPage(page): the page as the editor shows it                       pages.ts

export { fillPdfTemplate, printedText } from './fill.js';
export { PDF_PROTECTED, PdfTemplateError, readPdfTemplate, shownPage, type ShownPage } from './pages.js';
