import { describe, expect, it } from 'vitest';
import {
  stageLabel,
  stageRows,
  stageRowsFrom,
  stagesOf,
  totalMonthsText,
  traineeStagesFrom,
  trainingLengthText,
  trainingSummary,
} from './trainee-stages';

/** The stages as the editor sends them: one name, months and pay per row, in order. */
function form(rows: [string, string, string][]): FormData {
  const fd = new FormData();
  for (const [name, months, pay] of rows) {
    fd.append('traineeStageName', name);
    fd.append('traineeStageMonths', months);
    fd.append('traineeStagePay', pay);
  }
  return fd;
}

describe('a trainee’s training stages on the contract form (Labour Law Art. 29)', () => {
  it('starts a new agreement with one stage to fill in, else with the saved ones', () => {
    expect(stageRows({}, null)).toEqual([{ name: '', months: '', pay: '' }]);
    expect(stageRows({}, [])).toEqual([{ name: '', months: '', pay: '' }]);
    expect(
      stageRows({}, [
        { name: 'Basics', months: 3, pay: 4000 },
        { name: 'Practice', months: 6, pay: 5500.5 },
      ]),
    ).toEqual([
      { name: 'Basics', months: '3', pay: '4000' },
      { name: 'Practice', months: '6', pay: '5500.5' },
    ]);
    // a pay hidden with the salary is left empty
    expect(stageRows({}, [{ name: 'Basics', months: 3, pay: null }])).toEqual([{ name: 'Basics', months: '3', pay: '' }]);
  });

  it('refills the rows as typed after a refused save', () => {
    const state = { values: { traineeStageName: ['Basics', 'Practice'], traineeStageMonths: ['3', ''], traineeStagePay: ['4,000', '5000'] } };
    expect(stageRows(state, [{ name: 'Old', months: 12, pay: 9000 }])).toEqual([
      { name: 'Basics', months: '3', pay: '4,000' },
      { name: 'Practice', months: '', pay: '5000' },
    ]);
    expect(stageRows({ values: { traineeStageName: 'Basics', traineeStageMonths: '3', traineeStagePay: '4000' } }, null)).toEqual([
      { name: 'Basics', months: '3', pay: '4000' },
    ]);
  });

  it('reads the stages as typed, in Arabic digits too, leaving out a row left empty', () => {
    expect(
      stagesOf([
        { name: ' Basics ', months: '٣', pay: '4,000' },
        { name: '', months: '', pay: '' },
        { name: 'Practice', months: '2.5', pay: 'lots' },
      ]),
    ).toEqual([
      { name: 'Basics', months: 3, pay: 4000 },
      { name: 'Practice', months: NaN, pay: NaN },
    ]);
    expect(stageRowsFrom(form([['Basics', '3', '4000']]))).toEqual([{ name: 'Basics', months: '3', pay: '4000' }]);
  });

  it('sends the stages, with what the form can check itself: rising pay, whole months, a name', () => {
    const ok: string[] = [];
    expect(
      traineeStagesFrom(
        form([
          ['Basics', '3', '4,000'],
          ['Practice', '6', '5,500'],
        ]),
        ok,
      ),
    ).toEqual([
      { name: 'Basics', months: 3, pay: 4000 },
      { name: 'Practice', months: 6, pay: 5500 },
    ]);
    expect(ok).toEqual([]);

    const falling: string[] = [];
    traineeStagesFrom(
      form([
        ['Basics', '3', '5000'],
        ['Practice', '3', '4000'],
      ]),
      falling,
    );
    expect(falling).toEqual([expect.stringMatching(/^Training stage 2’s pay must be more than stage 1’s .*Art\. 29/)]);

    const none: string[] = [];
    expect(traineeStagesFrom(form([['', '', '']]), none)).toEqual([]);
    expect(none).toEqual([expect.stringMatching(/^Add at least one training stage/)]);

    const unnamed: string[] = [];
    traineeStagesFrom(form([['', '0', '4000']]), unnamed);
    expect(unnamed).toEqual(['Training stage 1 needs a name.', 'Training stage 1’s length must be a whole number of months, 1 or more.']);
  });

  it('says the training’s whole length once every stage’s months are known', () => {
    expect(
      totalMonthsText([
        { name: 'a', months: 3, pay: 1 },
        { name: 'b', months: 9, pay: 2 },
      ]),
    ).toBe('12 months in all');
    expect(totalMonthsText([{ name: 'a', months: 1, pay: 1 }])).toBe('1 month in all');
    expect(totalMonthsText([{ name: 'a', months: NaN, pay: 1 }])).toBeNull();
    expect(totalMonthsText([])).toBeNull();
  });

  it('words a stage and the training for the contract and the lists', () => {
    expect(stageLabel({ name: 'Basics', months: 3, pay: 4000 })).toBe('Basics · 3 months · EGP 4,000.00 a month');
    expect(stageLabel({ name: 'Basics', months: 1, pay: null })).toBe('Basics · 1 month');
    expect(trainingSummary([{ months: 3 }, { months: 3 }, { months: 6 }])).toBe('3 stages, 12 months');
    expect(trainingSummary([{ months: 1 }])).toBe('1 stage, 1 month');
    expect(trainingLengthText(12)).toBe('Training agreement · 12 months');
  });
});
