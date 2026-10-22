import {
  ASSET_EXPORTS,
  assetExportFileName,
  codeFromLabel,
  countDue,
  countFigures,
  countIsDue,
  countResultOf,
  countScopeProblems,
  LABEL_SHEET,
  labelSheetSlots,
  labelStartProblem,
  statusAfterCount,
} from '@trendlix/shared';

// Assets step 5 (owner, 22 October 2026: "Assets step 5 (stock counts, label sheets, the Assets dashboard, exports) …
// work on this"; packages/shared asset-counts.ts).

describe('a count\'s results (spec §3 record_count, §6.5)', () => {
  it('puts an asset in custody out whatever was ticked, a ticked one found, any other missing', () => {
    expect(countResultOf('custody', false)).toBe('out');
    expect(countResultOf('custody', true)).toBe('out');
    expect(countResultOf('available', true)).toBe('found');
    expect(countResultOf('available', false)).toBe('missing');
    expect(countResultOf('repair', false)).toBe('missing');
    expect(countResultOf('lost', true)).toBe('found');
    expect(countResultOf('lost', false)).toBe('missing');
  });

  it('makes a lost asset found available again, and changes nothing else (Mark lost is apart)', () => {
    expect(statusAfterCount('lost', 'found')).toBe('available');
    expect(statusAfterCount('lost', 'missing')).toBe('lost');
    expect(statusAfterCount('available', 'missing')).toBe('available');
    expect(statusAfterCount('repair', 'found')).toBe('repair');
    expect(statusAfterCount('custody', 'out')).toBe('custody');
  });

  it('adds up a count\'s lines', () => {
    expect(countFigures([{ result: 'found' }, { result: 'missing', lostMarked: true }, { result: 'missing' }, { result: 'out' }])).toEqual({
      expected: 4,
      found: 1,
      missing: 2,
      out: 1,
      lostMarked: 1,
    });
    expect(countFigures([])).toEqual({ expected: 0, found: 0, missing: 0, out: 0, lostMarked: 0 });
  });

  it('wants one group, room or kit', () => {
    expect(countScopeProblems({ kind: 'group', group: 'kit' })).toEqual([]);
    expect(countScopeProblems({ kind: 'room', roomId: 'r' })).toEqual([]);
    expect(countScopeProblems({ kind: 'kit', kitId: 'k' })).toEqual([]);
    expect(countScopeProblems({})).toEqual(['Choose what to count: a group, a room or a kit.']);
    expect(countScopeProblems({ kind: 'group', group: 'cars' as never })).toEqual(['Choose the group to count.']);
    expect(countScopeProblems({ kind: 'room' })).toEqual(['Choose the room to count.']);
    expect(countScopeProblems({ kind: 'kit', kitId: null })).toEqual(['Choose the kit to count.']);
  });
});

describe('reading a label', () => {
  it('reads a code typed in any case and spacing', () => {
    expect(codeFromLabel('pk-cam-0003')).toBe('PK-CAM-0003');
    expect(codeFromLabel('  PK-CAM-0003 ')).toBe('PK-CAM-0003');
    expect(codeFromLabel('PK - CAM - 0003')).toBe('PK-CAM-0003');
  });

  it('reads the QR code\'s address, the site\'s or the phone pages\'', () => {
    expect(codeFromLabel('https://people.trendlix.com/assets/PK-CAM-0003')).toBe('PK-CAM-0003');
    expect(codeFromLabel('https://people.trendlix.com/app/assets/IT-LAP-0012')).toBe('IT-LAP-0012');
    expect(codeFromLabel('https://people.trendlix.com/assets/pk-cam-0003/')).toBe('PK-CAM-0003');
  });

  it('refuses anything else', () => {
    expect(codeFromLabel('')).toBeNull();
    expect(codeFromLabel('hello')).toBeNull();
    expect(codeFromLabel('https://people.trendlix.com/assets/custody')).toBeNull();
    expect(codeFromLabel('https://people.trendlix.com/employees/PK-CAM-0003')).toBeNull();
    expect(codeFromLabel('https://people.trendlix.com/assets/%E0%A4%A')).toBeNull();
    expect(codeFromLabel('PK-KIT-A')).toBeNull();
  });
});

