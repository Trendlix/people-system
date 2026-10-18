import {
  EMPLOYMENT_TYPES,
  LABELS,
  TAG_GROUP_LABELS,
  TAG_GROUPS,
  TEMPLATE_FOLDER_LABELS,
  TEMPLATE_SLOTS,
  TEMPLATE_TAGS,
  type EmploymentType,
  type TemplateLanguage,
  type TemplateSigners,
  type TemplateSlot,
  type TemplateTag,
} from '@trendlix/shared';
import { writeZip } from './zip.js';

// The Fields Guide (owner's request, 15 October 2026: "Prepare a document with the mapping fields … where I can get it
// from the Templates page side menu"): a Word file for whoever prepares templates, made on the spot from the live lists
// in @trendlix/shared, so it always matches what the system accepts: how to use the fields, every tag by group
// (TEMPLATE_TAGS) and the library's templates (TEMPLATE_SLOTS). It is built from scratch with the zip writer: only the
// parts Word needs, styles with a font that has Arabic (Arial), an A4 page turned landscape (the tables need the width)
// and a footer with the date and "Page X of Y". The guide holds {{tags}} as text: all of them known, so the tag reader
// finds nothing unknown or broken in it.

export const FIELDS_GUIDE_TITLE = 'Template Fields Guide';
export const FIELDS_GUIDE_TITLE_AR = 'دليل حقول القوالب';
export const FIELDS_GUIDE_FILE_NAME = `${FIELDS_GUIDE_TITLE}.docx`;

