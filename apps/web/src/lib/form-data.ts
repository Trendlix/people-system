import { parseDate, parseTime } from './format';

// Reading typed dates and times out of a submitted form, for the API.
// The screens use DD/MM/YYYY and 12-hour times (see format.ts); the API takes YYYY-MM-DD and HH:mm.

/** A DD/MM/YYYY field as YYYY-MM-DD. "" stays "" (clears the field); a bad date adds a message to `errors`. */
export function dateFrom(fd: FormData, key: string, label: string, errors: string[]): string {
  const raw = String(fd.get(key) ?? '');
  const parsed = parseDate(raw);
  if (parsed === null) {
    errors.push(`Enter the ${label} as DD/MM/YYYY, e.g. 14/10/2026.`);
    return raw;
  }
  return parsed;
}

/** A 12-hour time field ("9:00 AM") as HH:mm. "" stays ""; a bad time adds a message to `errors`. */
export function timeFrom(fd: FormData, key: string, label: string, errors: string[]): string {
  const raw = String(fd.get(key) ?? '');
  const parsed = parseTime(raw);
  if (parsed === null) {
    errors.push(`Enter the ${label} as a 12-hour time, e.g. 9:00 AM.`);
    return raw;
  }
  return parsed;
}
