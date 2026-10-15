import { applyEdits, attribute, descendants, parseXml, removal, wordPrefix, type XmlEdit } from './xml.js';

// A template made as a Word mail merge stays linked to its data source: the owner's contract has, in
// word/settings.xml, a <w:mailMerge> querying Z:\HR\Contracts\Contracts Source.xlsx, and keeps the last records it
// read in word/recipientData.xml. Left in, Word asks to run that query whenever the filled-in file is opened, and
// may merge the spreadsheet's values over ours. So the link goes: the <w:mailMerge> setting, the relationships to the
// data source and the recipient data (wherever they are declared), the recipient data part and its content type.

/** A .docx being filled in: its parts as text, changed and removed in memory. */
export interface DocxPackage {
  /** Every entry of the zip, in order. */
  readonly names: readonly string[];
  /** The part's XML as it stands; null when there is no such part (or it was removed). */
  read(name: string): string | null;
  write(name: string, xml: string): void;
  remove(name: string): void;
}

const MAIL_MERGE_RELATIONSHIP = /\/(?:recipientData|mailMergeSource|mailMergeHeaderSource)$/;
const RECIPIENT_DATA_TYPE = 'application/vnd.ms-word.mailMergeRecipientData+xml';

const localName = (name: string) => name.slice(name.indexOf(':') + 1);

/** Removes the mail merge from the package: settings, relationships, the recipient data part and its content type. */
export function detachMailMerge(pkg: DocxPackage): void {
  const settings = pkg.read('word/settings.xml');
  if (settings !== null) {
    const mailMerge = `${wordPrefix(settings)}:mailMerge`;
    const edits = [...descendants(parseXml(settings))].filter((el) => el.name === mailMerge).map(removal);
    pkg.write('word/settings.xml', applyEdits(settings, edits));
  }

  const parts = new Set<string>(); // lower case: part names are case-insensitive
  for (const name of pkg.names.filter((n) => n.endsWith('.rels'))) {
    const xml = pkg.read(name);
    if (xml === null || !/mailMerge|recipientData/i.test(xml)) continue;
    const edits: XmlEdit[] = [];
    for (const el of descendants(parseXml(xml))) {
      if (localName(el.name) !== 'Relationship' || !MAIL_MERGE_RELATIONSHIP.test(attribute(xml, el, 'Type') ?? '')) continue;
      edits.push(removal(el));
      const target = attribute(xml, el, 'Target');
      if (target && attribute(xml, el, 'TargetMode') !== 'External') parts.add(resolveTarget(name, target).toLowerCase());
    }
    pkg.write(name, applyEdits(xml, edits));
  }

  const types = pkg.read('[Content_Types].xml');
  if (types !== null) {
    const overrides = [...descendants(parseXml(types))].filter((el) => localName(el.name) === 'Override');
    const partOf = (el: (typeof overrides)[number]) => (attribute(types, el, 'PartName') ?? '').replace(/^\//, '').toLowerCase();
    for (const el of overrides) if (attribute(types, el, 'ContentType') === RECIPIENT_DATA_TYPE) parts.add(partOf(el));
    pkg.write('[Content_Types].xml', applyEdits(types, overrides.filter((el) => parts.has(partOf(el))).map(removal)));
  }

  for (const name of pkg.names) {
    const lower = name.toLowerCase();
    if (parts.has(lower) || [...parts].some((part) => lower === relsOf(part))) pkg.remove(name);
  }
}

/** A relationship's target as a part name, e.g. word/_rels/settings.xml.rels + "recipientData.xml" → word/recipientData.xml. */
export function resolveTarget(relsName: string, target: string): string {
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    // kept as written
  }
  const base = relsName.replace(/(^|\/)_rels\/[^/]*$/, '$1'); // the folder of the part the relationships belong to
  const path = decoded.startsWith('/') ? decoded.slice(1) : base + decoded;
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '..') out.pop();
    else if (segment && segment !== '.') out.push(segment);
  }
  return out.join('/');
}

/** The relationships part of a part, e.g. word/recipientdata.xml → word/_rels/recipientdata.xml.rels. */
function relsOf(part: string): string {
  const slash = part.lastIndexOf('/');
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}
