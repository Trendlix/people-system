import { contentDisposition, detectPaperworkType, safeFileName } from './paperwork-file.js';

describe('paperwork files', () => {
  it('identifies JPEG, PNG, WebP and PDF by their first bytes, and nothing else', () => {
    expect(detectPaperworkType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(detectPaperworkType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(detectPaperworkType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(detectPaperworkType(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
    expect(detectPaperworkType(Buffer.from('just text, renamed .png'))).toBeNull();
    expect(detectPaperworkType(Buffer.from('<svg onload="alert(1)"></svg>'))).toBeNull();
    expect(detectPaperworkType(Buffer.alloc(0))).toBeNull();
  });

  it('keeps the name but drops folders, hidden and reserved characters', () => {
    expect(safeFileName('../../etc/passwd', 'image/png')).toBe('passwd.png');
    expect(safeFileName('C:\\Users\\hr\\بطاقة أمامية.JPG', 'image/jpeg')).toBe('بطاقة أمامية.jpg');
    expect(safeFileName('\u202egpj.exe', 'image/png')).toBe('gpj.exe.png'); // direction override removed
    expect(safeFileName('form<1>: "copy"?.pdf', 'application/pdf')).toBe('form_1_ _copy_.pdf');
    expect(safeFileName('  .hidden  ', 'image/webp')).toBe('hidden.webp');
    expect(safeFileName(undefined, 'image/webp')).toBe('document.webp');
  });

  it('gives the name the extension of what the file really is', () => {
    expect(safeFileName('scan.png', 'application/pdf')).toBe('scan.pdf');
    expect(safeFileName('contract v2', 'application/pdf')).toBe('contract v2.pdf');
    expect(safeFileName('photo.jpeg', 'image/jpeg')).toBe('photo.jpeg');
  });

  it('shortens long names to 120 characters, keeping the extension', () => {
    const name = safeFileName(`${'ش'.repeat(300)}.pdf`, 'application/pdf');
    expect(Array.from(name).length).toBe(120);
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it('sends the name in a header every browser reads safely', () => {
    expect(contentDisposition('scan.pdf')).toBe(`inline; filename="scan.pdf"; filename*=UTF-8''scan.pdf`);
    expect(contentDisposition('بطاقة (1).png')).toBe(
      `inline; filename="_ (1).png"; filename*=UTF-8''%D8%A8%D8%B7%D8%A7%D9%82%D8%A9%20%281%29.png`,
    );
    expect(contentDisposition('a"b\\c.pdf')).toBe(`inline; filename="a_b_c.pdf"; filename*=UTF-8''a%22b%5Cc.pdf`);
  });
});