export interface FieldsGuideOptions {
  /** The company's name (its profile), shown under the title; null when there is no company row. */
  companyName: string | null;
  /** The day it is made, as DD/MM/YYYY. */
  date: string;
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// A4 landscape (twips) with 2 cm margins: the text is 25.7 cm wide
const PAGE = { width: 16838, height: 11906, margin: 1134, edge: 567 };
const TEXT_WIDTH = PAGE.width - 2 * PAGE.margin;

const DARK = '1F3864';
const MUTED = '595959';
const BORDER = 'A6A6A6';
const HEADER_FILL = 'DEEAF6';
const RESTRICTED = 'C00000';

// As the library page words them (apps/web/src/app/(app)/templates/wording.ts)
const LANGUAGE_LABELS: Record<TemplateLanguage, string> = { ar: 'Arabic', en: 'English', bilingual: 'Arabic and English' };
const SIGNER_LABELS: Record<TemplateSigners, string> = {
  both: 'The employee and the company',
  employee: 'The employee',
  company: 'The company',
  none: 'Not signed',
};

const HOW_TO = (date: string): string[] => [
  'Type or paste a tag exactly as shown in this guide, with two curly braces on each side, e.g. {{full_name_ar}}, in the Word file where its value should print. Tags are in small letters.',
  'Upload the file to its template on the Templates page, check the tags the system found, then publish it. A tag that isn’t in this guide, or isn’t written correctly, stops the file from being published.',
  'Type the tags as plain text: don’t use Word’s Mail Merge fields (Mailings › Insert Merge Field).',
  'A tag takes the formatting of the place where it’s typed: its value prints in the same font, size, colour and weight as the tag.',
  `Dates print as DD/MM/YYYY (e.g. ${date}) unless the notes say otherwise.`,
  'In a bilingual template (Arabic and English side by side), use the _ar and _en tags for values that depend on the language, e.g. {{job_title_ar}} on the Arabic side and {{job_title_en}} on the English side. The same tag without _ar or _en prints in Arabic there.',
  'Restricted fields hold national ID, salary or bank data: only those allowed to see that data can generate a document that uses them.',
  'If a field has no value, the document isn’t generated: the system says which field is missing and where to fill it in.',
];

interface Column {
  title: string;
  width: number;
  /** Arabic: the cells' paragraphs read right to left. */
  rtl?: boolean;
}

// Each table spans the text's width
const FIELD_COLUMNS: readonly Column[] = [
  { title: 'Tag', width: 3200 },
  { title: 'Field', width: 2700 },
  { title: 'الحقل', width: 2700, rtl: true },
  { title: 'Filled From', width: 3570 },
  { title: 'Notes', width: 2400 },
];
const SLOT_COLUMNS: readonly Column[] = [
  { title: 'Template', width: 4370 },
  { title: 'Folder', width: 2000 },
  { title: 'Language', width: 2600 },
  { title: 'Applies To', width: 3400 },
  { title: 'Signed By', width: 2200 },
];

/** The guide as a Word file (.docx). The same options always give the same bytes. */
export function fieldsGuideDocx(options: FieldsGuideOptions): Buffer {
  return writeZip([
    { name: '[Content_Types].xml', data: contentTypesXml() },
    { name: '_rels/.rels', data: packageRelsXml() },
    { name: 'docProps/core.xml', data: corePropertiesXml() },
    { name: 'word/document.xml', data: documentXml(options) },
    { name: 'word/_rels/document.xml.rels', data: documentRelsXml() },
    { name: 'word/styles.xml', data: stylesXml() },
    { name: 'word/settings.xml', data: settingsXml() },
    { name: 'word/footer1.xml', data: footerXml(options) },
  ]);
}

// ---------- the content ----------

function documentXml({ companyName, date }: FieldsGuideOptions): string {
  const company = companyName?.trim();
  const body = [
    paragraph(run(FIELDS_GUIDE_TITLE), { style: 'Title' }),
    // an Arabic run in a paragraph that stays left to right, under the English title
    paragraph(run(FIELDS_GUIDE_TITLE_AR, { rtl: true }), { style: 'TitleArabic' }),
    paragraph(runs([company, date].filter(Boolean).join(' · ')), { style: 'Subtitle' }),
    paragraph(
      runs(
        `Every field a Word template can use in People System: ${TEMPLATE_TAGS.length} fields in ${TAG_GROUPS.length} groups, with where each value comes from, ` +
          `and the ${TEMPLATE_SLOTS.length} templates in the library. It is made from the system’s own lists, so it matches what the system accepts on the date above.`,
      ),
    ),

    paragraph(run('How to Use the Fields'), { style: 'Heading1' }),
    ...HOW_TO(date).map((step, i) => paragraph(`${run(`${i + 1}.`)}<w:r><w:tab/></w:r>${runs(step)}`, { style: 'Step' })),

    paragraph(run('Fields by Group'), { style: 'Heading1' }),
    paragraph(
      runs(
        'Tag: what to type in Word. Field and الحقل: the field’s name in English and Arabic. Filled from: where People System takes the value when it makes a document. ' +
          'Restricted: national ID, salary or bank data.',
      ),
    ),
    ...TAG_GROUPS.flatMap((group) => {
      const tags = TEMPLATE_TAGS.filter((t) => t.group === group);
      if (!tags.length) return [];
      return [paragraph(run(titleCase(TAG_GROUP_LABELS[group])), { style: 'Heading2' }), table(FIELD_COLUMNS, tags.map(tagRow))];
    }),

    paragraph(run('Templates in the Library'), { style: 'Heading1' }),
    paragraph(runs('The documents the library holds, one Word file each, uploaded and published on the Templates page.')),
    table(SLOT_COLUMNS, TEMPLATE_SLOTS.map(slotRow)),
    // the body ends with a paragraph, not a table
    paragraph(''),
  ].join('');

  const section =
    '<w:sectPr>' +
    '<w:footerReference w:type="default" r:id="rId3"/>' +
    `<w:pgSz w:w="${PAGE.width}" w:h="${PAGE.height}" w:orient="landscape"/>` +
    `<w:pgMar w:top="${PAGE.margin}" w:right="${PAGE.margin}" w:bottom="${PAGE.margin}" w:left="${PAGE.margin}" w:header="${PAGE.edge}" w:footer="${PAGE.edge}" w:gutter="0"/>` +
    '<w:cols w:space="708"/><w:docGrid w:linePitch="360"/>' +
    '</w:sectPr>';
  return `${DECLARATION}<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${body}${section}</w:body></w:document>`;
}

function tagRow(t: TemplateTag): string[] {
  const notes = [
    t.restricted ? cellParagraph(run('Restricted', { bold: true, color: RESTRICTED })) : '',
    t.note ? cellParagraph(runs(t.note)) : '',
  ].join('');
  return [
    cellParagraph(run(`{{${t.tag}}}`, { code: true })),
    cellParagraph(runs(t.labelEn)),
    cellParagraph(run(t.labelAr, { rtl: true }), true),
    cellParagraph(runs(t.source)),
    notes || cellParagraph(''),
  ];
}

function slotRow(slot: TemplateSlot): string[] {
  const notes = [
    slot.copyOf ? `Printed from the file of ${titleCase(TEMPLATE_SLOTS.find((s) => s.key === slot.copyOf)?.name ?? slot.copyOf)}.` : null,
    overridesNote(slot.overrides),
  ].filter((note): note is string => note !== null);
  return [
    cellParagraph(runs(titleCase(slot.name), { bold: true })) + notes.map((note) => cellParagraph(runs(note, { color: MUTED }))).join(''),
    cellParagraph(runs(TEMPLATE_FOLDER_LABELS[slot.folder] ?? slot.folder)),
    cellParagraph(runs(slot.language ? LANGUAGE_LABELS[slot.language] : 'Chosen on upload')),
    cellParagraph(runs(appliesTo(slot.appliesTo, slot.paidByCommission))),
    cellParagraph(runs(SIGNER_LABELS[slot.signers] ?? slot.signers)),
  ];
}

/**
 * "All employment types", or the ones named: "Full-time", "Part-time, Trainee"; a commission slot "Full-time, paid by
 * commission" (owner, 18 October 2026: Sales became Full-time with the flag).
 */
function appliesTo(types: readonly EmploymentType[], paidByCommission = false): string {
  if (EMPLOYMENT_TYPES.every((t) => types.includes(t))) return 'All employment types';
  const named = types.map((t) => LABELS.employmentType[t] ?? t).join(', ');
  return paidByCommission ? `${named}, paid by commission` : named;
}

/** The tags that print another tag's value on this template, e.g. the insured salary on the social insurance copy. */
function overridesNote(overrides: TemplateSlot['overrides']): string | null {
  const pairs = Object.entries(overrides ?? {}).map(([tag, from], i) => `{{${tag}}} ${i ? '' : 'prints '}the value of {{${from}}}`);
  if (!pairs.length) return null;
  const listed = pairs.length === 1 ? pairs[0] : `${pairs.slice(0, -1).join(', ')} and ${pairs[pairs.length - 1]}`;
  return `On this template, ${listed}.`;
}

/** Short words kept in lower case inside a title (not the first word): as the web's titleCase (apps/web/src/lib/format.ts). */
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'vs', 'with']);

