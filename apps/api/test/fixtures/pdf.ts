import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFString, type PDFRef } from '@cantoo/pdf-lib';

// PDFs for the tests of protected documents (owner's request, 15 October 2026: "No doc file export, just a protected
// PDF"). The converter (Gotenberg) can't run here, so a PDF shaped like LibreOffice's is built with the library: an
// embedded TrueType font drawn by glyph number with a ToUnicode map back to the Arabic letters, a picture, an Arabic
// title, the document's language and a link, each of which must come through protection unchanged.

/** A 1×1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** The font program embedded (any bytes do: only that they come through unchanged is checked). */
export const FONT_PROGRAM = Buffer.from('\x00\x01\x00\x00 a TrueType subset, as LibreOffice embeds it', 'latin1');

/** Glyphs 1–3 are ع, ق, د; the page shows "عقد" (drawn right to left: د ق ع). */
export const TO_UNICODE = [
  '/CIDInit /ProcSet findresource begin',
  '12 dict begin',
  'begincmap',
  '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
  '/CMapName /Adobe-Identity-UCS def',
  '/CMapType 2 def',
  '1 begincodespacerange',
  '<0000> <FFFF>',
  'endcodespacerange',
  '3 beginbfchar',
  '<0001> <0639>',
  '<0002> <0642>',
  '<0003> <062F>',
  'endbfchar',
  'endcmap',
  'CMapName currentdict /CMap defineresource pop',
  'end',
  'end',
].join('\n');

export const CONTENT = 'BT /F1 14 Tf 72 720 Td <000300020001> Tj ET\nq 120 0 0 120 72 520 cm /Im1 Do Q';
export const TITLE = 'عقد عمل - عمر خالد محمود';
export const LANG = 'ar-EG';
export const LINK = 'mailto:hr@trendlix.com';

/** A one-page PDF as the converter might make it (see above). */
export async function convertedPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const { context } = doc;
  doc.setTitle(TITLE);
  doc.setProducer('LibreOffice 7.4');
  doc.catalog.set(PDFName.of('Lang'), PDFString.of(LANG));

  const fontFile = context.register(context.flateStream(FONT_PROGRAM, { Length1: FONT_PROGRAM.length }));
  const toUnicode = context.register(context.flateStream(TO_UNICODE));
  const descriptor = context.register(
    context.obj({ Type: 'FontDescriptor', FontName: 'BAAAAA+Arial', Flags: 4, FontBBox: [-664, -324, 2000, 1005], ItalicAngle: 0, Ascent: 905, Descent: -212, CapHeight: 716, StemV: 80, FontFile2: fontFile }),
  );
  const cidFont = context.register(
    context.obj({
      Type: 'Font',
      Subtype: 'CIDFontType2',
      BaseFont: 'BAAAAA+Arial',
      CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
      FontDescriptor: descriptor,
      DW: 1000,
      CIDToGIDMap: 'Identity',
    }),
  );
  const font = context.register(context.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'BAAAAA+Arial', Encoding: 'Identity-H', DescendantFonts: [cidFont], ToUnicode: toUnicode }));

  const picture = await doc.embedPng(PNG);
  const page = doc.addPage([595, 842]);
  page.node.setFontDictionary(PDFName.of('F1'), font);
  page.node.setXObject(PDFName.of('Im1'), picture.ref);
  page.node.set(PDFName.of('Contents'), context.register(context.flateStream(CONTENT)));
  const link = context.register(context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [72, 700, 200, 740], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(LINK) } }));
  page.node.set(PDFName.of('Annots'), context.obj([link]));
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** A stream's bytes, decoded. */
export function streamBytes(doc: PDFDocument, ref: PDFRef | undefined): Buffer {
  const stream = doc.context.lookup(ref);
  if (!(stream instanceof PDFRawStream)) throw new Error('Not a stream.');
  return Buffer.from(decodePDFRawStream(stream).decode());
}

/** The protected PDF's encryption dictionary, read without decrypting anything (as a viewer reads it first). */
export async function encryptionOf(pdf: Uint8Array): Promise<{ V: number; R: number; P: number; CFM: string | undefined; O: string }> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
  const encrypt = doc.context.lookup(doc.context.trailerInfo.Encrypt, PDFDict);
  const num = (key: string) => encrypt.lookup(PDFName.of(key), PDFNumber).asNumber();
  const filter = encrypt.lookupMaybe(PDFName.of('CF'), PDFDict)?.lookupMaybe(PDFName.of('StdCF'), PDFDict);
  return { V: num('V'), R: num('R'), P: num('P'), CFM: filter?.lookupMaybe(PDFName.of('CFM'), PDFName)?.asString(), O: String(encrypt.get(PDFName.of('O'))) };
}

/** Whether the file's trailer names an encryption dictionary. */
export function hasEncrypt(pdf: Uint8Array): boolean {
  return /trailer\s*<<[^]*?\/Encrypt\s+\d+\s+\d+\s+R/.test(Buffer.from(pdf).toString('latin1'));
}
