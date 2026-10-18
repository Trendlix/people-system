import { describe, expect, it } from 'vitest';
import type { MyReimbursementType } from '../../../lib/types';
import { capsMonth, claimForm, claimProblems, leftText, RECEIPT_ACCEPT, receiptProblems, readClaim, sizeText, typedValues, type ReceiptFile } from './claim';

const TODAY = '2026-10-18';
const MB = 1024 * 1024;

const type = (over: Partial<MyReimbursementType> = {}): MyReimbursementType => ({
  id: 'type-1',
  nameEn: 'Transport',
  nameAr: 'مواصلات',
  description: null,
  receiptRequired: true,
  capPerClaim: 500,
  capPerMonth: 1000,
  capPerYear: null,
  claimWithinDays: 30,
  active: true,
  usedInMonth: 0,
  usedInYear: 0,
  ...over,
});

const photo = (size = 200 * 1024, name = 'receipt.jpg'): ReceiptFile => ({ name, size, type: 'image/jpeg' });

const typed = (over: Partial<{ typeId: string; expenseDate: string; amount: string; description: string }> = {}) => ({
  typeId: 'type-1',
  expenseDate: '12/10/2026',
  amount: '250',
  description: 'Taxi to the client',
  ...over,
});

describe('the new claim’s checks', () => {
  it('lets a claim within the conditions go', () => {
    expect(claimProblems(typed(), type(), [photo()], TODAY)).toEqual([]);
  });

  it('asks for the type first, and still checks the amount and the date without one', () => {
    expect(claimProblems(typed({ typeId: '', amount: '' }), null, [], TODAY)).toEqual(['Choose the type of expense.', 'Enter the amount spent, more than 0, e.g. 250 or 250.50.']);
  });

  it('says what the type’s conditions refuse, with the shared words', () => {
    expect(claimProblems(typed({ amount: '600' }), type(), [photo()], TODAY)).toEqual(['At most EGP 500.00 can be claimed at once for this type.']);
    expect(claimProblems(typed(), type({ usedInMonth: 900 }), [photo()], TODAY)).toEqual(["Only EGP 100.00 is left of this type's EGP 1000.00 for the expense's month."]);
    expect(claimProblems(typed(), type(), [], TODAY)).toEqual(['Attach the receipt: this type needs one.']);
    expect(claimProblems(typed({ expenseDate: '01/09/2026' }), type(), [photo()], TODAY)).toEqual([
      'This type must be claimed within 30 days of the expense; this one was 47 days ago.',
    ]);
    expect(claimProblems(typed({ expenseDate: '19/10/2026' }), type(), [photo()], TODAY)).toEqual(["The expense's date can't be after today."]);
    expect(claimProblems(typed({ expenseDate: '31/02/2026' }), type(), [photo()], TODAY)).toEqual(['Enter the date of the expense.']);
  });

  it('asks for the description, within its limit', () => {
    expect(claimProblems(typed({ description: '  ' }), type(), [photo()], TODAY)).toEqual(['Describe the expense: what it was for.']);
    expect(claimProblems(typed({ description: 'x'.repeat(501) }), type(), [photo()], TODAY)).toEqual(['Keep the description to 500 characters; it has 501.']);
  });

  it('reads amounts as typed, in Arabic digits and with the Arabic decimal mark too', () => {
    expect(readClaim({ expenseDate: '12/10/2026', amount: '1,250.50' })).toEqual({ expenseDate: '2026-10-12', amount: 1250.5 });
    expect(readClaim({ expenseDate: '١٢/١٠/٢٠٢٦', amount: '٢٥٠٫٥' })).toEqual({ expenseDate: '2026-10-12', amount: 250.5 });
    expect(readClaim({ expenseDate: '', amount: 'abc' }).expenseDate).toBe('');
    expect(readClaim({ expenseDate: '', amount: 'abc' }).amount).toBeNaN();
  });

  it('reads the caps again for the month of the date typed', () => {
    expect(capsMonth('2026-09-30')).toBe('2026-09');
  });
});