describe('counts due (spec §6.6)', () => {
  it('is due on its day or after, when the group has assets', () => {
    const today = '2026-10-22';
    expect(countIsDue(countDue('kit', 4, null, null, today), today)).toBe(true);
    expect(countIsDue(countDue('kit', 0, null, null, today), today)).toBe(false);
    expect(countIsDue(countDue('kit', 4, '2026-10-01T08:00:00Z', '2026-10-01', today), today)).toBe(false);
    expect(countIsDue(countDue('kit', 4, '2026-09-22T08:00:00Z', '2026-09-22', today), today)).toBe(true);
    expect(countIsDue(countDue('office', 4, '2025-10-22T08:00:00Z', '2025-10-22', today), today)).toBe(true);
  });
});

describe('label sheets (spec §5: A4, 3 × 8 labels of 63 × 30 mm)', () => {
  it('fits 3 × 8 labels of 63 × 30 mm centred on A4', () => {
    expect(LABEL_SHEET.columns * LABEL_SHEET.rows).toBe(LABEL_SHEET.perSheet);
    expect(LABEL_SHEET.marginLeftMm * 2 + LABEL_SHEET.columns * LABEL_SHEET.labelWidthMm).toBe(LABEL_SHEET.pageWidthMm);
    expect(LABEL_SHEET.marginTopMm * 2 + LABEL_SHEET.rows * LABEL_SHEET.labelHeightMm).toBe(LABEL_SHEET.pageHeightMm);
  });

  it('puts the labels in order, the rest of the last sheet empty', () => {
    const sheets = labelSheetSlots(['a', 'b', 'c']);
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toHaveLength(24);
    expect(sheets[0].slice(0, 4)).toEqual(['a', 'b', 'c', null]);
  });

  it('starts at a chosen label on a sheet already partly used, and goes on to the next sheet', () => {
    const items = Array.from({ length: 5 }, (_, i) => i + 1);
    const sheets = labelSheetSlots(items, 22);
    expect(sheets).toHaveLength(2);
    expect(sheets[0].slice(0, 21).every((s) => s === null)).toBe(true);
    expect(sheets[0].slice(21)).toEqual([1, 2, 3]);
    expect(sheets[1].slice(0, 3)).toEqual([4, 5, null]);
  });

  it('makes 10 sheets of 240 labels, and none of no labels', () => {
    expect(labelSheetSlots(Array.from({ length: 240 }, (_, i) => i))).toHaveLength(10);
    expect(labelSheetSlots([])).toEqual([]);
    expect(labelSheetSlots([], 5)).toEqual([]);
  });

  it('wants the label to start at from 1 to 24, and starts at 1 otherwise', () => {
    expect(labelStartProblem(1)).toBeNull();
    expect(labelStartProblem(24)).toBeNull();
    expect(labelStartProblem(0)).toBe('Choose the label to start at: from 1 to 24.');
    expect(labelStartProblem(25)).toBe('Choose the label to start at: from 1 to 24.');
    expect(labelStartProblem(2.5)).toBe('Choose the label to start at: from 1 to 24.');
    expect(labelSheetSlots(['a'], 99)[0][0]).toBe('a');
  });
});

describe('exports', () => {
  it('names each workbook with the day', () => {
    expect(ASSET_EXPORTS.map((k) => assetExportFileName(k, '2026-10-22'))).toEqual([
      'Asset register 2026-10-22.xlsx',
      'Custody records 2026-10-22.xlsx',
      'Stock moves 2026-10-22.xlsx',
      'Maintenance log 2026-10-22.xlsx',
      'Counts 2026-10-22.xlsx',
    ]);
  });
});
