import { parseTime } from './format';

// A 12-hour time chosen in three parts (owner, 20 October 2026, on the permission form's From and To typed as text: "make
// AM and PM a selector, as people might be confused" and "make the hours and minutes with a selector too. minutes with
// 15 minutes selector"): the hour 1–12, the minutes in quarter hours, and AM or PM. The form still sends the time as
// one field, "5:00 PM", as it was typed before, so the actions and their checks read it with parseTime (format.ts) as
// before. A time only partly chosen is sent as "5:-- PM": a time parseTime can't read, so every check that refuses a
// badly typed time refuses it too, where an empty field would read as no time at all. Pure code, tested.

export type Period = 'AM' | 'PM';

/** The three parts as chosen, '' for one not chosen yet. */
export interface TimeParts {
  /** "1" to "12". */
  hour: string;
  /** "00", "15", "30", "45", or another minute it had already, e.g. "07". */
  minute: string;
  period: Period | '';
}

export const NO_TIME: TimeParts = { hour: '', minute: '', period: '' };

export const HOURS: readonly string[] = Array.from({ length: 12 }, (_, i) => String(i + 1));

/** The minutes to choose from (owner, 20 October 2026: "minutes with 15 minutes selector"). */
export const QUARTERS: readonly string[] = ['00', '15', '30', '45'];

export const PERIODS: readonly Period[] = ['AM', 'PM'];

/** A part not chosen, in a time partly chosen. */
const GAP = '--';

/** A time partly chosen, as timeText writes it: "5:-- PM", "--:30 --". */
const PARTLY = /^(\d{1,2}|--):(\d{2}|--) (AM|PM|--)$/;

/**
 * The parts of a time: "5:00 PM" (or anything parseTime reads: "17:00", "5pm", "12:15 am"), or one partly chosen
 * ("5:-- PM"). "" and what can't be read have none chosen.
 */
export function timeParts(text: string): TimeParts {
  const s = text.trim();
  const partly = s.includes(GAP) ? PARTLY.exec(s) : null;
  if (partly) {
    const [, hour, minute, period] = partly;
    return {
      hour: HOURS.includes(String(Number(hour))) ? String(Number(hour)) : '',
      minute: /^[0-5]\d$/.test(minute) ? minute : '',
      period: period === 'AM' || period === 'PM' ? period : '',
    };
  }
  const hhmm = parseTime(s);
  if (!hhmm) return NO_TIME;
  const h = Number(hhmm.slice(0, 2));
  return { hour: String(h % 12 === 0 ? 12 : h % 12), minute: hhmm.slice(3), period: h < 12 ? 'AM' : 'PM' };
}

/** The field's value: "5:00 PM" with all three chosen, "" with none, "5:-- PM" with some. */
export function timeText(parts: TimeParts): string {
  if (!parts.hour && !parts.minute && !parts.period) return '';
  return `${parts.hour || GAP}:${parts.minute || GAP} ${parts.period || GAP}`;
}

/** Whether nothing is chosen. */
export const noneChosen = (parts: TimeParts) => timeText(parts) === '';

/**
 * The minutes to choose from: the quarter hours, and any other minute given (`kept`), e.g. "07" of a check-in at 9:07
 * AM or "10" of a shift at 9:10, so a time saved before is shown as it is, not changed.
 */
export function minuteOptions(...kept: string[]): string[] {
  const all = new Set(QUARTERS);
  for (const m of kept) if (/^[0-5]\d$/.test(m)) all.add(m);
  return [...all].sort();
}
