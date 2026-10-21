import {
  ASSET_PRODUCT_IMAGES_MAX,
  imageInfo,
  imageSizeProblem,
  imageTypeOf,
  looksLikeSvg,
  PRODUCT_IMAGE_RULES,
  productImageHost,
  productImageLabel,
  productImageProblem,
  productImageUrlProblem,
} from '@trendlix/shared';
import { GIF, jpegOf, pngOf, SVG, webpOf } from '../../test/fixtures/images.js';

// The product images Claude adds to a draft (owner, 21 October 2026: "let the mcp connector fetch the product photo and
// add it / yes build it"; packages/shared product-images.ts): the website and the API check the same bytes with it.

describe('a product image’s bytes', () => {
  it('knows a JPEG, PNG and WebP by their magic numbers, and nothing else', () => {
    expect(imageTypeOf(pngOf(120, 100))).toBe('image/png');
    expect(imageTypeOf(jpegOf(640, 480))).toBe('image/jpeg');
    expect(imageTypeOf(webpOf('VP8 ', 300, 200))).toBe('image/webp');
    expect(imageTypeOf(GIF)).toBeNull();
    expect(imageTypeOf(SVG)).toBeNull();
    expect(imageTypeOf(Buffer.from('<html><body>not an image</body></html>'))).toBeNull();
    expect(imageTypeOf(new Uint8Array(0))).toBeNull();
  });

  it('reads the size of each: the PNG header, the JPEG frame, the three WebP kinds', () => {
    expect(imageInfo(pngOf(321, 123))).toEqual({ type: 'image/png', width: 321, height: 123 });
    expect(imageInfo(jpegOf(4000, 3000))).toEqual({ type: 'image/jpeg', width: 4000, height: 3000 });
    expect(imageInfo(webpOf('VP8 ', 1600, 900))).toEqual({ type: 'image/webp', width: 1600, height: 900 });
    expect(imageInfo(webpOf('VP8L', 1024, 768))).toEqual({ type: 'image/webp', width: 1024, height: 768 });
    expect(imageInfo(webpOf('VP8X', 8000, 5000))).toEqual({ type: 'image/webp', width: 8000, height: 5000 });
    // a JPEG cut off before its frame header has no size
    expect(imageInfo(jpegOf(640, 480).subarray(0, 22))).toBeNull();
  });

  it('refuses SVG by name, as it can carry scripts', () => {
    expect(looksLikeSvg(SVG)).toBe(true);
    expect(looksLikeSvg(Buffer.from('﻿  <svg viewBox="0 0 1 1"/>'))).toBe(true);
    expect(looksLikeSvg(pngOf(120, 120))).toBe(false);
    expect(productImageProblem(SVG)).toEqual({ problem: expect.stringMatching(/SVG/) });
  });

  it('keeps 100 to 8000 pixels a side, at most 5 MB', () => {
    expect(productImageProblem(pngOf(100, 100))).toEqual({ type: 'image/png', width: 100, height: 100 });
    expect(productImageProblem(pngOf(99, 400))).toEqual({ problem: 'The image is 99 × 400 pixels: each side must be at least 100.' });
    expect(productImageProblem(webpOf('VP8X', 8001, 200))).toEqual({ problem: 'The image is 8001 × 200 pixels: each side must be at most 8000.' });
    expect(imageSizeProblem(8000, 8000)).toBeNull();
    const big = Buffer.concat([jpegOf(1000, 1000), Buffer.alloc(PRODUCT_IMAGE_RULES.maxBytes)]);
    expect(productImageProblem(big)).toEqual({ problem: 'The image is larger than 5 MB.' });
    expect(productImageProblem(GIF)).toEqual({ problem: 'The link is not a JPEG, PNG or WebP image.' });
    expect(productImageProblem(new Uint8Array(0))).toEqual({ problem: 'The image is empty.' });
  });
});

describe('a product image’s links', () => {
  it('keeps https links only, without a user name or password', () => {
    expect(productImageUrlProblem('https://www.sony.com/fx3.jpg', 'The image link')).toBeNull();
    expect(productImageUrlProblem('http://www.sony.com/fx3.jpg', 'The image link')).toBe('The image link must be an https:// link.');
    expect(productImageUrlProblem('https://me:secret@sony.com/fx3.jpg', 'The image link')).toBe('The image link must not carry a user name or password.');
    expect(productImageUrlProblem('javascript:alert(1)', 'The source page')).toBe('The source page must be an https:// link.');
    expect(productImageUrlProblem('not a link', 'The source page')).toBe('The source page is not a link.');
    expect(productImageUrlProblem('', 'The source page')).toBe('The source page is missing.');
    expect(productImageUrlProblem(`https://sony.com/${'a'.repeat(2000)}`, 'The image link')).toMatch(/longer than 2000/);
  });

  it('labels each by its source page’s host, without www.', () => {
    expect(productImageHost('https://www.Sony.com/electronics/fx3')).toBe('sony.com');
    expect(productImageHost('https://store.canon.com.eg/r5')).toBe('store.canon.com.eg');
    expect(productImageHost('nonsense')).toBeNull();
    expect(productImageLabel('sony.com')).toBe('Product image · from sony.com');
    expect(ASSET_PRODUCT_IMAGES_MAX).toBe(3);
  });
});
