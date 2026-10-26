import { suggestedExemptionStart, type SuggestedExemptionStart } from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';

// The first day a new exemption from check-in starts with (owner, 26 October 2026: "when exempting someone from
// attendance auto fill his contract start date in the exempt from date"; packages/shared check-in-exemptions.ts
// suggestedExemptionStart): read from a person's current employment, its join date and its signed contract versions.
// Sent with the profile's exemptions and Check-in Setup's people (the forms' own loads), and taken for each person when
// several are added at once with no day typed. A developer gets none: suggestedFrom is an employment's date
// (packages/shared developer.ts).

/** A person's current employment as the first day is read from it: its join date and its signed versions. */
export const START_EMPLOYMENT = {
  where: { endDate: null },
  orderBy: { joinDate: 'desc' },
  take: 1,
  select: {
    joinDate: true,
    contracts: { where: { status: { in: ['active', 'superseded'] } }, select: { number: true, version: true, kind: true, status: true, startDate: true } },
  },
} satisfies Prisma.Employee$employmentsArgs;

type StartEmployment = Prisma.EmploymentGetPayload<{ select: (typeof START_EMPLOYMENT)['select'] }>;

/** The first day for a person, from their current employment as START_EMPLOYMENT reads it (none: today). */
export function startOf(employment: StartEmployment | null | undefined, today: string): SuggestedExemptionStart {
  if (!employment) return suggestedExemptionStart(null, today);
  return suggestedExemptionStart(
    { joinDate: fromDateOnly(employment.joinDate), contracts: employment.contracts.map((c) => ({ ...c, startDate: fromDateOnly(c.startDate) })) },
    today,
  );
}
