// Amounts, durations and weekdays in Arabic words, as the owner's documents print them (15 October 2026).
//
// Amounts follow the Ministry of Finance printout the owner gave (a net salary in words):
//   "ثلاثة عشر ألف و تسعة و ستون جنيها مصرياً و خمسة و ستون قرشاً فقط لا غير"
// that is: the pounds, then the piasters, then "فقط لا غير"; و a word of its own followed by a space, between every
// part of the number and before the piasters; and ألف (not ألفاً) after 11–99 even when more of the number follows.
// One letter differs on purpose: the printout's "جنيها" is written "جنيهاً", with the tanween it gives مصرياً
// and قرشاً.
//
// Grammar chosen, consistently, for amounts and durations alike:
// - Numbers are in the nominative, as the printout and Egyptian contracts print them: اثنان، اثنا عشر، عشرون،
//   ستون، مائتان، ألفان، مليونان (not اثنين، عشرين، مائتين).
// - Ones before tens: تسعة و ستون.
// - The counted noun follows the classical rules, by the number's last two digits:
//     1        the noun with واحد after it: جنيه مصري واحد، شهر واحد، سنة ميلادية واحدة
//     2        the dual alone: جنيهان مصريان، شهران، سنتان ميلاديتان
//     3–10     the number takes the opposite gender, the noun the plural: ثلاثة جنيهات مصرية، ثلاث سنوات ميلادية
//     11–99    the noun singular, accusative: خمسون جنيهاً مصرياً، ثمانية عشر شهراً
//     00       after مائة، ألف، مليون the noun singular, genitive: مائة جنيه مصري، خمسة عشر ألف جنيه مصري
//     01, 02   past 100 the common usage: مائة و واحد جنيه مصري، ألف و اثنان جنيه مصري
//   ألف and مليون are counted the same way (masculine): ألف، ألفان، ثلاثة آلاف، ثلاثة عشر ألف، مائة ألف.
// - A dual directly followed by what it counts is in construct, as the grammar wants: مائتا جنيه، ألفا جنيه،
//   مائتا ألف، مليونا جنيه; followed by more of the number it isn't: ألفان و خمسمائة.
// - Spelling: مائة (with alif, as Egyptian contracts write it), and the hundreds as one word: ثلاثمائة، ثمانمائة.

/** Between the parts of a number, and before the piasters. */
const AND = ' و ';

interface Counted {
  feminine: boolean;
  /** 1 */
  one: string;
  /** 2 */
  two: string;
  /** 3–10 */
  plural: string;
  /** 11–99 */
  accusative: string;
  /** After مائة، ألف، مليون. */
  genitive: string;
}

const POUND: Counted = { feminine: false, one: 'جنيه مصري واحد', two: 'جنيهان مصريان', plural: 'جنيهات مصرية', accusative: 'جنيهاً مصرياً', genitive: 'جنيه مصري' };
const PIASTER: Counted = { feminine: false, one: 'قرش واحد', two: 'قرشان', plural: 'قروش', accusative: 'قرشاً', genitive: 'قرش' };
const YEAR: Counted = { feminine: true, one: 'سنة ميلادية واحدة', two: 'سنتان ميلاديتان', plural: 'سنوات ميلادية', accusative: 'سنة ميلادية', genitive: 'سنة ميلادية' };
const MONTH: Counted = { feminine: false, one: 'شهر واحد', two: 'شهران', plural: 'أشهر', accusative: 'شهراً', genitive: 'شهر' };

interface Multiplier {
  /** 1, 11–99 and after مائة */
  one: string;
  two: string;
  /** The dual directly followed by what it counts. */
  twoConstruct: string;
  /** 3–10 */
  plural: string;
}

const THOUSAND: Multiplier = { one: 'ألف', two: 'ألفان', twoConstruct: 'ألفا', plural: 'آلاف' };
const MILLION: Multiplier = { one: 'مليون', two: 'مليونان', twoConstruct: 'مليونا', plural: 'ملايين' };