/**
 * A name as a heading shows it, in Title Case, as the web's titleCase: "Job and contract" → "Job and Contract". Words
 * with capitals already (NDA) and words in Arabic are left as they are; a hyphenated word changes only its first letter.
 */
export function titleCase(text: string): string {
  let first = true;
  return text.replace(/[A-Za-z][\w'’]*(?:-[A-Za-z][\w'’]*)*/g, (word, offset: number) => {
    const isFirst = first;
    first = false;
    const starts = isFirst || /(?:[(–—:]|\s-)\s*$/.test(text.slice(0, offset));
    if (word !== word.toLowerCase()) return word;
    if (!starts && SMALL_WORDS.has(word)) return word;
    return word[0].toUpperCase() + word.slice(1);
  });
}

// ---------- WordprocessingML ----------

/** Tab, line feed and carriage return are the only control characters XML 1.0 holds; U+FFFE and U+FFFF it never does. */
const fitsXml = (code: number) => (code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) && code !== 0xfffe && code !== 0xffff;

/** Text as XML holds it: its reserved characters escaped, and the characters it can't hold at all left out. */
const escapeXml = (text: string) =>
  Array.from(text)
    .filter((ch) => fitsXml(ch.codePointAt(0)!))
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

interface RunStyle {
  bold?: boolean;
  color?: string;
  /** A {{tag}}: the monospace Tag style, never spell-checked. */
  code?: boolean;
  /** Arabic: read right to left, with the Arabic language for its script. */
  rtl?: boolean;
}

