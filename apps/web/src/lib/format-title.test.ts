import { describe, expect, it } from 'vitest';
import { titleCase } from './format';

describe('titleCase', () => {
  it('capitalises every word of a heading but the short ones inside it', () => {
    expect(titleCase('Social insurance print')).toBe('Social Insurance Print');
    expect(titleCase('Military status certificate')).toBe('Military Status Certificate');
    expect(titleCase('Contract of employment for the year')).toBe('Contract of Employment for the Year');
  });

  it('keeps words that already have capitals, and starts afresh after a bracket or a dash', () => {
    expect(titleCase('National ID scan (front and back)')).toBe('National ID Scan (Front and Back)');
    expect(titleCase('the offer – a summary')).toBe('The Offer – A Summary');
    expect(titleCase('Job offer · Full-time')).toBe('Job Offer · Full-time');
  });

  it('leaves Arabic as it is', () => {
    expect(titleCase('برنت التأمينات')).toBe('برنت التأمينات');
    expect(titleCase('Social insurance print (برنت)')).toBe('Social Insurance Print (برنت)');
  });
});
