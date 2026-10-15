import { describe, expect, it } from 'vitest';
import { passPdfOn, pdfFileName, PROTECTED_PDF_HINT, wantsDownload } from './protected-pdf';

const NAMED = `filename="Job Offer.pdf"; filename*=UTF-8''Job%20Offer.pdf`;
const fromApi = (body: string, headers: Record<string, string>) => new Response(body, { headers });

describe('a filled document, given only as a protected PDF', () => {
  it('opens in the browser, under the name the API sends', async () => {
    const res = passPdfOn(fromApi('%PDF', { 'content-type': 'application/pdf', 'content-disposition': `attachment; ${NAMED}`, 'content-length': '4' }), {
      download: false,
      fallbackName: 'x.pdf',
    })!;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(`inline; ${NAMED}`);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-length')).toBe('4');
    // the browser's PDF viewer doesn't open under default-src 'none'
    expect(res.headers.has('content-security-policy')).toBe(false);
    expect(await res.text()).toBe('%PDF');
  });

  it('is saved when asked (?download=1), named when the API does not, with the headers added', () => {
    const saved = passPdfOn(fromApi('%PDF', { 'content-type': 'application/pdf; charset=binary', 'content-disposition': `inline; ${NAMED}` }), {
      download: true,
      fallbackName: 'x.pdf',
    })!;
    expect(saved.headers.get('content-disposition')).toBe(`attachment; ${NAMED}`);
    const unnamed = passPdfOn(fromApi('%PDF', { 'content-type': 'application/pdf' }), { download: false, fallbackName: 'job-offer.pdf', headers: { 'x-robots-tag': 'noindex' } })!;
    expect(unnamed.headers.get('content-disposition')).toBe('inline; filename="job-offer.pdf"');
    expect(unnamed.headers.get('x-robots-tag')).toBe('noindex');
    // a compressed body is unpacked on the way: its length no longer holds
    const packed = passPdfOn(fromApi('%PDF', { 'content-type': 'application/pdf', 'content-length': '3', 'content-encoding': 'gzip' }), { download: false, fallbackName: 'x.pdf' })!;
    expect(packed.headers.has('content-length')).toBe(false);
  });

  it('is never anything else: a Word file or a page is not passed on', () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    expect(passPdfOn(fromApi('PK', { 'content-type': docx }), { download: true, fallbackName: 'x.pdf' })).toBeNull();
    expect(passPdfOn(fromApi('PK', { 'content-type': 'application/octet-stream' }), { download: true, fallbackName: 'x.pdf' })).toBeNull();
    expect(passPdfOn(fromApi('<html>', { 'content-type': 'text/html' }), { download: false, fallbackName: 'x.pdf' })).toBeNull();
    expect(passPdfOn(fromApi('', {}), { download: false, fallbackName: 'x.pdf' })).toBeNull();
  });

  it('reads ?download=1, and names a kept Word file as its PDF', () => {
    expect(wantsDownload(new URLSearchParams('download=1'))).toBe(true);
    expect(wantsDownload(new URLSearchParams('employeeId=e1&download=1'))).toBe(true);
    expect(wantsDownload(new URLSearchParams('download=true'))).toBe(true);
    expect(wantsDownload(new URLSearchParams(''))).toBe(false);
    expect(wantsDownload(new URLSearchParams('download=0'))).toBe(false);
    expect(wantsDownload(new URLSearchParams('format=docx'))).toBe(false);
    expect(pdfFileName('Employment Contract - EMP-0001 - Omar Khaled.docx')).toBe('Employment Contract - EMP-0001 - Omar Khaled.pdf');
    expect(pdfFileName('Offer.DOCX')).toBe('Offer.pdf');
    expect(pdfFileName('Offer.pdf')).toBe('Offer.pdf');
    expect(PROTECTED_PDF_HINT).toBe("Documents are protected PDFs: they open and print, but can't be edited.");
  });
});
