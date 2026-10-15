import { describe, expect, it } from 'vitest';
import { isPublicPath } from './public-paths';

describe('pages open without signing in', () => {
  it('are the sign-in page and the company logo', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/company-logo')).toBe(true);
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('/employees')).toBe(false);
  });

  it("include a candidate's job offer and its document, but not HR's offers", () => {
    expect(isPublicPath('/offer/Xy3_k-9aBcDeFgHiJkLmNoPq')).toBe(true);
    expect(isPublicPath('/offer/Xy3_k-9aBcDeFgHiJkLmNoPq/document')).toBe(true);
    expect(isPublicPath('/offer')).toBe(false);
    expect(isPublicPath('/offers')).toBe(false);
    expect(isPublicPath('/offers/0b6f6c1e-7a5e-4a63-9d43-2f1f7f0e0c11')).toBe(false);
    expect(isPublicPath('/offers/new')).toBe(false);
  });
});
