import { describe, expect, it } from 'vitest';
import { assetQrSvg } from './asset-qr';

// An asset's QR code (spec §5), drawn on the server as SVG.

describe("an asset's QR code", () => {
  it('is an SVG sized by its box, a different one for each code', async () => {
    const svg = await assetQrSvg('PK-CAM-0001');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
    expect(svg).not.toMatch(/<svg[^>]*\swidth=/);
    expect(await assetQrSvg('PK-CAM-0002')).not.toBe(svg);
    expect(await assetQrSvg('PK-CAM-0001')).toBe(svg);
  });
});
