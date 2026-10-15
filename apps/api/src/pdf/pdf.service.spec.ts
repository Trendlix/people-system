import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, type PDFRef } from '@cantoo/pdf-lib';
import { CONTENT, convertedPdf, encryptionOf, FONT_PROGRAM, hasEncrypt, LANG, LINK, streamBytes, TITLE, TO_UNICODE } from '../../test/fixtures/pdf.js';
import { PdfService, protectPdf } from './pdf.service.js';

// Filled documents leave the system only as protected PDFs (owner's request, 15 October 2026: "No doc file export,
// just a protected PDF"): the converter's PDF re-saved encrypted, unchanged otherwise.

const PRINT = 1 << 2;
const MODIFY = 1 << 3;
const COPY = 1 << 4;
const ANNOTATE = 1 << 5;
const FILL_FORMS = 1 << 8;
const ACCESSIBILITY = 1 << 9;
const ASSEMBLE = 1 << 10;
const PRINT_HIGH = 1 << 11;

/** A string's text, written plain or (once encrypted) in hex. */
const text = (dict: PDFDict, key: string) => dict.lookup(PDFName.of(key), PDFString, PDFHexString).decodeText();

const service = (url?: string) => new PdfService({ get: () => url } as unknown as ConfigService);

/** The page's resources, as the protected file has them. */
function pageParts(doc: PDFDocument) {
  const page = doc.getPage(0).node;
  const resources = page.Resources()!;
  const font = resources.lookup(PDFName.of('Font'), PDFDict).lookup(PDFName.of('F1'), PDFDict);
  const cid = font.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
  const descriptor = cid.lookup(PDFName.of('FontDescriptor'), PDFDict);
  const picture = resources.lookup(PDFName.of('XObject'), PDFDict).get(PDFName.of('Im1')) as PDFRef;
  const link = page.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict).lookup(PDFName.of('A'), PDFDict);
  return {
    contents: page.get(PDFName.of('Contents')) as PDFRef,
    fontFile: descriptor.get(PDFName.of('FontFile2')) as PDFRef,
    toUnicode: font.get(PDFName.of('ToUnicode')) as PDFRef,
    registry: text(cid.lookup(PDFName.of('CIDSystemInfo'), PDFDict), 'Registry'),
    picture,
    uri: text(link, 'URI'),
  };
}

describe('a protected PDF', () => {
  let source: Buffer;
  let protectedPdf: Buffer;

  beforeAll(async () => {
    source = await convertedPdf();
    protectedPdf = await protectPdf(source);
  });

  it('is encrypted with AES-256 (revision 6), named in its trailer', async () => {
    expect(hasEncrypt(source)).toBe(false);
    expect(hasEncrypt(protectedPdf)).toBe(true);
    expect(protectedPdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const { V, R, CFM } = await encryptionOf(protectedPdf);
    expect({ V, R, CFM }).toEqual({ V: 5, R: 6, CFM: '/AESV3' });
    // the library refuses to read it without decrypting it
    await expect(PDFDocument.load(protectedPdf)).rejects.toThrow();
  });

  it('may be printed (at full quality), and not changed, copied, annotated, filled in or reassembled', async () => {
    const { P } = await encryptionOf(protectedPdf);
    expect(P & PRINT).toBe(PRINT);
    expect(P & PRINT_HIGH).toBe(PRINT_HIGH);
    for (const denied of [MODIFY, COPY, ANNOTATE, FILL_FORMS, ASSEMBLE]) expect(P & denied).toBe(0);
    // read aloud by screen readers, as ISO 32000-2 asks: nothing is copied
    expect(P & ACCESSIBILITY).toBe(ACCESSIBILITY);
  });

  it('opens without a password, its pages, fonts, Arabic text, picture, title, language and link unchanged', async () => {
    const before = await PDFDocument.load(source, { updateMetadata: false });
    const after = await PDFDocument.load(protectedPdf, { password: '', updateMetadata: false });
    expect(after.getPageCount()).toBe(1);
    expect(after.getPage(0).getSize()).toEqual({ width: 595, height: 842 });
    expect(after.getTitle()).toBe(TITLE);
    expect(after.getProducer()).toBe('LibreOffice 7.4');
    expect(text(after.catalog, 'Lang')).toBe(LANG);

    const was = pageParts(before);
    const now = pageParts(after);
    expect(streamBytes(after, now.contents).toString('latin1')).toBe(CONTENT);
    expect(streamBytes(after, now.fontFile)).toEqual(FONT_PROGRAM);
    expect(streamBytes(after, now.toUnicode).toString('latin1')).toBe(TO_UNICODE);
    expect(streamBytes(after, now.picture)).toEqual(streamBytes(before, was.picture));
    expect(now.registry).toBe('Adobe');
    expect(now.uri).toBe(LINK);
  });

  it('keeps nothing readable outside the encryption: the strings and streams are encrypted', () => {
    const raw = protectedPdf.toString('latin1');
    for (const plain of [LANG, LINK, 'LibreOffice', 'beginbfchar', 'Adobe']) expect(raw).not.toContain(plain);
    // written object by object, the cross-reference table at the end
    expect(raw).not.toContain('/ObjStm');
    expect(raw).toMatch(/xref\s+0 \d+/);
  });

  it('has its own owner password each time', async () => {
    const again = await protectPdf(source);
    expect((await encryptionOf(again)).O).not.toBe((await encryptionOf(protectedPdf)).O);
  });
});

describe('PdfService', () => {
  it('converts a filled document and protects the PDF', async () => {
    const pdf = service('http://converter');
    const convert = vi.spyOn(pdf, 'fromDocx').mockResolvedValue(await convertedPdf());
    const file = await pdf.protectedFile({ data: Buffer.from('docx'), fileName: 'Contract - E-0001 - Omar.docx' });
    expect(convert).toHaveBeenCalledWith(Buffer.from('docx'), 'Contract - E-0001 - Omar.docx');
    expect(file.type).toBe('application/pdf');
    expect(file.fileName).toBe('Contract - E-0001 - Omar.pdf');
    expect(hasEncrypt(file.data)).toBe(true);
    expect((await PDFDocument.load(file.data, { password: '' })).getTitle()).toBe(TITLE);
  });

  it('gives no filled document without a converter (409), and none it could not protect (503)', async () => {
    const none = service();
    expect(none.available).toBe(false);
    expect(await none.protectedFromDocx(Buffer.from('docx'))).toBeNull();
    await expect(none.protectedFile({ data: Buffer.from('docx'), fileName: 'a.docx' })).rejects.toBeInstanceOf(ConflictException);

    const broken = service('http://converter');
    vi.spyOn(broken, 'fromDocx').mockResolvedValue(Buffer.from('not a PDF'));
    await expect(broken.protectedFromDocx(Buffer.from('docx'), 'a.docx')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("previews HR's own Word files as they are, unprotected", async () => {
    const pdf = service('http://converter');
    const plain = await convertedPdf();
    vi.spyOn(pdf, 'fromDocx').mockResolvedValue(plain);
    const shown = await pdf.preview({ data: Buffer.from('docx'), fileName: 'Template v1.docx' });
    expect(shown).toEqual({ data: plain, type: 'application/pdf', fileName: 'Template v1.pdf' });
  });
});
