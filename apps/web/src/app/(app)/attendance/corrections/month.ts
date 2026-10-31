import type { CorrectableDay } from '@trendlix/shared';
import type { MonthCorrection, MonthCorrectionsPart } from '../../../../lib/correction-types';

// A person's month as the correction form takes it (owner, 19 October 2026: "Attendance corrections with approval"): its
// days as shown (each with its source), its corrections and whether its days can be corrected, from GET /attendance/me
// or GET /attendance/employees/:id. Pure, tested; relative imports, as vitest doesn't know the "@/" paths.

/** A day as the attendance pages have it: what the form needs of it. */
type ShownDay = Pick<CorrectableDay, 'status' | 'checkIn' | 'checkOut' | 'place'> & { date: string; source?: CorrectableDay['source']; flags?: readonly string[] };

export interface CorrectionMonthData {
  month: string;
  days: (CorrectableDay & { date: string })[];
  corrections: MonthCorrection[];
  correctable: { allowed: boolean; reason: string | null };
  /** Their own month: the earliest day they can still ask about (owner, 31 October 2026); null: not held to it. */
  askFrom: string | null;
}

/** The form's month from a person's view; null from an API from before corrections. */
export function correctionMonthOf(month: string, view: MonthCorrectionsPart & { person: { days: readonly ShownDay[] } }): CorrectionMonthData | null {
  if (!view.correctable || !view.corrections) return null;
  return {
    month,
    days: view.person.days.map((d) => ({ date: d.date, status: d.status, checkIn: d.checkIn, checkOut: d.checkOut, place: d.place, source: d.source ?? 'zoho', flags: d.flags ?? [] })),
    corrections: view.corrections,
    correctable: view.correctable,
    askFrom: view.ask?.from ?? null,
  };
}

/** A day asked for in the address (?date=YYYY-MM-DD), or none. */
export function askedDate(query: Record<string, string | string[] | undefined>): string | null {
  const v = typeof query.date === 'string' ? query.date : '';
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v) ? v : null;
}