// counting a masculine noun (the number feminine from 3 to 10), and a feminine one
const ONES_MASCULINE = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة'];
const ONES_FEMININE = ['', 'واحدة', 'اثنتان', 'ثلاث', 'أربع', 'خمس', 'ست', 'سبع', 'ثماني', 'تسع', 'عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

/** 1–99 */
function belowHundred(n: number, feminine: boolean): string {
  const ones = feminine ? ONES_FEMININE : ONES_MASCULINE;
  if (n <= 10) return ones[n];
  if (n === 11) return feminine ? 'إحدى عشرة' : 'أحد عشر';
  if (n === 12) return feminine ? 'اثنتا عشرة' : 'اثنا عشر';
  if (n < 20) return `${ones[n % 10]} ${feminine ? 'عشرة' : 'عشر'}`;
  const unit = n % 10;
  const tens = TENS[Math.floor(n / 10)];
  if (!unit) return tens;
  return `${unit === 1 && feminine ? 'إحدى' : ones[unit]}${AND}${tens}`;
}

/** 1–999; `construct`: directly followed by what it counts. */
function belowThousand(n: number, feminine: boolean, construct: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(hundreds === 2 && !rest && construct ? 'مائتا' : HUNDREDS[hundreds]);
  if (rest) parts.push(belowHundred(rest, feminine));
  return parts.join(AND);
}

/** 1–999 thousands or millions, e.g. ثلاثة آلاف، ثلاثة عشر ألف، مائتا ألف. */
function multiples(count: number, unit: Multiplier, construct: boolean): string {
  if (count === 1) return unit.one;
  if (count === 2) return construct ? unit.twoConstruct : unit.two;
  const rest = count % 100;
  return `${belowThousand(count, false, true)} ${rest >= 3 && rest <= 10 ? unit.plural : unit.one}`;
}

/** 1–999,999,999 without the noun it counts. */
function numberWords(n: number, feminine: boolean, construct: boolean): string {
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor(n / 1000) % 1000;
  const units = n % 1000;
  const parts: string[] = [];
  if (millions) parts.push(multiples(millions, MILLION, construct && !thousands && !units));
  if (thousands) parts.push(multiples(thousands, THOUSAND, construct && !units));
  if (units) parts.push(belowThousand(units, feminine, construct));
  return parts.join(AND);
}

/** A number (1–999,999,999) of something, e.g. خمسة عشر ألف جنيه مصري، ثلاث سنوات ميلادية. */
function counted(n: number, noun: Counted): string {
  if (n === 1) return noun.one;
  if (n === 2) return noun.two;
  const rest = n % 100;
  const form = rest >= 3 && rest <= 10 ? noun.plural : rest >= 11 ? noun.accusative : noun.genitive;
  return `${numberWords(n, noun.feminine, rest === 0)} ${form}`;
}

const MAX_PIASTERS = 99_999_999_999; // 999,999,999.99 pounds

/**
 * An amount of Egyptian pounds in Arabic words, as the Ministry of Finance prints it: 15000 → "خمسة عشر ألف جنيه
 * مصري فقط لا غير", 13069.65 → "ثلاثة عشر ألف و تسعة و ستون جنيهاً مصرياً و خمسة و ستون قرشاً فقط لا غير".
 * Rounded to the piaster; 0 to 999,999,999.99.
 */
export function arabicAmountInWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError(`Not an amount: ${amount}`);
  const total = Math.round(amount * 100);
  if (total > MAX_PIASTERS) throw new RangeError(`Amount too large to write in words: ${amount}`);
  const pounds = Math.floor(total / 100);
  const piasters = total % 100;
  const parts: string[] = [];
  if (pounds) parts.push(counted(pounds, POUND));
  if (piasters) parts.push(counted(piasters, PIASTER));
  if (!parts.length) parts.push(`صفر ${POUND.genitive}`);
  return `${parts.join(AND)} فقط لا غير`;
}

/**
 * A contract's length in Arabic: in years when a whole number of them (12 → "سنة ميلادية واحدة",
 * 24 → "سنتان ميلاديتان", 36 → "ثلاث سنوات ميلادية"), in months otherwise (6 → "ستة أشهر", 18 → "ثمانية عشر شهراً").
 */
export function arabicDuration(months: number): string {
  if (!Number.isInteger(months) || months < 1 || months > 999_999_999) throw new RangeError(`Not a number of months: ${months}`);
  return months % 12 === 0 ? counted(months / 12, YEAR) : counted(months, MONTH);
}

const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** The Arabic name of a calendar date's weekday (YYYY-MM-DD, no time zone involved), e.g. 2026-10-15 → "الخميس". */
export function arabicWeekday(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const [year, month, day] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [NaN, NaN, NaN];
  const at = new Date(Date.UTC(year, month - 1, day));
  if (!m || at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) {
    throw new RangeError(`Not a date (YYYY-MM-DD): ${date}`);
  }
  return WEEKDAYS[at.getUTCDay()];
}
