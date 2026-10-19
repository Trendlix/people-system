import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment, Suspense } from 'react';
import { CLevelBadge } from '@/components/c-level-badge';
import { GroupHeading } from '@/components/group-heading';
import { formatDate, formatDateTime } from '@/lib/format';
import { groupByPlace, showsDepartment } from '@/lib/place-groups';
import { getCurrentUser } from '@/lib/session';
import type { ReimbursementClaimView } from '@/lib/types';
import { Empty, Loading } from '../organization/ui';
import { notLoadedText } from '../payroll/load';
import { loadClaims } from './data';
import {
  canSeeReimbursements,
  CLAIM_FILTERS,
  claimantCount,
  claimHref,
  claimsLabel,
  emptyText,
  NEW_CLAIM_PATH,
  placeOfClaim,
  readFilter,
  reimbursementsHref,
  type ClaimFilter,
} from './list';
import { ClaimAmount, ClaimProgress, ClaimStatusBadge } from './ui';

// Reimbursements, under Requests in the sidebar (owner, 18 October 2026: "allow the employee to add reimbursement
// request … for specific preset up conditions"): every employee's claims, newest first, filtered by status in the
// address (so a link keeps it): Waiting for you to start with for HR and Finance, who decide them in turn after the
// direct manager, and All for the CEO, who views them. Grouped by department, then team, as the other lists of people
// are. Each opens its page, with the receipts, the log of every step and, while it waits for the user, the decision
// form. Someone with an employee profile claims for themself with New reimbursement. The API checks every request again.
// A C-level person's claim (owner, 19 October 2026: "make C level Employees details not visible to HR") isn't listed to
// HR or Finance without Super Admin; the CEO decides its HR and Finance stages, so it says "With the CEO", is marked
// C-level for those who see it, and has Decide for the CEO when it waits for them (`waitingForYou`).

export const metadata: Metadata = { title: 'Reimbursements · People System' };

const chip = 'inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-semibold no-underline';
const SPAN = 7;

/** The status filter: one link per status, so the address keeps it. */
function Filters({ filter }: { filter: ClaimFilter }) {
  return (
    <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
      {CLAIM_FILTERS.map((o) => {
        const active = o.value === filter;
        return (
          <Link
            key={o.value}
            href={reimbursementsHref(o.value)}
            aria-current={active ? 'page' : undefined}
            className={`${chip} ${active ? 'border-ink bg-ink text-white hover:text-white' : 'border-line bg-white text-ink hover:bg-canvas hover:text-ink'}`}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}

function ClaimsTable({ claims }: { claims: ReimbursementClaimView[] }) {
  const groups = groupByPlace(claims, (c) => placeOfClaim(c.employee));
  const heading = (rows: ReimbursementClaimView[]) => ({ count: claimantCount(rows), note: claimsLabel(rows.length) });
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Employee</th>
            <th scope="col">Type</th>
            <th scope="col">Expense Date</th>
            <th scope="col" className="text-right">
              Amount
            </th>
            <th scope="col">Status</th>
            <th scope="col">Where It Stands</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.department ?? ''}>
            {showsDepartment(groups, g) && <GroupHeading level="department" name={g.department} span={SPAN} {...heading(g.teams.flatMap((t) => t.rows))} />}
            {g.teams.map((t) => (
              <Fragment key={t.team ?? ''}>
                {t.team !== null && <GroupHeading level="team" name={t.team} span={SPAN} {...heading(t.rows)} />}
                {t.rows.map((c) => (
                  <tr key={c.id} className={`align-top ${c.status === 'cancelled' ? 'text-muted' : ''}`}>
                    <td className="min-w-44">
                      <span className="font-semibold">{c.employee.fullNameEn}</span>
                      {c.confidential && <CLevelBadge className="ml-1.5" title="The CEO decides HR’s and Finance’s stages of a C-level person’s claim." />}
                      <div className="text-xs text-muted">Sent {formatDateTime(c.createdAt)}</div>
                    </td>
                    <td className="max-w-72 min-w-48">
                      <Link href={claimHref(c.id)} className="font-medium">
                        {c.type.nameEn}
                        <span className="sr-only"> claim by {c.employee.fullNameEn}</span>
                      </Link>
                      <p className="text-xs break-words text-muted">{c.description}</p>
                    </td>
                    <td className="whitespace-nowrap tabular-nums">{formatDate(c.expenseDate)}</td>
                    <td className="text-right whitespace-nowrap">
                      <ClaimAmount claim={c} />
                    </td>
                    <td>
                      <ClaimStatusBadge status={c.status} confidential={c.confidential} />
                    </td>
                    <td className="min-w-56 text-sm">
                      <ClaimProgress claim={c} />
                    </td>
                    <td className="text-right">
                      <Link href={claimHref(c.id)} className={c.waitingForYou ? 'btn btn-primary min-h-9 px-3' : 'text-sm font-semibold'}>
                        {c.waitingForYou ? 'Decide' : 'Open'}
                        <span className="sr-only">
                          {' '}
                          the {c.type.nameEn} claim by {c.employee.fullNameEn}
                        </span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        ))}
      </table>
      <p className="border-t border-line px-4 py-3 text-sm text-muted">{claimsLabel(claims.length)}, newest first in each group.</p>
    </div>
  );
}

async function Claims({ searchParams }: { searchParams: PageProps<'/reimbursements'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!canSeeReimbursements(user)) {
    return (
      <Empty>
        Only HR, Finance and the CEO see every claim. Your own are on <Link href="/my-requests">My Requests</Link>; a direct manager, team lead or
        head of department decides the claims waiting for them on <Link href="/my-team">My Team</Link>.
      </Empty>
    );
  }
  const filter = readFilter(query, user);
  const listing = await loadClaims(filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Filters filter={filter} />
        {user.employeeId && (
          <Link href={NEW_CLAIM_PATH} className="btn btn-primary">
            New reimbursement
          </Link>
        )}
      </div>
      {listing.kind === 'unavailable' ? (
        <Empty>Not available yet: the server does not have reimbursements yet.</Empty>
      ) : listing.kind === 'forbidden' ? (
        <Empty>Only HR, Finance and the CEO see every claim.</Empty>
      ) : listing.kind === 'failed' ? (
        <Empty>{notLoadedText(listing, 'claims')}</Empty>
      ) : listing.value.length === 0 ? (
        <Empty>
          {emptyText(filter)} {filter !== 'all' && <Link href={reimbursementsHref('all')}>Show all</Link>}
        </Empty>
      ) : (
        <ClaimsTable claims={listing.value} />
      )}
    </div>
  );
}

export default function ReimbursementsPage({ searchParams }: PageProps<'/reimbursements'>) {
  return (
    <div className="max-w-7xl">
      <h1 className="text-2xl font-semibold">Reimbursements</h1>
      <p className="mt-1 text-muted">
        Expenses employees claim back, each of a type set up in{' '}
        <Link href="/organization/payroll#reimbursement-types">Payroll Setup</Link> with its caps and conditions. The direct manager decides a claim
        first (for someone without one, their team lead, else their department&apos;s head), then HR, then Finance: each approves it, approves a lower amount or rejects it, with a comment. Finance&apos;s approval adds it,
        untaxed, to the next payroll. Every step is logged on the claim. A C-level person&apos;s claim goes to the CEO for HR&apos;s and
        Finance&apos;s stages.
      </p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Claims searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
