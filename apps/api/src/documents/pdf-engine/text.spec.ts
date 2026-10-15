import { charScript, naturalWidth, paragraphDirection, visualRuns } from './text.js';

// One line as a PDF prints it (owner's decision, 15 October 2026): runs of one font and one direction, left to right
// as seen. A right-to-left run of Arabic letters is given in reading order, for the font engine to join its letters and
// turn it round; anything else as it is seen.

const runs = (line: string) => visualRuns(line).map((r) => [r.script, r.text, r.direction]);

describe('visualRuns', () => {
  it('prints Latin text, digits and dates left to right in the Latin font', () => {
    expect(runs('Omar Khaled')).toEqual([['latin', 'Omar Khaled', 'ltr']]);
    expect(runs('15/10/2026')).toEqual([['latin', '15/10/2026', 'ltr']]);
    expect(runs('omar.k@example.com')).toEqual([['latin', 'omar.k@example.com', 'ltr']]);
    expect(runs('')).toEqual([]);
  });

  it('gives Arabic in reading order, right to left, in the Arabic font', () => {
    expect(runs('محمد أحمد عبد الرحمن')).toEqual([['arabic', 'محمد أحمد عبد الرحمن', 'rtl']]);
  });

  it('keeps Arabic-Indic digits in their order, at the right of the Arabic that follows them', () => {
    // "١٢ شارع التحرير، الدقي - الجيزة": the number first in reading order, so right-most; the hyphen Naskh lacks
    expect(runs('١٢ شارع التحرير، الدقي - الجيزة')).toEqual([
      ['arabic', 'الجيزة', 'rtl'],
      ['latin', ' -', 'ltr'],
      ['arabic', ' شارع التحرير، الدقي ', 'rtl'],
      ['arabic', '١٢', 'ltr'],
    ]);
  });

  it('puts digits, Latin words and brackets inside Arabic text where they are read, mirrored brackets', () => {
    expect(runs('رقم 15/10/2026 (محمد) CIB')).toEqual([
      ['latin', 'CIB', 'ltr'],
      ['latin', ' (', 'ltr'], // the closing bracket, seen first from the left, printed as "("
      ['arabic', 'محمد', 'rtl'],
      ['latin', ') ', 'ltr'],
      ['latin', '15/10/2026', 'ltr'],
      ['arabic', 'رقم ', 'rtl'], // in reading order: the space after the word
    ]);
  });

  it('keeps an Arabic word inside an English line where it is read', () => {
    expect(runs('Paid to محمد at TrendLIX')).toEqual([
      ['latin', 'Paid to ', 'ltr'],
      ['arabic', 'محمد', 'rtl'],
      ['latin', ' at TrendLIX', 'ltr'],
    ]);
  });
});

// A line of a value that wraps (owner, 16 October 2026) reads as the whole value does, whatever its own first word.
describe('lines of a value that wraps', () => {
  it('reads a value as its first strong character does', () => {
    expect(paragraphDirection('بكالوريوس التجارة')).toBe('rtl');
    expect(paragraphDirection('15/10/2026 رقم')).toBe('rtl');
    expect(paragraphDirection('CIB بنك')).toBe('ltr');
    expect(paragraphDirection('2026')).toBe('ltr');
    expect(paragraphDirection('')).toBe('ltr');
  });

  it('lays a line out right to left when told, though it starts with a Latin word', () => {
    expect(visualRuns('CIB بنك').map((r) => r.text)).toEqual(['CIB ', 'بنك']);
    expect(visualRuns('CIB بنك', false, 'rtl').map((r) => r.text)).toEqual([' بنك', 'CIB']);
  });

  it('measures a line at 1 point, its runs as the PDF prints them', () => {
    expect(naturalWidth('')).toBe(0);
    expect(naturalWidth('Omar Khaled')).toBeGreaterThan(naturalWidth('Omar'));
    // the same line, whichever way it reads
    expect(naturalWidth('محمد أحمد', false, 'rtl')).toBeCloseTo(naturalWidth('محمد أحمد'), 6);
  });
});

describe('charScript', () => {
  it('prints a box’s character in the font that has it: Arabic letters and digits in Naskh, the rest in Noto Sans', () => {
    expect(['م', '٣', '7', 'A', '-', '،'].map((c) => charScript(c))).toEqual(['arabic', 'arabic', 'latin', 'latin', 'latin', 'arabic']);
  });
});
