import { describe, expect, it } from 'vitest';
import { acceptBody, asShown, candidateView, clientIp, declineBody, isOfferToken, userAgentOf } from './candidate';

const headersOf = (entries: Record<string, string>) => new Headers(entries);

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.append(key, value);
  return fd;
}

describe("the link's token", () => {
  it('takes URL-safe tokens only', () => {
    expect(isOfferToken('Xy3_k-9aBcDeFgHiJkLmNoPqRsTuVwXyZ012345678')).toBe(true);
    expect(isOfferToken('short')).toBe(false);
    expect(isOfferToken('../../api/offers/xxxxxxxxxxxx')).toBe(false);
    expect(isOfferToken('abc def ghi jkl mno pqr')).toBe(false);
    expect(isOfferToken('a'.repeat(201))).toBe(false);
  });
});

describe('what the page shows', () => {
  it('lets a sent offer be answered, and says why the others cannot', () => {
    expect(candidateView('sent')).toBe('open');
    expect(candidateView('accepted')).toBe('accepted');
    expect(candidateView('declined')).toBe('declined');
    expect(candidateView('withdrawn')).toBe('withdrawn');
    expect(candidateView('expired')).toBe('expired');
    expect(candidateView('draft')).toBe('invalid');
    expect(candidateView('something new')).toBe('invalid');
  });
});

describe('who answered', () => {
  it('takes the first address the proxy forwarded', () => {
    expect(clientIp(headersOf({ 'x-forwarded-for': '41.33.10.2, 10.0.0.5', 'x-real-ip': '10.0.0.5' }))).toBe('41.33.10.2');
    expect(clientIp(headersOf({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
  });

  it('falls back to x-real-ip, and ignores what is not an address', () => {
    expect(clientIp(headersOf({ 'x-real-ip': '197.45.1.9' }))).toBe('197.45.1.9');
    expect(clientIp(headersOf({ 'x-forwarded-for': 'unknown', 'x-real-ip': '197.45.1.9' }))).toBe('197.45.1.9');
    expect(clientIp(headersOf({ 'x-forwarded-for': '<script>' }))).toBeUndefined();
    expect(clientIp(headersOf({}))).toBeUndefined();
  });

  it('keeps the browser, up to 500 characters', () => {
    expect(userAgentOf(headersOf({ 'user-agent': ' Mozilla/5.0 (iPhone) ' }))).toBe('Mozilla/5.0 (iPhone)');
    expect(userAgentOf(headersOf({ 'user-agent': 'x'.repeat(600) }))).toHaveLength(500);
    expect(userAgentOf(headersOf({}))).toBeUndefined();
  });
});

describe('the answer forms', () => {
  it('accepts with the name typed and the box ticked', () => {
    const errors: string[] = [];
    expect(acceptBody(form({ name: '  Omar   Khaled  ', agree: 'yes' }), errors)).toEqual({ name: 'Omar Khaled' });
    expect(errors).toEqual([]);
  });

  it('needs both', () => {
    const errors: string[] = [];
    acceptBody(form({ name: ' ' }), errors);
    expect(errors).toEqual([
      'Type your full name as it is written on the offer.',
      'Tick the box to confirm that you accept the offer and its terms.',
    ]);
  });

  it('declines with a reason only when given', () => {
    expect(declineBody(form({ reason: ' Another offer ' }))).toEqual({ reason: 'Another offer' });
    expect(declineBody(form({ reason: '' }))).toEqual({});
    expect(declineBody(form({ reason: 'x'.repeat(1200) })).reason).toHaveLength(1000);
  });

  it("shows the API's dates as DD/MM/YYYY", () => {
    expect(asShown(['The offer was open until 2026-10-22.'])).toEqual(['The offer was open until 22/10/2026.']);
  });
});
