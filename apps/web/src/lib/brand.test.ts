import { describe, expect, it } from 'vitest';
import { brandMark, FAVICON, logoUrl, tabIcons, thumbnailUrl } from './brand';

describe('the company images', () => {
  it('are asked for with their version, so a new upload is never hidden by a cached one', () => {
    expect(logoUrl(1760540000000)).toBe('/company-logo?v=1760540000000');
    expect(thumbnailUrl(1760540000000)).toBe('/company-thumbnail?v=1760540000000');
    // the company profile's upload time
    expect(thumbnailUrl('2026-10-15T09:30:00.000Z')).toBe('/company-thumbnail?v=2026-10-15T09%3A30%3A00.000Z');
  });
});

describe('the company mark', () => {
  it('is the logo where it has room, and the thumbnail where it has not', () => {
    expect(brandMark({ logoVersion: 1, thumbnailVersion: 2 })).toEqual({ full: '/company-logo?v=1', compact: '/company-thumbnail?v=2' });
  });

  it('falls back on the other image when one is missing', () => {
    expect(brandMark({ logoVersion: null, thumbnailVersion: 2 })).toEqual({ full: '/company-thumbnail?v=2', compact: '/company-thumbnail?v=2' });
    expect(brandMark({ logoVersion: 1, thumbnailVersion: null })).toEqual({ full: '/company-logo?v=1', compact: '/company-logo?v=1' });
  });

  it('is no image without either (the initial is shown)', () => {
    expect(brandMark({ logoVersion: null, thumbnailVersion: null })).toEqual({ full: null, compact: null });
  });
});

describe('the browser tab icon', () => {
  it('is the thumbnail when there is one, else the People System favicon', () => {
    expect(tabIcons({ thumbnailVersion: 7 })).toEqual({ icon: '/company-thumbnail?v=7' });
    expect(tabIcons({ thumbnailVersion: null })).toEqual({ icon: FAVICON });
    expect(FAVICON).toBe('/favicon.ico');
  });
});
