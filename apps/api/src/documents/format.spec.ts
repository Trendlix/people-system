import { documentStem, inLanguage, printedAddress, printedAddressLine, printedDate, printedGovernorate, printedMoney, printedMonth, printedPhone } from './format.js';

describe('how values are printed', () => {
  it('dates as DD/MM/YYYY, the ID card’s issue date as MM/YYYY', () => {
    expect(printedDate('2026-01-15')).toBe('15/01/2026');
    expect(printedMonth('2021-03-09')).toBe('03/2021');
    expect(printedDate(null)).toBe('');
    expect(printedMonth(null)).toBe('');
  });

  it('money with thousands separators, and piastres only when there are some', () => {
    expect(printedMoney(15000)).toBe('15,000');
    expect(printedMoney(1250000)).toBe('1,250,000');
    expect(printedMoney(17250.5)).toBe('17,250.50');
    expect(printedMoney(999.05)).toBe('999.05');
    expect(printedMoney(0.1 + 0.2)).toBe('0.30');
    expect(printedMoney(0)).toBe('0');
    expect(printedMoney(null)).toBe('');
  });

  // the owner, 22 October 2026: "the phone number is without the country code"
  it('a phone number with its country code, as kept', () => {
    expect(printedPhone('+201012345678')).toBe('+201012345678');
    expect(printedPhone('+20223456789')).toBe('+20223456789');
    expect(printedPhone('+447700900123')).toBe('+447700900123');
    expect(printedPhone(null)).toBe('');
  });

  it('the address in Arabic with its city and governorate, nothing said twice', () => {
    expect(printedAddress('15 شارع عباس العقاد', 'مدينة نصر', 'Cairo')).toBe('15 شارع عباس العقاد، مدينة نصر، القاهرة');
    expect(printedAddress('15 شارع عباس العقاد، مدينة نصر،', 'مدينة نصر', 'Cairo')).toBe('15 شارع عباس العقاد، مدينة نصر، القاهرة');
    expect(printedAddress('شارع الهرم، الجيزة', 'الهرم', 'Giza')).toBe('شارع الهرم، الجيزة');
    expect(printedAddress('ش البحر', 'الاسكندرية', 'Alexandria')).toBe('ش البحر، الاسكندرية');
    expect(printedAddress('ش البحر', null, null)).toBe('ش البحر');
    expect(printedAddress(null, 'مدينة نصر', 'Cairo')).toBe('');
  });

  it('the address in its parts for the social insurance forms: the address alone, the governorate in Arabic', () => {
    expect(printedAddressLine('15 شارع عباس العقاد، ')).toBe('15 شارع عباس العقاد');
    expect(printedAddressLine(null)).toBe('');
    expect(printedGovernorate('Cairo')).toBe('القاهرة');
    expect(printedGovernorate('Kafr El Sheikh')).toBe('كفر الشيخ');
    expect(printedGovernorate(' Somewhere ')).toBe('Somewhere');
    expect(printedGovernorate(null)).toBe('');
  });

  it('a name in the template’s language, falling back to the other', () => {
    expect(inLanguage('ar', 'Account Manager', 'مدير حسابات')).toBe('مدير حسابات');
    expect(inLanguage('ar', 'Account Manager', null)).toBe('Account Manager');
    expect(inLanguage('en', 'Account Manager', 'مدير حسابات')).toBe('Account Manager');
    expect(inLanguage('en', null, null)).toBe('');
  });

  it('a document’s file name from the slot, the code and the name, with no folders', () => {
    expect(documentStem('Contract · Full-time (official copy)', 'EMP-0007', 'Omar Khaled')).toBe('Contract · Full-time (official copy) - EMP-0007 - Omar Khaled');
    expect(documentStem('Resignation request (طلب استقالة)', 'EMP-0007', 'A/B Test')).toBe('Resignation request (طلب استقالة) - EMP-0007 - A-B Test');
  });
});
