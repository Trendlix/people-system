import { describe, expect, it } from 'vitest';
import {
  endingDefaults,
  formProblems,
  generatedLetterHref,
  noticeHint,
  readResignationFilter,
  recordResignationHref,
  resignationHref,
  resignationsApiPath,
  resignationsHref,
  signedLetterHref,
} from './resignation';

const TODAY = '2026-10-26';
const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

describe('the resignation request form', () => {
  it('needs a reason and the box ticked', () => {
    expect(formProblems({ reason: '', preferredLastDay: '', confirmed: false }, TODAY)).toEqual([
      'Enter your reason for resigning.',
      'Tick the box to say you understand a resignation counts once certified at the labour office.',
    ]);
    expect(formProblems({ reason: 'A move', preferredLastDay: '', confirmed: true }, TODAY)).toEqual([]);
  });

  it('takes a preferred day of today or later, typed as DD/MM/YYYY', () => {
    expect(formProblems({ reason: 'x', preferredLastDay: '26/10/2026', confirmed: true }, TODAY)).toEqual([]);
    expect(formProblems({ reason: 'x', preferredLastDay: '25/10/2026', confirmed: true }, TODAY)).toEqual(['Your preferred last working day must be today or later.']);
    expect(formProblems({ reason: 'x', preferredLastDay: '31/02/2027', confirmed: true }, TODAY)).toHaveLength(1);
  });

  it('hints the notice and the day it would end', () => {
    expect(noticeHint('3 months', '2027-01-26', shown)).toBe('The notice is 3 months by the resignation rule: sent today, it would end on 26/01/2027. A shorter time is for HR to agree.');
    expect(noticeHint(null, null, shown)).toBe('Leave it empty to leave it to the notice.');
  });
});

describe('the lists and the links', () => {
  it('waits by default, and keeps the filter in the address', () => {
    expect(readResignationFilter({})).toBe('sent');
    expect(readResignationFilter({ status: 'recorded' })).toBe('recorded');
    expect(readResignationFilter({ status: 'all' })).toBe('');
    expect(readResignationFilter({ status: 'nonsense' })).toBe('sent');
    expect(resignationsHref('sent')).toBe('/resignations');
    expect(resignationsHref('')).toBe('/resignations?status=all');
    expect(resignationsApiPath('')).toBe('/resignation-requests');
    expect(resignationsApiPath('returned')).toBe('/resignation-requests?status=returned');
  });

  it('opens the ending form for the resignation, with the request', () => {
    expect(recordResignationHref('e1', 'r1')).toBe('/employees/e1/ending/new?rule=resignation&resignation=r1');
    expect(resignationHref('r1', 'sent')).toBe('/resignations/r1?done=sent');
  });

  // the letter (owner, 31 October 2026): People's, to view or save, and the signed copy HR uploads
  it('opens the letters under the request', () => {
    expect(generatedLetterHref('r1')).toBe('/resignations/r1/generated-letter');
    expect(generatedLetterHref('r1', true)).toBe('/resignations/r1/generated-letter?download=1');
    expect(signedLetterHref('r1')).toBe('/resignations/r1/letter');
  });
});

describe('what the ending form starts with', () => {
  it('has the notice day, the reason and the preferred day', () => {
    expect(endingDefaults({ sentOn: '2026-10-26', reason: 'A new chapter', preferredLastDay: '2026-12-01' }, shown)).toEqual({
      ruleKey: 'resignation',
      noticeGivenOn: '26/10/2026',
      reason: 'A new chapter',
      preferredLastDay: '2026-12-01',
      note: '',
      agreedLastWorkingDay: '01/12/2026',
    });
    expect(endingDefaults({ sentOn: '2026-10-26', reason: 'x'.repeat(300), preferredLastDay: null }, shown)).toMatchObject({ reason: 'x'.repeat(200), note: '', agreedLastWorkingDay: '' });
  });
});
