import { describe, expect, it } from 'vitest';
import { matches, nextChoosable, searchable, shownOptions, startingOption, type ListOption } from './select-search';

const option = (label: string, extra: Partial<ListOption> = {}): ListOption => ({ value: label, label, disabled: false, group: null, ...extra });
const labels = (options: readonly ListOption[]) => options.map((o) => o.label);

describe('searchable', () => {
  it('compares without case, accents or extra spaces', () => {
    expect(searchable('  Café   CRÈME ')).toBe('cafe creme');
  });

  it('compares Arabic without diacritics, tatweel or hamza forms, with ة as ه and ى as ي', () => {
    expect(searchable('القَاهِرَة')).toBe(searchable('القاهره'));
    expect(searchable('أحمد')).toBe('احمد');
    expect(searchable('إسلام آمنة')).toBe('اسلام امنه');
    expect(searchable('مصطفى')).toBe('مصطفي');
    expect(searchable('محـــمد')).toBe('محمد');
  });

  it('reads Arabic-Indic digits as 0–9', () => {
    expect(searchable('٢٠٢٦')).toBe('2026');
    expect(searchable('۱۲۳')).toBe('123');
  });
});

describe('matches', () => {
  it('finds every word typed, anywhere and in any order', () => {
    expect(matches('Marketing › Content Team', 'content')).toBe(true);
    expect(matches('Marketing › Content Team', 'team mark')).toBe(true);
    expect(matches('Marketing › Content Team', 'sales')).toBe(false);
    expect(matches('Marketing › Content Team', 'content sales')).toBe(false);
  });

  it('finds Arabic however it is spelt', () => {
    expect(matches('مدينة نصر', 'مدينه')).toBe(true);
    expect(matches('الإسكندرية', 'اسكندريه')).toBe(true);
  });

  it('finds everything when nothing is typed', () => {
    expect(matches('Anything', '')).toBe(true);
    expect(matches('Anything', '   ')).toBe(true);
  });
});

describe('shownOptions', () => {
  const countries = ['Montenegro', 'Egypt', 'Senegal', 'Norway'].map((c) => option(c));

  it('shows the whole list when nothing is typed', () => {
    expect(labels(shownOptions(countries, ''))).toEqual(['Montenegro', 'Egypt', 'Senegal', 'Norway']);
  });

  it('puts the labels that start with what was typed first, then the words that do, then the rest, each in list order', () => {
    expect(labels(shownOptions(countries, 'eg'))).toEqual(['Egypt', 'Montenegro', 'Senegal']);
    const titles = ['Senior Designer', 'Graphic Designer', 'Designer', 'UX Researcher'].map((t) => option(t));
    expect(labels(shownOptions(titles, 'design'))).toEqual(['Designer', 'Senior Designer', 'Graphic Designer']);
  });

  it('keeps the groups in their order and leaves out a group with no match', () => {
    const list = [
      option('Marketing', { group: 'Departments' }),
      option('Sales', { group: 'Departments' }),
      option('Content Team', { group: 'Marketing' }),
      option('Social Team', { group: 'Marketing' }),
      option('Field Sales', { group: 'Sales' }),
    ];
    expect(shownOptions(list, 'sales').map((o) => [o.group, o.label])).toEqual([
      ['Departments', 'Sales'],
      ['Sales', 'Field Sales'],
    ]);
    expect(shownOptions(list, 'team').map((o) => o.group)).toEqual(['Marketing', 'Marketing']);
  });

  it('shows nothing when nothing matches', () => {
    expect(shownOptions(countries, 'zz')).toEqual([]);
  });
});

describe('moving through the list', () => {
  const list = [option('A', { disabled: true }), option('B'), option('C', { disabled: true }), option('D')];

  it('passes over the options that cannot be chosen', () => {
    expect(nextChoosable(list, -1, 1)).toBe(1);
    expect(nextChoosable(list, 1, 1)).toBe(3);
    expect(nextChoosable(list, 3, -1)).toBe(1);
  });

  it('stays put at either end', () => {
    expect(nextChoosable(list, 3, 1)).toBe(3);
    expect(nextChoosable(list, 1, -1)).toBe(1);
  });

  it('finds nothing in a list where nothing can be chosen', () => {
    expect(nextChoosable([option('A', { disabled: true })], -1, 1)).toBe(-1);
    expect(nextChoosable([], -1, 1)).toBe(-1);
  });

  it('starts on the option chosen, else on the first that can be chosen', () => {
    expect(startingOption(list, 'D')).toBe(3);
    expect(startingOption(list, 'C')).toBe(1); // can't be chosen
    expect(startingOption(list, 'missing')).toBe(1);
  });
});
