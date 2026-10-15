import { describe, expect, it } from 'vitest';
import { NAV } from '../../../components/nav';
import { apiReason, passFileOn, textResponse } from './file-response';
import { FIELDS_GUIDE_DOCX_HREF, FIELDS_GUIDE_PAGE, FIELDS_GUIDE_PDF_HREF } from './wording';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const GUIDE = `filename="Template Fields Guide.docx"; filename*=UTF-8''Template%20Fields%20Guide.docx`;

const fromApi = (body: string, headers: Record<string, string>) => new Response(body, { headers });

describe('passing a file from the API on to the browser', () => {
  it('saves the Word file, under the name the API sends, with nothing allowed to run in it', async () => {
    const res = passFileOn(fromApi('PK', { 'content-type': DOCX, 'content-disposition': `attachment; ${GUIDE}`, 'content-length': '2' }), false, 'x');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(DOCX);
    expect(res.headers.get('content-disposition')).toBe(`attachment; ${GUIDE}`);
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-length')).toBe('2');
    expect(await res.text()).toBe('PK');
    // an API that says inline still gets the Word file saved
    const inline = passFileOn(fromApi('PK', { 'content-type': DOCX, 'content-disposition': `inline; ${GUIDE}` }), false, 'x');
    expect(inline.headers.get('content-disposition')).toBe(`attachment; ${GUIDE}`);
  });

  it('opens the PDF in the browser, without the header its viewer cannot open under', () => {
    const res = passFileOn(fromApi('%PDF', { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="Template Fields Guide.pdf"' }), true, 'x');
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe('inline; filename="Template Fields Guide.pdf"');
    expect(res.headers.has('content-security-policy')).toBe(false);
  });

  it('names the file when the API does not, and refuses (502) what is not the file asked for', async () => {
    const unnamed = passFileOn(fromApi('PK', { 'content-type': DOCX }), false, 'Template Fields Guide');
    expect(unnamed.headers.get('content-disposition')).toBe('attachment; filename="Template Fields Guide.docx"');
    const wrong = passFileOn(fromApi('<html>', { 'content-type': 'text/html' }), true, 'x');
    expect(wrong.status).toBe(502);
    expect(await wrong.text()).toBe('This file could not be loaded. Please try again.');
  });

  it('says the API’s reason as text, or the fallback', async () => {
    const message = "The PDF converter isn't set up on the server, so there is no preview: download the Word file instead.";
    expect(await apiReason(Response.json({ message }, { status: 409 }), 'fallback')).toBe(message);
    expect(await apiReason(Response.json({ message: ['One.', 'Two.'] }), 'fallback')).toBe('One. Two.');
    expect(await apiReason(new Response('not json'), 'fallback')).toBe('fallback');
    const text = textResponse(message, 409);
    expect([text.status, text.headers.get('content-type'), await text.text()]).toEqual([409, 'text/plain; charset=utf-8', message]);
  });
});

describe('the Fields Guide’s links', () => {
  it('downloads the Word file and opens the PDF from the route under Templates, and the sidebar names its page', () => {
    expect(FIELDS_GUIDE_DOCX_HREF).toBe('/templates/fields-guide');
    expect(FIELDS_GUIDE_PDF_HREF).toBe('/templates/fields-guide?format=pdf');
    expect(NAV.find((n) => n.href === '/templates')?.items?.find((s) => s.label === 'Fields Guide')?.href).toBe(FIELDS_GUIDE_PAGE);
  });
});
