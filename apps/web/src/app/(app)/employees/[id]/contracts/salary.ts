import { INSURABLE_WAGE, insuredSalary } from '@trendlix/shared';

// A contract's money, as the contract form previews it and the Employment tab shows it: amounts in EGP, the basic and
// variable parts of the gross, and the insured salary on the social insurance copy.

const money = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** 16700 → "EGP 16,700". */
export function formatEgp(amount: number): string {
  return `EGP ${money.format(amount)}`;
}

/** 16700 → "16,700". */
export function formatAmount(amount: number): string {
  return money.format(amount);
}

/**
 * An amount as typed: "15000", "15,000", "15 000" or in Arabic digits, with up to 2 decimals. "" → null (left empty);
 * anything else that is not an amount → NaN.
 */
export function parseAmount(input: string): number | null {
  const s = input.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[,\s]/g, '');
  if (s === '') return null;
  return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : NaN;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** The gross split by the basic percent (80% by default): the basic part, and the variable rest. */
export function splitSalary(gross: number, basicPercent: number): { basic: number; variable: number } {
  const basic = cents((gross * basicPercent) / 100);
  return { basic, variable: cents(gross - basic) };
}

/** The year whose insurable wage limits apply: the year itself, or the latest one known before it. */
function limitsYear(year: number): number {
  const known = Object.keys(INSURABLE_WAGE)
    .map(Number)
    .sort((a, b) => a - b);
  return INSURABLE_WAGE[year] ? year : (known.filter((y) => y <= year).at(-1) ?? known[0]);
}

/**
 * The insured salary for a gross, and why it is that amount: "the 2026 maximum" when the gross is above the year's
 * maximum insurable wage, "the 2026 minimum" when below its minimum, else "the actual gross".
 */
export function insuredFor(gross: number, year: number): { amount: number; why: string } {
  const amount = insuredSalary(gross, year);
  const limits = limitsYear(year);
  if (amount < gross) return { amount, why: `the ${limits} maximum` };
  if (amount > gross) return { amount, why: `the ${limits} minimum` };
  return { amount, why: 'the actual gross' };
}
