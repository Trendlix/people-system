import Link from 'next/link';
import type { MonthCorrectable, MonthCorrection } from '@/lib/correction-types';
import { formatDate } from '@/lib/format';
import { leaveStatusLabel } from '../../leave/list';
import { correctionHref, dayCorrection } from './corrections';

// A day's correction on the attendance pages (owner, 19 October 2026: "My Attendance → the day → Ask for a correction"):
// the correction of the day being decided (opening its page), or a way to ask for one (the employee's own month), or to
// correct it (HR, on a person's month), on a day gone by or today, not of leave, in a month whose payroll isn't approved.

export function DayCorrectionCell({
  day,
  corrections,
  correctable,
  today,
  href,
  label,
  askFrom = null,
}: {
  day: { date: string; status: string };
  corrections: readonly MonthCorrection[];
  correctable: MonthCorrectable | null | undefined;
  today: string;
  /** Where asking (or correcting) for a day goes. */
  href: (date: string) => string;
  /** "Ask for a correction", or HR's "Correct". */
  label: string;
  /** The employee's own: the earliest day they can still ask about (owner, 31 October 2026: "locked after 2 working days"). */
  askFrom?: string | null;
}) {
  const c = dayCorrection(day, corrections, correctable, today, href, askFrom);
  if (!c) return null;
  if (c.kind === 'open') {
    return (
      <Link href={correctionHref(c.id)} className="text-sm whitespace-nowrap">
        Correction {leaveStatusLabel(c.status).toLowerCase()}
        <span className="sr-only"> for {formatDate(day.date)}</span>
      </Link>
    );
  }
  return (
    <Link href={c.href} className="text-sm font-semibold whitespace-nowrap">
      {label}
      <span className="sr-only"> for {formatDate(day.date)}</span>
    </Link>
  );
}
