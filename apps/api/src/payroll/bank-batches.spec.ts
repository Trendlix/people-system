import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { batchFileName, batchView, sumAmounts, type BatchRow } from './bank-batches.js';

// Bank transfer batches (owner, 5 November 2026: "allow me to select a group of people for the transfer", "and to
// confirm each batch sent to be recorded"). Every name is invented.

const line = (lineId: string, employeeId: string, amount: string) => ({
  lineId,
  amount: new Prisma.Decimal(amount),
  line: { employeeId, employeeCode: `EMP-${employeeId}`, nameEn: `Person ${employeeId}` },
});

const row = (over: Partial<BatchRow> = {}): BatchRow => ({
  id: 'b1',
  runId: 'r1',
  number: 2,
  file: 'ach',
  valueDate: null,
  total: new Prisma.Decimal('3000.30'),
  madeById: 'u1',
  madeBy: { id: 'u1', email: 'sara@example.com' },
  createdAt: new Date('2026-11-05T10:00:00Z'),
  sentAt: null,
  sentById: null,
  sentBy: null,
  lines: [line('l1', 'e1', '1000.10'), line('l2', 'e2', '2000.20')],
  ...over,
});

describe('a bank transfer batch as sent', () => {
  it('names who made it and who confirmed it sent, the email when they have no profile', () => {
    const names = new Map([['u1', { name: 'Sara Ali' }]]);
    const view = batchView(row({ sentAt: new Date('2026-11-05T12:00:00Z'), sentBy: { id: 'u2', email: 'omar@example.com' } }), new Set(), names);
    expect(view).toMatchObject({ number: 2, file: 'ach', valueDate: null, people: 2, total: 3000.3, hidden: 0, madeBy: 'Sara Ali', sentBy: 'omar@example.com', acts: true });
    expect(view.lines).toEqual([
      { lineId: 'l1', amount: 1000.1 },
      { lineId: 'l2', amount: 2000.2 },
    ]);
  });

  it('leaves out the lines hidden from the caller, from its people and total, and the caller doesn’t act on it', () => {
    const view = batchView(row(), new Set(['e2']), new Map());
    expect(view).toMatchObject({ lines: [{ lineId: 'l1', amount: 1000.1 }], people: 1, total: 1000.1, hidden: 1, acts: false });
  });

  it('keeps the CIB file’s value date', () => {
    expect(batchView(row({ file: 'cib', valueDate: new Date('2026-11-06T00:00:00Z') }), new Set(), new Map()).valueDate).toBe('2026-11-06');
  });
});

describe('batch files and sums', () => {
  it('names the file as the owner’s files are, with the batch’s number', () => {
    expect(batchFileName('cib', '2026-11', 1)).toBe('CIB NOV 2026 Salaries Batch 1.xlsx');
    expect(batchFileName('ach', '2026-03', 2)).toBe('ACH Salaries Batch 2 MAR 2026.xlsx');
  });

  it('sums to the piaster', () => {
    expect(sumAmounts([0.1, 0.2])).toBe(0.3);
    expect(sumAmounts([])).toBe(0);
  });
});
