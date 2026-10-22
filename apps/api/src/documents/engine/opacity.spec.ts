import pngjs from 'pngjs';
import { readFileSync } from 'node:fs';
import { readZip, writeZip } from '../../templates/zip.js';
import { bakeImageOpacity, fadedPng } from './opacity.js';

// The watermark's transparency kept in the PDF (22 October 2026): the contract's TrendLIX watermark, 15% opaque in Word,
// came out of LibreOffice solid; it is baked into a copy of the PNG before converting.

const { PNG } = pngjs;

/** A PNG of `w` × 1 pixels, each red with this alpha. */
function png(w: number, alpha = 255): Buffer {
  const image = new PNG({ width: w, height: 1 });
  for (let i = 0; i < w; i++) image.data.set([255, 0, 0, alpha], i * 4);
  return PNG.sync.write(image);
}
const alphas = (data: Buffer) => {
  const image = PNG.sync.read(data);
  return [...image.data].filter((_, i) => i % 4 === 3);
};

const blip = (id: string, extra = '') => `<pic:blipFill><a:blip r:embed="${id}">${extra}<a:extLst/></a:blip></pic:blipFill>`;
const docx = (header: string, rels: string, media: Record<string, Buffer>, types = '<Types xmlns="t"><Default Extension="xml" ContentType="application/xml"/></Types>') =>
  writeZip([
    { name: '[Content_Types].xml', data: types },
    { name: 'word/document.xml', data: '<w:document><w:body/></w:document>' },
    { name: 'word/header1.xml', data: `<w:hdr>${header}</w:hdr>` },
    { name: 'word/_rels/header1.xml.rels', data: `<Relationships xmlns="r">${rels}</Relationships>` },
    ...Object.entries(media).map(([name, data]) => ({ name, data })),
  ]);
const rel = (id: string, target: string, extra = '') => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"${extra}/>`;

describe('a picture’s transparency baked in', () => {
  it('fades a PNG’s pixels by the amount', () => {
    expect(alphas(fadedPng(png(2), 15000)!)).toEqual([38, 38]);
    expect(alphas(fadedPng(png(1, 100), 50000)!)).toEqual([50]);
    expect(fadedPng(Buffer.from('not a png'), 15000)).toBeNull();
  });

  it('points a faded picture to a faded copy and takes the setting off; the original and the others stay', () => {
    const file = docx(
      blip('rId1', '<a:alphaModFix amt="15000"/>') + blip('rId1') + blip('rId2', '<a:alphaModFix amt="15000"/>') + blip('rId1', '<a:alphaModFix amt="15000"/>'),
      rel('rId1', 'media/image1.png') + rel('rId2', 'media/image2.jpeg') + '<Relationship Id="rIdOpacity1" Type="x" Target="http://x" TargetMode="External"/>',
      { 'word/media/image1.png': png(2), 'word/media/image2.jpeg': Buffer.from('jpeg') },
    );
    const zip = readZip(bakeImageOpacity(file));
    const header = zip.read('word/header1.xml')!.toString('utf8');
    // both faded uses of image1 share one copy and one relationship (not the external one's id); the JPEG keeps its setting
    expect(header).toBe(
      `<w:hdr>${blip('rIdOpacity2')}${blip('rId1')}${blip('rId2', '<a:alphaModFix amt="15000"/>')}${blip('rIdOpacity2')}</w:hdr>`,
    );
    expect(zip.read('word/_rels/header1.xml.rels')!.toString('utf8')).toContain(rel('rIdOpacity2', 'media/opacity1.png'));
    expect(alphas(zip.read('word/media/opacity1.png')!)).toEqual([38, 38]);
    expect(alphas(zip.read('word/media/image1.png')!)).toEqual([255, 255]);
    expect(zip.read('[Content_Types].xml')!.toString('utf8')).toContain('<Default Extension="png" ContentType="image/png"/>');
  });

  it('gives the same file back when no picture has a transparency', () => {
    const file = docx(blip('rId1'), rel('rId1', 'media/image1.png'), { 'word/media/image1.png': png(1) });
    expect(bakeImageOpacity(file)).toBe(file);
  });

  it('bakes the real contract’s watermark', () => {
    const zip = readZip(bakeImageOpacity(readFileSync(new URL('../../../test/fixtures/TrendLIX_Contract_TEMPLATE.docx', import.meta.url))));
    const header = zip.read('word/header1.xml')!.toString('utf8');
    expect(header).not.toContain('alphaModFix');
    expect(zip.has('word/media/opacity1.png')).toBe(true);
    expect(alphas(zip.read('word/media/opacity1.png')!).reduce((top, a) => Math.max(top, a), 0)).toBeLessThanOrEqual(39);
  });
});
