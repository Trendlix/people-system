// What a profile holds for the annual leave (owner, 18 October 2026: "can you apply the leaves according to the law?"):
// the service with earlier employers, which counts towards the 30 days of "عشر سنوات كاملة لدى صاحب عمل أو أكثر" (10 full
// years with one or more employers), a disability (45 days: "للأشخاص ذوى الإعاقة والأقزام") on Basic Data, and hazardous,
// unhealthy or remote work (7 days more: "تزاد مدة الإجازة السنوية بمقدار سبعة أيام") on the employment (Labour Law
// 14/2025, Art. 124). HR sets them. Pure code, tested: the prior service typed in years and months, and in words.

const latin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

/** The most prior service the form takes: 50 years. */
export const PRIOR_SERVICE_MAX_MONTHS = 600;

/** "4 years 6 months", "1 year", "8 months"; "None recorded" for none. */
export function priorServiceText(months: number | null | undefined): string {
  if (!months) return 'None recorded';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const part = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
  return [years > 0 && part(years, 'year'), rest > 0 && part(rest, 'month')].filter(Boolean).join(' ');
}

/** The years and months a saved prior service is shown as in its two fields ("" for 0). */
export function priorServiceFields(months: number | null | undefined): { years: string; months: string } {
  if (!months) return { years: '', months: '' };
  return { years: Math.floor(months / 12) ? String(Math.floor(months / 12)) : '', months: months % 12 ? String(months % 12) : '' };
}

/**
 * The prior service typed as years and months, in months as the API keeps it: null when both are empty (none), or an
 * error when they aren't whole numbers (the months 0 to 11), or come to more than 50 years.
 */
export function priorServiceFrom(years: string, months: string): { months: number | null; error: string | null } {
  const y = latin(years).trim();
  const m = latin(months).trim();
  if (y === '' && m === '') return { months: null, error: null };
  const error = 'Enter the service with earlier employers as whole years and months (0 to 11), e.g. 4 years 6 months, or leave both empty for none.';
  if ((y !== '' && !/^\d{1,2}$/.test(y)) || (m !== '' && !/^\d{1,2}$/.test(m)) || Number(m || 0) > 11) return { months: null, error };
  const total = Number(y || 0) * 12 + Number(m || 0);
  if (total > PRIOR_SERVICE_MAX_MONTHS) return { months: null, error };
  return { months: total === 0 ? null : total, error: null };
}
