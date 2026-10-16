// The rates set by law, by year (owner's request, 16 October 2026: "creating a setup page for payroll to enter the
// variables that might affect the sheet"): the social insurance shares and the insurable wage limits, the personal
// exemption, the Martyrs' Fund, comprehensive health insurance, and the salary tax's tiers and bands, "editable by
// superadmin, to modify it if the law changed". Kept in the database by year (Organization → Payroll): the Super Admin
// changes them; HR, Finance, the CEO and Admin read them. Each set applies from its year: a year without its own uses
// the latest earlier one, and a year before them all the earliest. A payroll run keeps a copy of the set it was worked
// out with. The built-in values below are the law as it was when the page came (Law 7/2024, and NOSI's insurable
// limits for 2025 and 2026): the law rates migration put the same values in the database, and lines worked out before
// it used them.

/** A band of a tax schedule: the annual net income up to `upTo` (null: no limit, the last band) is taxed at `rate` (0.1 for 10%). */
export interface TaxBand {
  upTo: number | null;
  rate: number;
}

/**
 * A tier of the salary tax: chosen when the whole annual net income is at most `upTo` (null: no limit, the last tier),
 * and then the whole income is taxed on the tier's bands, from 0.
 */
export interface TaxTier {
  upTo: number | null;
  bands: readonly TaxBand[];
}

/** A year's rates set by law. Rates as fractions (0.11 for 11%), amounts in EGP. */
export interface LawRates {
  /** The year they apply from. */
  year: number;
  /** The employee's and the company's shares of social insurance, on the insured wage (Law 148/2019). */
  employeeInsuranceRate: number;
  employerInsuranceRate: number;
  /** The insured wage's limits, a month (Social Insurance Law 148/2019; NOSI). */
  insurableWageMin: number;
  insurableWageMax: number;
  /** The yearly personal exemption (Law 91/2005 Art. 13 as replaced by Law 7/2024). */
  personalExemption: number;
  /** The Martyrs' and Victims' Families Fund, on the gross (Law 4/2021). */
  martyrsRate: number;
  /** Comprehensive health insurance, the employee's share (Law 2/2018): 0 while it doesn't apply in Cairo. */
  healthInsuranceRate: number;
  /** The salary tax's tiers, lowest first (Law 91/2005 Art. 8 as replaced by Law 7/2024). */
  taxTiers: readonly TaxTier[];
}

/** The rates' fields other than the year: what a year's row holds. */
export const LAW_RATE_FIELDS = [
  'employeeInsuranceRate',
  'employerInsuranceRate',
  'insurableWageMin',
  'insurableWageMax',
  'personalExemption',
  'martyrsRate',
  'healthInsuranceRate',
] as const satisfies readonly (keyof LawRates)[];

/** The normal schedule: each band's upper limit (annual net income) and its rate. */
const NORMAL: readonly TaxBand[] = [
  { upTo: 40_000, rate: 0 },
  { upTo: 55_000, rate: 0.1 },
  { upTo: 70_000, rate: 0.15 },
  { upTo: 200_000, rate: 0.2 },
  { upTo: 400_000, rate: 0.225 },
  { upTo: null, rate: 0.25 },
];

/**
 * Law 7/2024 (Art. 8, in force for salaries from 1 March 2024): the tier is chosen by the whole annual net income, and
 * the whole income is taxed on that tier's schedule: above 600,000 the lowest bands are lost one by one, above
 * 1,200,000 everything up to it is at 25% and the rest at 27.5%. So the tax jumps at each tier's limit.
 */
export const LAW_7_2024_TAX_TIERS: readonly TaxTier[] = [
  { upTo: 600_000, bands: NORMAL },
  { upTo: 700_000, bands: NORMAL.slice(1) },
  { upTo: 800_000, bands: NORMAL.slice(2) },
  { upTo: 900_000, bands: NORMAL.slice(3) },
  { upTo: 1_200_000, bands: NORMAL.slice(4) },
  {
    upTo: null,
    bands: [
      { upTo: 1_200_000, rate: 0.25 },
      { upTo: null, rate: 0.275 },
    ],
  },
];

/** Law 7/2024 and the shares of the time, the same in 2025 and 2026. */
const LAW_7_2024 = {
  employeeInsuranceRate: 0.11,
  employerInsuranceRate: 0.1875,
  personalExemption: 20_000,
  martyrsRate: 0.0005,
  healthInsuranceRate: 0,
  taxTiers: LAW_7_2024_TAX_TIERS,
} as const;

