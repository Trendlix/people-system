import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeZip, type ZipFile } from '../../src/templates/zip.js';

// Word files for the template tests: the real templates from the handoff pack (copied here unchanged), and small ones
// built on the spot with the zip writer, holding only the parts the tag reader looks at.

const HERE = fileURLToPath(new URL('./', import.meta.url));

/** TrendLIX_Contract_TEMPLATE.docx, TrendLIX_Resignation_TEMPLATE.docx, TrendLIX_Clearance_Dues_TEMPLATE.docx */
export const realTemplate = (name: 'Contract' | 'Resignation' | 'Clearance_Dues'): Buffer => readFileSync(`${HERE}TrendLIX_${name}_TEMPLATE.docx`);

// The tags document-rules.json lists for each real template, in the order they appear.
export const CONTRACT_TAGS = [
  'day_name',
  'contract_date',
  'full_name_ar',
  'address',
  'phone',
  'national_id',
  'id_printed_no',
  'id_issue_date',
  'qualification',
  'job_title',
  'duration',
  'start_date',
  'end_date',
  'gross_salary',
  'gross_salary_words',
  'net_salary',
  'net_salary_words',
];
export const RESIGNATION_TAGS = ['full_name_ar', 'reason_ar', 'resignation_date', 'request_date'];
export const CLEARANCE_TAGS = ['day_name', 'date', 'full_name_ar', 'national_id', 'address', 'company_rep_name', 'company_rep_national_id'];

export const DOCUMENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
export const TEMPLATE_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** A paragraph of runs. */
export const p = (...runs: string[]) => `<w:p><w:pPr><w:bidi/></w:pPr>${runs.join('')}</w:p>`;
/** A run with text, already XML-escaped. */
export const r = (text: string) => `<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

export const documentXml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`;
export const headerXml = (body: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr ${W}>${body}</w:hdr>`;
export const footerXml = (body: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr ${W}>${body}</w:ftr>`;

export function contentTypes(main = DOCUMENT_TYPE): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    `<Override PartName="/word/document.xml" ContentType="${main}"/>` +
    '</Types>'
  );
}

export interface DocxParts {
  /** The body's paragraphs. */
  body: string;
  /** Other parts by name, e.g. { 'word/header1.xml': headerXml(…) }. */
  parts?: Record<string, string>;
  /** The main part's content type: a document unless said otherwise. */
  mainType?: string;
}

/** A minimal .docx: [Content_Types].xml, the package relationships and word/document.xml, plus any other parts. */
export function docx({ body, parts = {}, mainType }: DocxParts): Buffer {
  const files: ZipFile[] = [
    { name: '[Content_Types].xml', data: contentTypes(mainType) },
    {
      name: '_rels/.rels',
      data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    { name: 'word/document.xml', data: documentXml(body) },
    ...Object.entries(parts).map(([name, data]) => ({ name, data })),
  ];
  return writeZip(files);
}

/**
 * Changes a central directory entry of a zip the writer made (no comment, so the end record is the last 22 bytes):
 * `edit` gets the zip and where the entry starts.
 */
export function patchCentral(zip: Buffer, name: string, edit: (zip: Buffer, at: number) => void): Buffer {
  const out = Buffer.from(zip);
  const end = out.length - 22;
  let at = out.readUInt32LE(end + 16);
  for (let i = 0; i < out.readUInt16LE(end + 10); i++) {
    const nameLength = out.readUInt16LE(at + 28);
    if (out.toString('utf8', at + 46, at + 46 + nameLength) === name) {
      edit(out, at);
      return out;
    }
    at += 46 + nameLength + out.readUInt16LE(at + 30) + out.readUInt16LE(at + 32);
  }
  throw new Error(`${name} is not in the zip`);
}
