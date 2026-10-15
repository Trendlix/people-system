import { textParts } from '../../templates/docx-tags.js';
import { readZip, writeZip, type ZipFile, type ZipRawFile } from '../../templates/zip.js';
import { unwrapFields } from './fields.js';
import { detachMailMerge, type DocxPackage } from './mail-merge.js';
import { fillTags } from './tags.js';

// Filling a published template in (spec §8): the parts whose text is printed (the body, headers, footers, footnotes
// and endnotes, as the tag reader reads them) get their fields unwrapped (fields.ts) and their tags replaced
// (tags.ts); the mail merge link is removed (mail-merge.ts). The result is zipped again in the same order: the parts
// changed are deflated afresh, every other entry is copied as stored, byte for byte.

/** The .docx `template` with every {{tag}} replaced by `values[tag]` (XML-escaped, keeping the run's formatting). */
export function fillTemplate(template: Buffer, values: Readonly<Record<string, string>>): Buffer {
  const zip = readZip(template);
  if (!zip.has('word/document.xml')) throw new Error('Not a Word document: it has no word/document.xml');

  const names = zip.entries.map((e) => e.name);
  const changed = new Map<string, string>();
  const removed = new Set<string>();
  const pkg: DocxPackage = {
    names,
    read: (name) => (removed.has(name) ? null : (changed.get(name) ?? zip.read(name)?.toString('utf8') ?? null)),
    write: (name, xml) => {
      if (xml !== pkg.read(name)) changed.set(name, xml);
    },
    remove: (name) => {
      removed.add(name);
      changed.delete(name);
    },
  };

  detachMailMerge(pkg);
  for (const name of textParts(names)) {
    const xml = pkg.read(name);
    if (xml !== null) pkg.write(name, fillTags(unwrapFields(xml), values));
  }

  const files = zip.entries
    .filter((e) => !removed.has(e.name))
    .map((e): ZipFile | ZipRawFile => {
      const xml = changed.get(e.name);
      return xml === undefined ? { name: e.name, raw: zip.raw(e.name)! } : { name: e.name, data: xml };
    });
  return writeZip(files);
}
