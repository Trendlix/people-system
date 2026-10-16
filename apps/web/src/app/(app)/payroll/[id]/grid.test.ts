import { EMPTY_PAYROLL_INPUTS } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  attendancePercent,
  cellText,
  errorLine,
  GRID_COLUMNS,
  linePatches,
  parseCell,
  placeApiErrors,
  tidyCell,
  unsavedCount,
  unsavedText,
  type GridLine,
} from './grid';

// invented people and figures
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const lines: GridLine[] = [
  { id: A, name: 'Mona Farid', inputs: { ...EMPTY_PAYROLL_INPUTS, workedHours: 270.5, expectedHours: 280, performance: 90 }, onHold: false, comments: null },
  { id: B, name: 'Karim Nabil', inputs: { ...EMPTY_PAYROLL_INPUTS, commission: 1500 }, onHold: true, comments: 'Bank details pending' },
];

describe('the grid’s columns', () => {
  it('follow the owner’s sheet, every input once', () => {
    expect(GRID_COLUMNS.map((c) => c.label)).toEqual([
      'Worked hours',
      'Expected hours',
      'Soft skills %',
      'Performance %',
      'Client satisfaction %',
      'No-show days',
      'Penalty days',
      'Bonus days',
      'Commission',
      'Settlements',
      'Medical',
      'Released',
    ]);
    expect(new Set(GRID_COLUMNS.map((c) => c.field))).toEqual(new Set(Object.keys(EMPTY_PAYROLL_INPUTS)));
  });
});

describe('reading a cell', () => {
  const value = (kind: Parameters<typeof parseCell>[0], text: string) => {
    const parsed = parseCell(kind, text);
    return parsed.ok ? parsed.value : 'error';
  };

  it('reads hours as attendance shows them or as a number, up to 744', () => {
    expect(value('hours', '270:00')).toBe(270);
    expect(value('hours', '270:30')).toBe(270.5);
    expect(value('hours', '270.5')).toBe(270.5);
    expect(value('hours', ' 270 ')).toBe(270);
    expect(value('hours', '٢٧٠:٣٠')).toBe(270.5);
    expect(value('hours', '744')).toBe(744);
    expect(value('hours', '745')).toBe('error');
    expect(value('hours', '270:75')).toBe('error');
    expect(value('hours', 'abc')).toBe('error');
  });

  it('leaves an empty cell empty', () => {
    for (const c of GRID_COLUMNS) expect(value(c.kind, '  ')).toBeNull();
  });

  it('reads percents from 0 to 200', () => {
    expect(value('percent', '95')).toBe(95);
    expect(value('percent', '87.5')).toBe(87.5);
    expect(value('percent', '200')).toBe(200);
    expect(value('percent', '201')).toBe('error');
    expect(value('percent', '-5')).toBe('error');
    expect(value('percent', '95%')).toBe('error');
  });

  it('reads days from 0 to 31, whole or half', () => {
    expect(value('days', '2')).toBe(2);
    expect(value('days', '1.5')).toBe(1.5);
    expect(value('days', '31')).toBe(31);
    expect(value('days', '1.25')).toBe('error');
    expect(value('days', '32')).toBe('error');
  });

  it('reads amounts in EGP, negative ones too, within ten million', () => {
    expect(value('amount', '1,500')).toBe(1500);
    expect(value('amount', '1 500.5')).toBe(1500.5);
    expect(value('amount', '-250.50')).toBe(-250.5);
    expect(value('amount', '−250')).toBe(-250);
    expect(value('amount', '10000000')).toBe(10_000_000);
    expect(value('amount', '10000000.01')).toBe('error');
    expect(value('amount', '12.345')).toBe('error');
  });

  it('reads what was released this month as 0 or more', () => {
    expect(value('released', '2,000')).toBe(2000);
    expect(value('released', '0')).toBe(0);
    expect(value('released', '-1')).toBe('error');
  });

  it('says how to type it when it can’t be read', () => {
    expect(parseCell('hours', 'x')).toEqual({ ok: false, error: 'Type the hours as 270:00 or 270.5, up to 744.' });
    expect(parseCell('days', '40')).toEqual({ ok: false, error: 'Type the days from 0 to 31, whole or half, e.g. 1.5.' });
  });
});

