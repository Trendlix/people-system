import { OCCUPATIONS, searchOccupations } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { listStatus, moveActive, occupationLabel, OPTIONS_MAX, pickerOptions, startActive, typedQuery, type Occupation } from './occupation';

const sales: Occupation = ['212300', 'مدير مبيعات'];

describe('an occupation as written', () => {
  it('puts the code first, then the name', () => {
    expect(occupationLabel('212300', 'مدير مبيعات')).toBe('212300 · مدير مبيعات');
  });

  it('shows the code alone when its name is not known, and nothing for none', () => {
    expect(occupationLabel('212300', null)).toBe('212300');
    expect(occupationLabel('', 'مدير مبيعات')).toBe('');
    expect(occupationLabel(null)).toBe('');
    expect(occupationLabel(undefined)).toBe('');
  });
});

describe('what the picker lists', () => {
  it('finds an occupation by its name, spelt either way, best first', () => {
    const { options, more } = pickerOptions('مدير مبيعات', null, searchOccupations);
    expect(options[0]).toEqual(sales);
    expect(more).toBe(false);
    // ة typed for the table's ه, أ for its ا
    expect(pickerOptions('مهندس ميكانيكا التربة', null, searchOccupations).options[0][0]).toBe('022500');
    expect(pickerOptions('الأخصائيون في علوم الطبيعة', null, searchOccupations).options[0][0]).toBe('013900');
  });

  it('finds occupations by the first digits of their code', () => {
    const { options } = pickerOptions('2123', null, searchOccupations);
    expect(options.length).toBeGreaterThan(0);
    expect(options.every(([code]) => code.startsWith('2123'))).toBe(true);
    expect(options.map(([code]) => code)).toContain('212300');
  });

  it('shows at most 30, and says when there are more', () => {
    const { options, more } = pickerOptions('مهندس', null, searchOccupations);
    expect(options).toHaveLength(OPTIONS_MAX);
    expect(more).toBe(true);
  });

  it('lists nothing for what no occupation has', () => {
    expect(pickerOptions('zzzz', null, searchOccupations)).toEqual({ options: [], more: false });
    expect(pickerOptions('000000', null, searchOccupations).options).toEqual([]);
  });

  it('with nothing typed, lists the chosen one first, then the table from the start, without it twice', () => {
    const { options, more } = pickerOptions('  ', sales, searchOccupations);
    expect(options[0]).toEqual(sales);
    expect(options[1]).toEqual(OCCUPATIONS[0]);
    expect(options).toHaveLength(OPTIONS_MAX);
    expect(more).toBe(true);

    const first = OCCUPATIONS[0];
    const again = pickerOptions('', first, searchOccupations).options;
    expect(again.filter(([code]) => code === first[0])).toHaveLength(1);
    expect(again).toHaveLength(OPTIONS_MAX);
  });

  it('with nothing typed and none chosen, lists the table from the start', () => {
    expect(pickerOptions('', null, searchOccupations).options).toEqual(OCCUPATIONS.slice(0, OPTIONS_MAX));
  });

  it('takes the search it is given, with one more than it shows to know if there are more', () => {
    const asked: [string, number][] = [];
    const search = (q: string, limit: number) => {
      asked.push([q, limit]);
      return [sales, sales, sales];
    };
    expect(pickerOptions('x', null, search, 2)).toEqual({ options: [sales, sales], more: true });
    expect(asked).toEqual([['x', 3]]);
  });
});

describe('typing in the box that shows the chosen occupation', () => {
  const label = '212300 · مدير مبيعات';

  it('searches for what was typed after it or before it, without it', () => {
    expect(typedQuery(label, `${label}مهندس`)).toBe('مهندس');
    expect(typedQuery(label, `2123${label}`)).toBe('2123');
  });

  it('searches for what was typed over it when it was selected', () => {
    expect(typedQuery(label, 'م')).toBe('م');
    expect(typedQuery(label, 'مهندس ميكانيكا التربة')).toBe('مهندس ميكانيكا التربة');
  });

  it('starts afresh when some of it was deleted', () => {
    expect(typedQuery(label, label.slice(0, -1), true)).toBe('');
    expect(typedQuery(label, '', true)).toBe('');
    expect(typedQuery(label, label.slice(3), true)).toBe('');
  });

  it('takes the text as it is when none was chosen, or when it was changed in the middle', () => {
    expect(typedQuery('', 'مدير')).toBe('مدير');
    expect(typedQuery(label, '212300 · مدير X مبيعات')).toBe('212300 · مدير X مبيعات');
  });
});

describe('where the list starts', () => {
  const list: Occupation[] = [['011000', 'دكتور كيميائى'], sales, ['999400', 'عتال']];

  it('starts on the chosen occupation where it is listed', () => {
    expect(startActive(list, '212300')).toBe(1);
  });

  it('starts on the first otherwise, and on none for an empty list', () => {
    expect(startActive(list, '')).toBe(0);
    expect(startActive(list, '555555')).toBe(0);
    expect(startActive([], '212300')).toBe(-1);
  });
});

describe('the keys in the list', () => {
  it('moves down and up one at a time, stopping at the ends', () => {
    expect(moveActive('ArrowDown', -1, 5)).toBe(0);
    expect(moveActive('ArrowDown', 0, 5)).toBe(1);
    expect(moveActive('ArrowDown', 4, 5)).toBe(4);
    expect(moveActive('ArrowUp', 3, 5)).toBe(2);
    expect(moveActive('ArrowUp', 0, 5)).toBe(0);
  });

  it('goes to the last with Up from none', () => {
    expect(moveActive('ArrowUp', -1, 5)).toBe(4);
  });

  it('moves ten at a time with Page Down and Page Up', () => {
    expect(moveActive('PageDown', 0, 30)).toBe(10);
    expect(moveActive('PageDown', -1, 30)).toBe(10);
    expect(moveActive('PageDown', 25, 30)).toBe(29);
    expect(moveActive('PageUp', 25, 30)).toBe(15);
    expect(moveActive('PageUp', 4, 30)).toBe(0);
    expect(moveActive('PageUp', -1, 30)).toBe(0);
  });

  it('keeps within a list that got shorter', () => {
    expect(moveActive('ArrowDown', 12, 3)).toBe(2);
    expect(moveActive('ArrowUp', 12, 3)).toBe(1);
  });

  it('has nowhere to go in an empty list', () => {
    expect(moveActive('ArrowDown', -1, 0)).toBe(-1);
    expect(moveActive('PageUp', 3, 0)).toBe(-1);
  });

  it('leaves other keys to the text box', () => {
    for (const key of ['Home', 'End', 'Enter', 'Escape', 'a', 'ArrowLeft', 'Tab']) expect(moveActive(key, 1, 5)).toBeUndefined();
  });
});

describe('what the foot of the list says', () => {
  it('asks for something to search by when nothing is typed', () => {
    expect(listStatus(' ', 30, true)).toBe('Type part of the name, or the code.');
  });

  it('says when nothing matches, quoting what was typed', () => {
    expect(listStatus(' zzzz ', 0, false)).toBe('No occupation matches “zzzz”. Try fewer letters, or the code.');
  });

  it('says when only the first matches are shown, else how many', () => {
    expect(listStatus('مهندس', 30, true)).toBe('The first 30 matches. Type more to narrow them down.');
    expect(listStatus('مدير', 4, false)).toBe('4 matches.');
    expect(listStatus('212300', 1, false)).toBe('1 match.');
  });
});