describe('the receipts', () => {
  it('takes photos and PDFs', () => {
    expect(RECEIPT_ACCEPT).toBe('image/jpeg,image/png,image/webp,application/pdf');
    expect(receiptProblems([photo(), { name: 'bill.pdf', size: MB, type: 'application/pdf' }])).toEqual([]);
    expect(receiptProblems([{ name: 'notes.docx', size: 1000, type: 'application/msword' }])).toEqual([
      "notes.docx can't be attached: a receipt is a photo (JPG, PNG or WebP) or a PDF.",
    ]);
  });

  it('takes at most five, each up to 10 MB, together small enough for one upload', () => {
    expect(receiptProblems(Array.from({ length: 6 }, () => photo(10 * 1024)))).toEqual(['Attach at most 5 receipts; remove 1.']);
    expect(receiptProblems([{ name: 'big.pdf', size: 11 * MB, type: 'application/pdf' }])).toEqual(['Each receipt must be 10 MB or smaller.']);
    expect(receiptProblems([photo(2.5 * MB), photo(2 * MB)])[0]).toMatch(/^Together the receipts are too large to send: at most 4 MB/);
  });

  it('says a file’s size', () => {
    expect(sizeText(812)).toBe('812 B');
    expect(sizeText(245760)).toBe('240 KB');
    expect(sizeText(1258291)).toBe('1.2 MB');
  });
});

describe('what is left of the caps', () => {
  it('says each cap set, what is left of the month’s and the year’s, and the most that can be claimed now', () => {
    expect(leftText(type({ capPerYear: 5000, usedInMonth: 250, usedInYear: 4900 }), '2026-10')).toEqual({
      rows: [
        { label: 'A claim', value: 'EGP 500.00', note: 'at most each time' },
        { label: 'October 2026', value: 'EGP 750.00 left', note: 'of EGP 1,000.00 a month; EGP 250.00 claimed' },
        { label: '2026', value: 'EGP 100.00 left', note: 'of EGP 5,000.00 a year; EGP 4,900.00 claimed' },
      ],
      most: 'EGP 100.00',
    });
  });

  it('says nothing is capped when no cap is set', () => {
    expect(leftText(type({ capPerClaim: null, capPerMonth: null }), '2026-10')).toEqual({ rows: [], most: null });
  });
});

describe('the claim as the server action reads it', () => {
  const fd = (fields: Record<string, string>, files: File[] = []) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    for (const file of files) f.append('receipts', file, file.name);
    return f;
  };

  it('gives the API’s fields: the date as YYYY-MM-DD, the amount as a number, and the receipts', () => {
    const receipt = new File([new Uint8Array(10)], 'r.jpg', { type: 'image/jpeg' });
    const read = claimForm(fd({ typeId: 'type-1', expenseDate: '12/10/2026', amount: '250.5', description: ' Taxi ' }, [receipt]));
    expect(read.errors).toEqual([]);
    expect(read.fields).toEqual({ typeId: 'type-1', expenseDate: '2026-10-12', amount: 250.5, description: 'Taxi' });
    expect(read.receipts.map((r) => r.name)).toEqual(['r.jpg']);
  });

  it('says what is missing, and keeps what was typed', () => {
    const sent = fd({ typeId: '', expenseDate: 'yesterday', amount: '0', description: '' });
    expect(claimForm(sent).errors).toEqual([
      'Choose the type of expense.',
      'Enter the date of the expense as DD/MM/YYYY, e.g. 14/10/2026.',
      'Enter the amount spent, more than 0, e.g. 250 or 250.50.',
      'Describe the expense: what it was for.',
    ]);
    expect(claimForm(sent).fields).toBeNull();
    expect(typedValues(sent)).toEqual({ typeId: '', expenseDate: 'yesterday', amount: '0', description: '' });
  });
});
