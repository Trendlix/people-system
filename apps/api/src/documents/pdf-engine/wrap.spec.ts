import { evenLines, fillLines, wrapText, wrapUnits } from './wrap.js';

// A text field that takes more than one line (owner, 16 October 2026): the value wrapped at its spaces in reading order,
// made smaller only when it doesn't fit in all its rows. Measured here as one point a character at 1 point.

const width = (line: string) => line.length;
const wrap = (text: string, options: Partial<Parameters<typeof wrapText>[1]> = {}) =>
  wrapText(text, { rows: 2, room: 20, size: 1, shrink: false, smallest: 0.25, width, ...options });

describe('wrapUnits', () => {
  it('splits a value at its spaces, a sign standing alone kept with the word before it', () => {
    expect(wrapUnits('بكالوريوس التجارة - شعبة المحاسبة - جامعة طنطا')).toEqual(['بكالوريوس', 'التجارة -', 'شعبة', 'المحاسبة -', 'جامعة', 'طنطا']);
    expect(wrapUnits('Omar Khaled')).toEqual(['Omar', 'Khaled']);
    expect(wrapUnits('- first')).toEqual(['-', 'first']);
    expect(wrapUnits('')).toEqual([]);
  });
});

describe('fillLines', () => {
  it('puts as many words on each line as fit, a word too long on a line of its own, and gives up past the most lines', () => {
    expect(fillLines(['aaaa', 'bbbb', 'cccc'], width, 9, 3)).toEqual(['aaaa bbbb', 'cccc']);
    expect(fillLines(['aaaaaaaaaaaa', 'bb'], width, 9, 3)).toEqual(['aaaaaaaaaaaa', 'bb']);
    expect(fillLines(['aaaa', 'bbbb', 'cccc'], width, 4, 2)).toBeNull();
  });
});

describe('evenLines', () => {
  it('spreads the words over the lines so that the widest is as narrow as it can be', () => {
    // filled one after another: "aaaa bbbb cccc" (14) and "dd" (2); evenly: 9 and 7
    expect(evenLines(['aaaa', 'bbbb', 'cccc', 'dd'], width, 2)).toEqual(['aaaa bbbb', 'cccc dd']);
    expect(evenLines(['aa', 'bb'], width, 4)).toEqual(['aa', 'bb']);
    expect(evenLines(['aa', 'bb'], width, 1)).toEqual(['aa bb']);
    expect(evenLines([], width, 2)).toEqual([]);
  });
});

describe('wrapText', () => {
  it('keeps a value that fits on one line on one line, at its size', () => {
    expect(wrap('short words')).toEqual({ lines: ['short words'], size: 1 });
  });

  it('wraps a longer one in reading order, the first words on the first line, before making it smaller', () => {
    expect(wrap('one two three four five six', { shrink: true })).toEqual({ lines: ['one two three four', 'five six'], size: 1 });
  });

  it('makes it smaller only when it doesn’t fit in all the rows, to the largest size at which it does', () => {
    const { lines, size } = wrap('aaaaaaaaaa bbbbbbbbbb cccccccccc', { shrink: true });
    expect(lines).toEqual(['aaaaaaaaaa bbbbbbbbbb', 'cccccccccc']);
    // "aaaaaaaaaa bbbbbbbbbb" is 21 characters in a room of 20
    expect(size).toBeCloseTo(20 / 21, 2);
    expect(size).toBeLessThanOrEqual(20 / 21);
  });

  it('without shrinking, or when it doesn’t fit even at the smallest size, spreads it over the rows as evenly as it goes', () => {
    const long = 'aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd';
    expect(wrap(long)).toEqual({ lines: ['aaaaaaaaaa bbbbbbbbbb', 'cccccccccc dddddddddd'], size: 1 });
    // 21 characters a line at 0.97 is still more than the room of 20
    expect(wrap(long, { shrink: true, smallest: 0.97 })).toEqual({ lines: ['aaaaaaaaaa bbbbbbbbbb', 'cccccccccc dddddddddd'], size: 0.97 });
    expect(wrap('', { shrink: true })).toEqual({ lines: [], size: 1 });
  });

  it('a single word too long for a row is made smaller to fit it, on one line', () => {
    const { lines, size } = wrap('omar.khaled.mahmoud@example.com', { shrink: true });
    expect(lines).toEqual(['omar.khaled.mahmoud@example.com']);
    expect(size).toBeCloseTo(20 / 31, 2);
  });
});
