import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

// Where signing in sends someone (with the password, or the fingerprint in the app: 20 October 2026): only back to one
// of this site's own pages.

describe('safeNext', () => {
  it('goes back to a page of this site', () => {
    expect(safeNext('/app/requests?kind=leave', '/app')).toBe('/app/requests?kind=leave');
    expect(safeNext('/employees/abc', '/')).toBe('/employees/abc');
    expect(safeNext('/', '/app')).toBe('/');
  });

  it('goes home with nowhere to go back to', () => {
    for (const value of [null, undefined, '', 7, ['/app']]) expect(safeNext(value, '/app')).toBe('/app');
  });

  it('never sends anyone to another site, or back to the sign-in page', () => {
    for (const value of ['https://evil.example', '//evil.example', '/\\evil.example', 'evil.example/app', 'javascript:alert(1)', '/login', '/login?next=/app']) {
      expect(safeNext(value, '/')).toBe('/');
    }
  });
});
