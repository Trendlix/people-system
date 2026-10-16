import { describe, expect, it } from 'vitest';
import { cardNote, detailsRead, FIXED, FROM_CARD, SPELLED } from './paperwork';

describe('the notes on the fields filled in from the ID card', () => {
  it('says the English name was spelled from the Arabic name, and the rest read or fixed', () => {
    expect(cardNote('fullNameEn')).toBe(SPELLED);
    expect(cardNote('fullNameEn', ['fullNameEn'])).toBe(SPELLED);
    expect(cardNote('fullNameAr')).toBe(FROM_CARD);
    expect(cardNote('fullNameAr', ['fullNameAr'])).toBe(FIXED);
    expect(SPELLED).toBe('Spelled from the Arabic name on the card — check before saving.');
  });

  it('counts the details read from the card, not the English name spelled from it', () => {
    expect(detailsRead({ fullNameAr: 'x', fullNameEn: 'y', gender: 'male' })).toBe(2);
    expect(detailsRead({})).toBe(0);
  });
});
