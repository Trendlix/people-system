// Amounts in English words (owner's request, 15 October 2026: "I need the gross salary in English"), beside the
// Arabic ones in arabic.ts: 15000 → "Fifteen thousand Egyptian pounds only", 13069.65 → "Thirteen thousand sixty-nine
// Egyptian pounds and sixty-five piasters only". Rounded to the piaster; 0 to 999,999,999.99, as in Arabic.

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES: readonly [number, string][] = [
  [1_000_000, 'million'],
  [1_000, 'thousand'],
];
const MAX_PIASTERS = 99_999_999_999;

/** 1 to 999 in words: "three hundred forty-five". */
function belowThousand(n: number): string {
  const words: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) words.push(`${ONES[hundreds]} hundred`);
  if (rest >= 20) words.push(TENS[Math.floor(rest / 10)] + (rest % 10 ? `-${ONES[rest % 10]}` : ''));
  else if (rest) words.push(ONES[rest]);
  return words.join(' ');
}

/** A whole number from 1 to 999,999,999 in words: "thirteen thousand sixty-nine". */
export function englishNumber(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 999_999_999) throw new RangeError(`Not a whole number from 1 to 999,999,999: ${n}`);
  const words: string[] = [];
  let rest = n;
  for (const [size, name] of SCALES) {
    const count = Math.floor(rest / size);
    if (count) words.push(`${belowThousand(count)} ${name}`);
    rest %= size;
  }
  if (rest) words.push(belowThousand(rest));
  return words.join(' ');
}

/** An amount of Egyptian pounds in English words, starting with a capital and ending with "only". */
export function englishAmountInWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError(`Not an amount: ${amount}`);
  const total = Math.round(amount * 100);
  if (total > MAX_PIASTERS) throw new RangeError(`Amount too large to write in words: ${amount}`);
  const pounds = Math.floor(total / 100);
  const piasters = total % 100;
  const parts: string[] = [];
  if (pounds) parts.push(`${englishNumber(pounds)} Egyptian ${pounds === 1 ? 'pound' : 'pounds'}`);
  if (piasters) parts.push(`${englishNumber(piasters)} ${piasters === 1 ? 'piaster' : 'piasters'}`);
  if (!parts.length) parts.push('zero Egyptian pounds');
  const text = `${parts.join(' and ')} only`;
  return text[0].toUpperCase() + text.slice(1);
}