/**
 * The built-in rates, oldest first: Law 7/2024 with the insurable wage limits of 2025 and 2026 (NOSI, 30 November
 * 2025). The law rates migration seeded these rows, so a year's figures are the same from the database; lines worked
 * out before then have no copy of their own and use these.
 */
export const BUILT_IN_LAW_RATES: readonly LawRates[] = [
  { year: 2025, ...LAW_7_2024, insurableWageMin: 2300, insurableWageMax: 14500 },
  { year: 2026, ...LAW_7_2024, insurableWageMin: 2700, insurableWageMax: 16700 },
];

/**
 * The rates that apply in `year`, from the years kept: the latest from that year or before, else (a year before them
 * all) the earliest. With none kept, the built-in ones.
 */
export function lawRatesFor(year: number, years: readonly LawRates[] = BUILT_IN_LAW_RATES): LawRates {
  const known = [...(years.length ? years : BUILT_IN_LAW_RATES)].sort((a, b) => a.year - b.year);
  return known.filter((r) => r.year <= year).at(-1) ?? known[0];
}

/** A year's rates, or a year, for the built-in rates of that year (see lawRatesFor). */
export type LawRatesOrYear = LawRates | number;

/** The rates themselves: those given, or the built-in ones for a year. */
export const ratesOf = (rates: LawRatesOrYear): LawRates => (typeof rates === 'number' ? lawRatesFor(rates) : rates);

/** A limit as the tax works with it: null is no limit. */
export const limitOf = (upTo: number | null): number => upTo ?? Infinity;

/** The tier limits: where the tax jumps (annual net income). */
export function taxTierLimits(tiers: readonly TaxTier[]): number[] {
  return tiers.flatMap((t) => (t.upTo === null ? [] : [t.upTo]));
}

/**
 * The tiers in a fixed shape, `{ upTo, bands: [{ upTo, rate }] }`, whatever order the database keeps their keys in, so
 * two tables compare as the same when they are.
 */
export function normalTaxTiers(tiers: readonly TaxTier[]): TaxTier[] {
  return tiers.map((t) => ({ upTo: t.upTo, bands: t.bands.map((b) => ({ upTo: b.upTo, rate: b.rate })) }));
}

/** The rates in a fixed shape (see normalTaxTiers), the year first. */
export function normalLawRates(r: LawRates): LawRates {
  return {
    year: r.year,
    employeeInsuranceRate: r.employeeInsuranceRate,
    employerInsuranceRate: r.employerInsuranceRate,
    insurableWageMin: r.insurableWageMin,
    insurableWageMax: r.insurableWageMax,
    personalExemption: r.personalExemption,
    martyrsRate: r.martyrsRate,
    healthInsuranceRate: r.healthInsuranceRate,
    taxTiers: normalTaxTiers(r.taxTiers),
  };
}

// ---------- checks ----------

/** The most tiers, and bands in a tier: far more than the law has. */
export const MAX_TAX_TIERS = 20;
export const MAX_TAX_BANDS = 20;

/** The years a table can be for. */
export const LAW_YEAR_MIN = 2000;
export const LAW_YEAR_MAX = 2100;

const amountText = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A finite number. */
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** At most `places` decimals, allowing for the noise of binary fractions. */
const decimals = (v: number, places: number) => Math.abs(Math.round(v * 10 ** places) - v * 10 ** places) < 1e-6;

/** A rate is a fraction from 0 to 1 with at most 6 decimals: a percent to 4 decimals (0.05% is 0.0005). */
const isRate = (v: unknown): v is number => isNumber(v) && v >= 0 && v <= 1 && decimals(v, 6);

/** An amount above 0, to the piaster. */
const isLimit = (v: unknown): v is number => isNumber(v) && v > 0 && decimals(v, 2);

/**
 * What is wrong with a tax table, in plain words (none: it can be used): at least one tier, each tier's income limit
 * above the one before and only the last tier without one, so that every income falls in a tier; in each tier at least
 * one band, each band's limit above the one before, only the last band without one, so the whole income is taxed, and
 * every rate from 0% to 100%.
 */
