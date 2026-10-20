import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip';

// The visitor's IP address as the website sees it (a job offer's answer, a sign-in, a check-in's office network check).

const headersOf = (entries: Record<string, string>) => new Headers(entries);

describe('the visitor’s address', () => {
  it('takes the first address the proxy forwarded', () => {
    expect(clientIp(headersOf({ 'x-forwarded-for': '41.33.10.2, 10.0.0.5', 'x-real-ip': '10.0.0.5' }))).toBe('41.33.10.2');
    expect(clientIp(headersOf({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
    expect(clientIp(headersOf({ 'x-forwarded-for': '::ffff:41.33.10.2' }))).toBe('::ffff:41.33.10.2');
  });

  it('falls back to x-real-ip, and ignores what is not an address', () => {
    expect(clientIp(headersOf({ 'x-real-ip': '197.45.1.9' }))).toBe('197.45.1.9');
    expect(clientIp(headersOf({ 'x-forwarded-for': 'unknown', 'x-real-ip': '197.45.1.9' }))).toBe('197.45.1.9');
    expect(clientIp(headersOf({ 'x-forwarded-for': '<script>' }))).toBeUndefined();
    expect(clientIp(headersOf({}))).toBeUndefined();
  });
});
