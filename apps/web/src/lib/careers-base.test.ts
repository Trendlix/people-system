import { describe, expect, it } from 'vitest';
import { careersBaseFrom, careersBaseOfRequest } from './careers-base';

// The careers pages' public address (25 October 2026: moving to the main site's /careers): CAREERS_BASE_URL when set,
// else this site's own address and /careers. The hosts here are made up.

const headers = (h: Record<string, string>) => new Headers(h);

describe('the careers base on the website', () => {
  it('is the address set, else this site’s own and /careers', () => {
    expect(careersBaseFrom(headers({ 'x-forwarded-host': 'app.example.test', 'x-forwarded-proto': 'https' }), 'https://www.example.test/careers')).toBe('https://www.example.test/careers');
    expect(careersBaseFrom(headers({ 'x-forwarded-host': 'app.example.test', 'x-forwarded-proto': 'https' }), undefined)).toBe('https://app.example.test/careers');
    expect(careersBaseFrom(headers({}), undefined)).toBeNull();
  });

  it('falls back to the request’s own address in a route handler', () => {
    expect(careersBaseOfRequest(new Request('http://localhost:3000/careers/linkedin/start'), undefined)).toBe('http://localhost:3000/careers');
    expect(careersBaseOfRequest(new Request('http://localhost:3000/careers/linkedin/start'), 'https://www.example.test/careers')).toBe('https://www.example.test/careers');
  });
});
