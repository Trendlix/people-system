import pngjs from 'pngjs';
import { readZip, writeZip, type ZipFile, type ZipRawFile } from '../../templates/zip.js';

// A picture's transparency, kept in the PDF (22 October 2026: the contract's TrendLIX watermark, set in Word to 15%
// opacity, came out of the PDF converter solid, the black "Trend" hiding the text over it). Word keeps a picture's
// transparency as <a:alphaModFix amt="15000"/> on its <a:blip>; LibreOffice (the converter, Gotenberg) ignores it but
// draws a PNG's own alpha. So, before converting, each PNG with such a setting gets the setting baked into a copy of
// its pixels (every pixel's alpha × amt ÷ 100000), the picture points to the copy, and the setting is taken off: Word
// shows it exactly as before, LibreOffice now as Word does. A JPEG (no alpha of its own) is left as it is.

const { PNG } = pngjs;

const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

/** The relationships of a part (word/header1.xml → word/_rels/header1.xml.rels). */
const relsOf = (part: string) => part.replace(/^(.*\/)?([^/]+)$/, (_m, dir: string | undefined, file: string) => `${dir ?? ''}_rels/${file}.rels`);

/** A part's image targets by relationship id (word/media/image2.png), the external ones left out. */
function targetsOf(rels: string, part: string): Map<string, string> {
  const dir = part.slice(0, part.lastIndexOf('/') + 1);
  const out = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = m[0];
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    if (!id || !target || /TargetMode="External"/.test(tag)) continue;
    out.set(id, target.startsWith('/') ? target.slice(1) : dir + target);
  }
  return out;
}

/** A PNG's pixels with their alpha × `amt` ÷ 100000; null when it can't be read. */
export function fadedPng(png: Buffer, amt: number): Buffer | null {
  try {
    const image = PNG.sync.read(png);
    const k = Math.max(0, Math.min(100000, amt)) / 100000;
    for (let i = 3; i < image.data.length; i += 4) image.data[i] = Math.round(image.data[i] * k);
    return PNG.sync.write(image);
  } catch {
    return null;
  }
}

/** The .docx with every PNG's <a:alphaModFix> baked into a copy of the picture; the same file when it has none. */
export function bakeImageOpacity(docx: Buffer): Buffer {
  const zip = readZip(docx);
  const names = zip.entries.map((e) => e.name);
  const parts = names.filter((n) => /^word\/[^/]+\.xml$/.test(n) && zip.read(n)!.includes('alphaModFix'));
  if (!parts.length) return docx;

  const changed = new Map<string, string>();
  const added: ZipFile[] = [];
  const copies = new Map<string, string>(); // `${target}|${amt}` → the copy's name
  let n = 0;
  const nextMedia = () => {
    let name: string;
    do name = `word/media/opacity${++n}.png`;
    while (names.includes(name));
    return name;
  };

  for (const part of parts) {
    const relsName = relsOf(part);
    let rels = zip.read(relsName)?.toString('utf8');
    if (!rels) continue;
    const targets = targetsOf(rels, part);
    const ids = new Set([...rels.matchAll(/\bId="([^"]+)"/g)].map((m) => m[1]));
    const ridOf = new Map<string, string>(); // a copy's relationship in this part
    let xml = zip.read(part)!.toString('utf8');
    xml = xml.replace(/<a:blip\b([^>]*?)\br:embed="([^"]+)"([^>]*)>([\s\S]*?)<\/a:blip>/g, (whole, before: string, id: string, after: string, inner: string) => {
      const amt = /<a:alphaModFix\b[^>]*\bamt="(\d+)"[^>]*\/>/.exec(inner);
      const target = targets.get(id);
      if (!amt || !target || !/\.png$/i.test(target)) return whole;
      const key = `${target}|${amt[1]}`;
      let copy = copies.get(key);
      if (!copy) {
        const png = zip.read(target);
        const faded = png && fadedPng(png, Number(amt[1]));
        if (!faded) return whole;
        copy = nextMedia();
        copies.set(key, copy);
        added.push({ name: copy, data: faded, store: true });
      }
      let rid = ridOf.get(copy);
      if (!rid) {
        rid = 'rIdOpacity1';
        for (let k = 2; ids.has(rid); k++) rid = `rIdOpacity${k}`;
        ids.add(rid);
        ridOf.set(copy, rid);
        const relative = copy.slice(part.slice(0, part.lastIndexOf('/') + 1).length);
        rels = rels!.replace('</Relationships>', `<Relationship Id="${rid}" Type="${IMAGE_REL}" Target="${relative}"/></Relationships>`);
      }
      return `<a:blip${before}r:embed="${rid}"${after}>${inner.replace(amt[0], '')}</a:blip>`;
    });
    changed.set(part, xml);
    changed.set(relsName, rels!);
  }
  if (!added.length) return docx;

  const types = zip.read('[Content_Types].xml')?.toString('utf8');
  if (types && !/<Default\b[^>]*\bExtension="png"/i.test(types)) {
    changed.set('[Content_Types].xml', types.replace(/(<Types\b[^>]*>)/, '$1<Default Extension="png" ContentType="image/png"/>'));
  }

  const files: (ZipFile | ZipRawFile)[] = zip.entries.map((e) => {
    const xml = changed.get(e.name);
    return xml === undefined ? { name: e.name, raw: zip.raw(e.name)! } : { name: e.name, data: xml };
  });
  return writeZip([...files, ...added]);
}
