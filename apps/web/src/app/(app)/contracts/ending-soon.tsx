import Link from 'next/link';
import { Hidden } from '@/components/hidden';
import { formatDate } from '@/lib/format';
import { shownCode } from '@/lib/hidden';
import type { ContractEmployeeRef, ExpiringContract } from '@/lib/types';
import { LawWarningBadges } from '../employees/law-badges';
import { profileHref } from '../employees/tab-list';
import { dueNote } from '../organization/contracts/labels';
import { draftedBadges, expiringLine } from './expiring';

// The parts the home page's cards (Contracts Ending Soon, Probation Ending Soon, By the Labour Law) and the Contracts
// page's panels share: a date due, the person a row is about, and a contract ending soon. A developer gets these dates
// as null and the person's code as "••••" (owner, 23 October 2026: "in developer view use **** instead of IDs"): the date
// reads Hidden, in muted text ("Ends Hidden"), and the code is left out after the name, never a dangling "· ••••". Tested
// in ending-soon.test.ts.

const TONE = { passed: 'text-danger', soon: 'text-warn' } as const;
const NOTE_BADGE = { passed: 'bg-danger-soft text-danger', soon: 'bg-warn-soft text-warn' } as const;

/** A date, highlighted with a word ("Passed", "In 3 days") when it has passed or is within a week; Hidden for none. */
export function Due({ date, today }: { date: string | null; today: string }) {
  if (!date) return <Hidden />;
  const note = dueNote(date, today);
  return (
    <>
      <span className={`tabular-nums ${note ? `font-semibold ${TONE[note.tone]}` : ''}`}>{formatDate(date)}</span>
      {note && <span className={`badge ml-1.5 ${NOTE_BADGE[note.tone]}`}>{note.text}</span>}
    </>
  );
}

/** The person a row is about, opening their Employment tab: their name, and their code unless it is hidden. */
export function ContractPerson({ employee }: { employee: ContractEmployeeRef }) {
  const code = shownCode(employee.employeeCode);
  return (
    <Link href={profileHref(employee.id, 'employment')} className="font-medium">
      {employee.fullNameEn}
      {code && <span className="font-normal text-muted"> · {code}</span>}
    </Link>
  );
}

/**
 * A contract ending soon: the person and its end; under them, the day the non-renewal notice is due (or, for an
 * intern's agreement, what follows it: 19 October 2026), what is drafted after it, and the law's warning.
 */
export function ExpiringRow({ contract: c, today }: { contract: ExpiringContract; today: string }) {
  const below = expiringLine(c, today);
  return (
    <li className="space-y-1 py-2.5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <ContractPerson employee={c.employee} />
        <span>
          Ends <Due date={c.endDate} today={today} />
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted">
        <span>
          {below.kind === 'notice' ? (
            <>
              Non-renewal notice by <Due date={below.by} today={today} />
            </>
          ) : below.kind === 'training' ? (
            below.text
          ) : null}
        </span>
        <span className="flex flex-wrap gap-1.5">
          {draftedBadges(c).map((b) => (
            <span key={b} className="badge">
              {b}
            </span>
          ))}
          {/* past its end without a signed renewal: open-ended by the law (Art. 88), 18 October 2026 */}
          <LawWarningBadges of={c} />
        </span>
      </div>
    </li>
  );
}