/** One run of text (its properties in the order the schema wants them). */
function run(text: string, style: RunStyle = {}): string {
  const props =
    (style.code ? '<w:rStyle w:val="TagCode"/>' : '') +
    (style.bold ? '<w:b/><w:bCs/>' : '') +
    (style.code ? '<w:noProof/>' : '') +
    (style.color ? `<w:color w:val="${style.color}"/>` : '') +
    (style.rtl ? '<w:rtl/><w:lang w:bidi="ar-EG"/>' : '');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

// Arabic letters (with their marks and presentation forms), and the spaces and punctuation between two of them, so a
// phrase such as "فقط … لا غير" is one right-to-left run
const AR = '\\u0600-\\u06ff\\u0750-\\u077f\\u08a0-\\u08ff\\ufb50-\\ufdff\\ufe70-\\ufeff';
const ARABIC_PHRASE = new RegExp(`[${AR}]+(?:[\\s\\p{P}]+[${AR}]+)*`, 'gu');
const TAG_TEXT = /(\{\{[A-Za-z0-9_]+\}\})/;

/** Text that may hold {{tags}} (set in the Tag style) and Arabic phrases (right to left) among English. */
function runs(text: string, style: RunStyle = {}): string {
  return text
    .split(TAG_TEXT)
    .map((piece, i) => {
      if (!piece) return '';
      if (i % 2) return run(piece, { ...style, code: true });
      let out = '';
      let last = 0;
      for (const m of piece.matchAll(ARABIC_PHRASE)) {
        if (m.index > last) out += run(piece.slice(last, m.index), style);
        out += run(m[0], { ...style, rtl: true });
        last = m.index + m[0].length;
      }
      return last < piece.length ? out + run(piece.slice(last), style) : out;
    })
    .join('');
}

function paragraph(content: string, { style, bidi }: { style?: string; bidi?: boolean } = {}): string {
  const props = (style ? `<w:pStyle w:val="${style}"/>` : '') + (bidi ? '<w:bidi/>' : '');
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${content}</w:p>`;
}

/** A paragraph in a table cell; `bidi`: right to left (it starts at the right, with no alignment of its own). */
const cellParagraph = (content: string, bidi = false) => paragraph(content, { style: 'TableText', bidi });

const BORDERS = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="${BORDER}"/>`)
  .join('');
const CELL_MARGINS = '<w:top w:w="57" w:type="dxa"/><w:left w:w="85" w:type="dxa"/><w:bottom w:w="57" w:type="dxa"/><w:right w:w="85" w:type="dxa"/>';

/**
 * A table across the text's width, its header row shaded and repeated at the top of each page, no row split over two
 * pages. The borders, margins and shading are on the table itself as well as in its style, so a converter that skips
 * table styles (the PDF) shows them too.
 */
function table(columns: readonly Column[], rows: readonly string[][]): string {
  const cell = (column: Column, content: string, header = false) =>
    `<w:tc><w:tcPr><w:tcW w:w="${column.width}" w:type="dxa"/>${header ? `<w:shd w:val="clear" w:color="auto" w:fill="${HEADER_FILL}"/>` : ''}</w:tcPr>${content}</w:tc>`;
  const header =
    '<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' +
    columns.map((c) => cell(c, cellParagraph(run(c.title, { bold: true, rtl: c.rtl }), c.rtl), true)).join('') +
    '</w:tr>';
  const body = rows.map((row) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${row.map((content, i) => cell(columns[i], content)).join('')}</w:tr>`).join('');
  return (
    '<w:tbl><w:tblPr>' +
    '<w:tblStyle w:val="FieldsTable"/>' +
    `<w:tblW w:w="${TEXT_WIDTH}" w:type="dxa"/>` +
    `<w:tblBorders>${BORDERS}</w:tblBorders>` +
    '<w:tblLayout w:type="fixed"/>' +
    `<w:tblCellMar>${CELL_MARGINS}</w:tblCellMar>` +
    '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/>' +
    '</w:tblPr>' +
    `<w:tblGrid>${columns.map((c) => `<w:gridCol w:w="${c.width}"/>`).join('')}</w:tblGrid>` +
    header +
    body +
    '</w:tbl>'
  );
}

/** A complex field (PAGE, NUMPAGES) with its last shown value, which Word and the PDF converter update as they lay it out. */
const field = (instruction: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:t>1</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

function footerXml({ date }: FieldsGuideOptions): string {
  const content = `${run(`${FIELDS_GUIDE_TITLE} · ${date}`)}<w:r><w:tab/></w:r>${run('Page ')}${field('PAGE')}${run(' of ')}${field('NUMPAGES')}`;
  return `${DECLARATION}<w:ftr xmlns:w="${W_NS}" xmlns:r="${R_NS}">${paragraph(content, { style: 'Footer' })}</w:ftr>`;
}

// ---------- the package's other parts ----------

function contentTypesXml(): string {
  const main = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  return (
    DECLARATION +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    `<Override PartName="/word/document.xml" ContentType="${main}.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="${main}.styles+xml"/>` +
    `<Override PartName="/word/settings.xml" ContentType="${main}.settings+xml"/>` +
    `<Override PartName="/word/footer1.xml" ContentType="${main}.footer+xml"/>` +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '</Types>'
  );
}

const RELATIONSHIPS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function packageRelsXml(): string {
  return (
    DECLARATION +
    `<Relationships xmlns="${RELATIONSHIPS}">` +
    `<Relationship Id="rId1" Type="${OFFICE_RELATIONSHIP}/officeDocument" Target="word/document.xml"/>` +
    `<Relationship Id="rId2" Type="${RELATIONSHIPS}/metadata/core-properties" Target="docProps/core.xml"/>` +
    '</Relationships>'
  );
}

function documentRelsXml(): string {
  return (
    DECLARATION +
    `<Relationships xmlns="${RELATIONSHIPS}">` +
    `<Relationship Id="rId1" Type="${OFFICE_RELATIONSHIP}/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId2" Type="${OFFICE_RELATIONSHIP}/settings" Target="settings.xml"/>` +
    `<Relationship Id="rId3" Type="${OFFICE_RELATIONSHIP}/footer" Target="footer1.xml"/>` +
    '</Relationships>'
  );
}

/** The title the PDF and Word's file properties show. */
function corePropertiesXml(): string {
  return (
    DECLARATION +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    `<dc:title>${FIELDS_GUIDE_TITLE}</dc:title><dc:creator>People System</dc:creator>` +
    '</cp:coreProperties>'
  );
}

function settingsXml(): string {
  return (
    DECLARATION +
    `<w:settings xmlns:w="${W_NS}">` +
    '<w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/>' +
    '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
    '</w:settings>'
  );
}

/** A paragraph style (its elements in the order the schema wants them). */
function paragraphStyle(id: string, name: string, pPr: string, rPr = '', { next = true, heading = false } = {}): string {
  return (
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>` +
    (next ? '<w:next w:val="Normal"/>' : '') +
    (heading ? '<w:uiPriority w:val="9"/>' : '') +
    `<w:qFormat/>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}</w:style>`
  );
}

const size = (halfPoints: number) => `<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/>`;
const ARIAL = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/>';

function stylesXml(): string {
  return (
    DECLARATION +
    `<w:styles xmlns:w="${W_NS}">` +
    // Arial for every script, Arabic included; 10 pt
    '<w:docDefaults>' +
    `<w:rPrDefault><w:rPr>${ARIAL}${size(20)}<w:lang w:val="en-GB" w:eastAsia="en-GB" w:bidi="ar-EG"/></w:rPr></w:rPrDefault>` +
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
    '</w:docDefaults>' +
    // the font again on Normal, for readers that skip the defaults (Quick Look, some importers)
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr>${ARIAL}${size(20)}</w:rPr></w:style>` +
    paragraphStyle('Title', 'Title', '<w:spacing w:after="60" w:line="240" w:lineRule="auto"/>', `<w:b/><w:bCs/><w:color w:val="${DARK}"/>${size(48)}`) +
    paragraphStyle('TitleArabic', 'Title (Arabic)', '<w:spacing w:after="120"/>', `<w:color w:val="${DARK}"/>${size(36)}`) +
    paragraphStyle(
      'Subtitle',
      'Subtitle',
      `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="6" w:color="${DARK}"/></w:pBdr><w:spacing w:after="240"/>`,
      `<w:color w:val="${MUTED}"/>${size(22)}`,
    ) +
    paragraphStyle(
      'Heading1',
      'heading 1',
      '<w:keepNext/><w:keepLines/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/>',
      `<w:b/><w:bCs/><w:color w:val="${DARK}"/>${size(30)}`,
      { heading: true },
    ) +
    paragraphStyle(
      'Heading2',
      'heading 2',
      '<w:keepNext/><w:keepLines/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="1"/>',
      `<w:b/><w:bCs/><w:color w:val="2E5496"/>${size(24)}`,
      { heading: true },
    ) +
    // a numbered step: the number, a tab, and the text indented past it
    paragraphStyle('Step', 'Step', '<w:tabs><w:tab w:val="left" w:pos="425"/></w:tabs><w:spacing w:after="80"/><w:ind w:left="425" w:hanging="425"/>', '', { next: false }) +
    paragraphStyle('TableText', 'Table text', '<w:spacing w:after="0" w:line="252" w:lineRule="auto"/>', size(18), { next: false }) +
    paragraphStyle('Footer', 'footer', `<w:tabs><w:tab w:val="right" w:pos="${TEXT_WIDTH}"/></w:tabs><w:spacing w:after="0"/>`, `<w:color w:val="${MUTED}"/>${size(16)}`, {
      next: false,
    }) +
    '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>' +
    // a {{tag}}: monospace, so each brace and underscore shows (Courier New: on Windows and macOS, and the PDF converter
    // has its metric twin)
    `<w:style w:type="character" w:styleId="TagCode"><w:name w:val="Tag"/><w:basedOn w:val="DefaultParagraphFont"/><w:qFormat/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:color w:val="${DARK}"/></w:rPr></w:style>` +
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>' +
    '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '<w:style w:type="table" w:styleId="FieldsTable"><w:name w:val="Fields table"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="59"/>' +
    `<w:tblPr><w:tblBorders>${BORDERS}</w:tblBorders><w:tblCellMar>${CELL_MARGINS}</w:tblCellMar></w:tblPr>` +
    `<w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:bCs/></w:rPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="${HEADER_FILL}"/></w:tcPr></w:tblStylePr>` +
    '</w:style>' +
    '</w:styles>'
  );
}