export function taxTiersProblems(tiers: unknown): string[] {
  if (!Array.isArray(tiers) || tiers.length === 0) return ['Add at least one tax tier.'];
  if (tiers.length > MAX_TAX_TIERS) return [`Keep the tax table to ${MAX_TAX_TIERS} tiers or fewer.`];
  const problems: string[] = [];
  let before: number | null = null;
  tiers.forEach((tier: unknown, i) => {
    const name = `Tier ${i + 1}`;
    const last = i === tiers.length - 1;
    if (typeof tier !== 'object' || tier === null) {
      problems.push(`${name} is not a tier: give its income limit and its bands.`);
      return;
    }
    const { upTo, bands } = tier as { upTo?: unknown; bands?: unknown };
    if (last) {
      if (upTo !== null) problems.push('The last tier must have no income limit, so that every income falls in a tier.');
    } else if (upTo === null || upTo === undefined) {
      problems.push(`${name}: only the last tier can be without an income limit.`);
    } else if (!isLimit(upTo)) {
      problems.push(`${name}: enter its income limit as an amount above 0, to the piaster.`);
    } else {
      if (before !== null && upTo <= before) problems.push(`${name}'s income limit (${amountText(upTo)}) must be above tier ${i}'s (${amountText(before)}).`);
      before = upTo;
    }
    problems.push(...bandsProblems(name, bands));
  });
  return problems;
}

/** What is wrong with a tier's bands (see taxTiersProblems). */
function bandsProblems(tier: string, bands: unknown): string[] {
  if (!Array.isArray(bands) || bands.length === 0) return [`${tier} has no bands: add at least one.`];
  if (bands.length > MAX_TAX_BANDS) return [`${tier}: keep it to ${MAX_TAX_BANDS} bands or fewer.`];
  const problems: string[] = [];
  let before: number | null = null;
  bands.forEach((band: unknown, j) => {
    const name = `${tier}, band ${j + 1}`;
    const last = j === bands.length - 1;
    if (typeof band !== 'object' || band === null) {
      problems.push(`${name} is not a band: give its upper limit and its rate.`);
      return;
    }
    const { upTo, rate } = band as { upTo?: unknown; rate?: unknown };
    if (last) {
      if (upTo !== null) problems.push(`${tier}: its last band must have no upper limit, so that the whole income is taxed.`);
    } else if (upTo === null || upTo === undefined) {
      problems.push(`${name}: only the last band can be without an upper limit.`);
    } else if (!isLimit(upTo)) {
      problems.push(`${name}: enter its upper limit as an amount above 0, to the piaster.`);
    } else {
      if (before !== null && upTo <= before) problems.push(`${name}'s upper limit (${amountText(upTo)}) must be above band ${j}'s (${amountText(before)}).`);
      before = upTo;
    }
    if (!isRate(rate)) problems.push(`${name}: enter its rate as a percent from 0 to 100, with up to 4 decimals.`);
  });
  return problems;
}

/** Each rate's name, for the messages. */
const RATE_NAMES = {
  employeeInsuranceRate: "The employee's social insurance share",
  employerInsuranceRate: "The company's social insurance share",
  martyrsRate: "The Martyrs' Fund rate",
  healthInsuranceRate: 'The health insurance rate',
} as const;

/**
 * What is wrong with a year's rates, in plain words (none: they can be kept): the year from 2000 to 2100, each rate
 * from 0% to 100%, the insurable wage's minimum above 0 and its maximum not below it, the exemption not below 0, all to
 * the piaster, and the tax table (taxTiersProblems).
 */
export function lawRatesProblems(r: LawRates): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(r.year) || r.year < LAW_YEAR_MIN || r.year > LAW_YEAR_MAX) problems.push(`Enter the year from ${LAW_YEAR_MIN} to ${LAW_YEAR_MAX}.`);
  for (const [key, name] of Object.entries(RATE_NAMES) as [keyof typeof RATE_NAMES, string][]) {
    if (!isRate(r[key])) problems.push(`${name} must be a percent from 0 to 100, with up to 4 decimals.`);
  }
  if (!isLimit(r.insurableWageMin)) problems.push('Enter the minimum insurable wage as an amount above 0, to the piaster.');
  if (!isLimit(r.insurableWageMax)) problems.push('Enter the maximum insurable wage as an amount above 0, to the piaster.');
  else if (isLimit(r.insurableWageMin) && r.insurableWageMax < r.insurableWageMin) {
    problems.push(`The maximum insurable wage (${amountText(r.insurableWageMax)}) can't be below the minimum (${amountText(r.insurableWageMin)}).`);
  }
  if (!isNumber(r.personalExemption) || r.personalExemption < 0 || !decimals(r.personalExemption, 2)) {
    problems.push('Enter the personal exemption as an amount of 0 or more, to the piaster.');
  }
  problems.push(...taxTiersProblems(r.taxTiers));
  return problems;
}