describe('showing a cell', () => {
  it('shows hours as attendance does, amounts with two decimals', () => {
    expect(cellText('hours', 270.5)).toBe('270:30');
    expect(cellText('hours', 270)).toBe('270:00');
    expect(cellText('amount', 1500)).toBe('1500.00');
    expect(cellText('released', 99.5)).toBe('99.50');
    expect(cellText('percent', 87.5)).toBe('87.5');
    expect(cellText('days', 1.5)).toBe('1.5');
    expect(cellText('hours', null)).toBe('');
  });

  it('tidies a cell once it is left, and keeps one typed wrongly as typed', () => {
    expect(tidyCell('hours', '270.5')).toBe('270:30');
    expect(tidyCell('amount', '1,500')).toBe('1500.00');
    expect(tidyCell('hours', '27o')).toBe('27o');
    expect(tidyCell('percent', '')).toBe('');
  });

  it('works out the attendance from the hours', () => {
    expect(attendancePercent(270.5, 280)).toBe(96.61);
    expect(attendancePercent(280, 280)).toBe(100);
    expect(attendancePercent(null, 280)).toBeNull();
    expect(attendancePercent(270, 0)).toBeNull();
  });
});

describe('what changed', () => {
  it('sends only the rows and the cells that changed', () => {
    const { patches, errors } = linePatches(lines, {
      [A]: { inputs: { workedHours: '271:00', expectedHours: '280', performance: '' } },
    });
    expect(errors).toEqual([]);
    // the expected hours were typed as they are saved: not a change
    expect(patches).toEqual([{ id: A, inputs: { workedHours: 271, performance: null } }]);
  });

  it('sends the hold and the comments when they changed, comments trimmed and none for empty', () => {
    const { patches } = linePatches(lines, {
      [A]: { onHold: true, comments: '  Joined late  ' },
      [B]: { onHold: true, comments: '' },
    });
    expect(patches).toEqual([
      { id: A, onHold: true, comments: 'Joined late' },
      { id: B, comments: null },
    ]);
  });

  it('sends nothing for edits that put a row back as it was', () => {
    const edits = { [A]: { inputs: { workedHours: '270.5' } }, [B]: { onHold: true, comments: 'Bank details pending ' } };
    expect(linePatches(lines, edits).patches).toEqual([]);
    expect(unsavedCount(lines, edits)).toEqual({ cells: 0, rows: 0 });
  });

  it('lists the cells typed wrongly, which count as unsaved', () => {
    const edits = { [A]: { inputs: { workedHours: 'abc', softSkills: '95' } }, [B]: { inputs: { released: '-1' } } };
    const { errors } = linePatches(lines, edits);
    expect(errors.map((e) => [e.lineId, e.field])).toEqual([
      [A, 'workedHours'],
      [B, 'released'],
    ]);
    expect(unsavedCount(lines, edits)).toEqual({ cells: 3, rows: 2 });
  });

  it('says how many changes are not saved', () => {
    expect(unsavedText({ cells: 1, rows: 1 })).toBe('1 unsaved change');
    expect(unsavedText({ cells: 3, rows: 1 })).toBe('3 unsaved changes');
    expect(unsavedText({ cells: 5, rows: 2 })).toBe('5 unsaved changes in 2 rows');
  });
});

describe('the API’s refusals', () => {
  const sent = [{ id: A, inputs: { workedHours: 800 } }, { id: B, comments: 'x' }];

  it('puts a message naming a row of what was sent by its cell', () => {
    const { cells, general } = placeApiErrors(['lines.1.comments must be shorter than or equal to 500 characters', 'lines.0.inputs.workedHours must not be greater than 744'], sent);
    expect(general).toEqual([]);
    expect(cells).toEqual([
      { lineId: B, field: 'comments', message: 'Comments must be shorter than or equal to 500 characters.' },
      { lineId: A, field: 'workedHours', message: 'Worked hours must not be greater than 744.' },
    ]);
  });

  it('puts a message naming a line by its id with its row, and keeps the rest for the save as a whole', () => {
    const { cells, general } = placeApiErrors([`Line ${B} is not on this payroll.`, 'Enter the hours from 0 to 744, e.g. 270 or 270:30.'], sent);
    expect(cells).toEqual([{ lineId: B, field: null, message: `Line ${B} is not on this payroll.` }]);
    expect(general).toEqual(['Enter the hours from 0 to 744, e.g. 270 or 270:30.']);
  });

  it('lists a cell’s error with the employee and the column', () => {
    expect(errorLine({ lineId: A, field: 'workedHours', message: 'Type the hours as 270:00 or 270.5, up to 744.' }, 'Mona Farid')).toBe(
      'Mona Farid · Worked hours: Type the hours as 270:00 or 270.5, up to 744.',
    );
    expect(errorLine({ lineId: A, field: 'workedHours', message: 'Worked hours must not be greater than 744.' }, 'Mona Farid')).toBe(
      'Mona Farid · Worked hours must not be greater than 744.',
    );
    expect(errorLine({ lineId: A, field: null, message: 'Not on this payroll.' }, 'Mona Farid')).toBe('Mona Farid · Not on this payroll.');
  });
});
