import { describe, expect, it } from 'vitest';
import { newLinkConfirm, offerMailBody, offerMailSubject, offerMailto, originFrom, type OfferMailParts } from './sending';

const headersOf = (entries: Record<string, string>) => new Headers(entries);

describe("the web app's address, for the candidate's link", () => {
  it('follows the proxy in front of the web server', () => {
    expect(originFrom(headersOf({ host: 'web:3000', 'x-forwarded-host': 'people.trendlix.com', 'x-forwarded-proto': 'https' }))).toBe(
      'https://people.trendlix.com',
    );
  });

  it('takes the first value of a list', () => {
    expect(originFrom(headersOf({ 'x-forwarded-host': 'people.trendlix.com, web:3000', 'x-forwarded-proto': 'https,http' }))).toBe(
      'https://people.trendlix.com',
    );
  });

  it('falls back to the Host header: http on this computer, https elsewhere', () => {
    expect(originFrom(headersOf({ host: 'localhost:3000' }))).toBe('http://localhost:3000');
    expect(originFrom(headersOf({ host: 'people.trendlix.com' }))).toBe('https://people.trendlix.com');
    expect(originFrom(headersOf({ host: 'people.trendlix.com', 'x-forwarded-proto': 'http' }))).toBe('http://people.trendlix.com');
  });

  it('gives nothing for a missing or odd host', () => {
    expect(originFrom(headersOf({}))).toBe('');
    expect(originFrom(headersOf({ host: 'evil.com/path' }))).toBe('');
    expect(originFrom(headersOf({ host: 'a b' }))).toBe('');
  });

  it('ignores an unknown scheme', () => {
    expect(originFrom(headersOf({ host: 'people.trendlix.com', 'x-forwarded-proto': 'javascript' }))).toBe('https://people.trendlix.com');
  });
});

const parts: OfferMailParts = {
  to: 'omar.khaled@gmail.com',
  name: 'Omar Khaled Mahmoud',
  jobTitle: 'Content Creator',
  company: 'TrendLIX',
  expiresOn: '2026-10-22',
  message: null,
  link: 'https://people.trendlix.com/offer/abcDEF123456789_-xyz',
};

describe('the email HR sends from their own email', () => {
  it('names the job and the company in the subject', () => {
    expect(offerMailSubject(parts)).toBe('Job offer: Content Creator at TrendLIX');
    expect(offerMailSubject({ ...parts, jobTitle: null })).toBe('Job offer from TrendLIX');
  });

  it('greets the candidate by first name, gives the link and the last day', () => {
    const body = offerMailBody(parts);
    expect(body.startsWith('Dear Omar,\n')).toBe(true);
    expect(body).toContain('We are pleased to offer you the position of Content Creator at TrendLIX.');
    expect(body).toContain(`\n${parts.link}\n`);
    expect(body).toContain('The offer is open until 22/10/2026.');
  });

  it("uses HR's message when there is one", () => {
    expect(offerMailBody({ ...parts, message: '  We loved meeting you.  ' })).toContain('\nWe loved meeting you.\n');
  });

  it('makes a mailto link with the address, subject and body encoded', () => {
    const href = offerMailto(parts);
    expect(href.startsWith('mailto:omar.khaled@gmail.com?subject=Job%20offer%3A%20Content%20Creator%20at%20TrendLIX&body=')).toBe(true);
    const body = decodeURIComponent(href.split('&body=')[1]);
    expect(body).toContain('\r\n');
    expect(body).toContain(parts.link);
    expect(href).not.toContain(' ');
  });

  it('keeps an address with a plus sign intact', () => {
    expect(offerMailto({ ...parts, to: 'omar+jobs@gmail.com' }).startsWith('mailto:omar%2Bjobs@gmail.com?')).toBe(true);
  });
});

describe('a new link', () => {
  it('asks first once a link was sent, since the earlier one stops working', () => {
    expect(newLinkConfirm(0)).toBeUndefined();
    expect(newLinkConfirm(1)).toMatch(/earlier link will stop working/);
  });
});
