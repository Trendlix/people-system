import Link from 'next/link';
import { Suspense } from 'react';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import type { OfferListItem } from '@/lib/types';
import { formatEgp } from '../employees/[id]/contracts/salary';
import { todayInCairo } from '../employees/ui';
import { Empty, Loading } from '../organization/ui';
import { loadOffers } from './data';
import {
  canSeeOffers,
  countLabel,
  isFiltered,
  managesOffers,
  OFFER_STATUS_FILTERS,
  offerHref,
  offersHref,
  offersListPath,
  positionTitle,
  readOfferFilters,
  shownStatus,
  WHO_SEES,
  type OfferFilters,
} from './list';
import { OfferStatusBadge } from './ui';
import { Shown } from '@/components/hidden';

// Job offers (owner's request, 15 October 2026): a candidate is not an employee. HR drafts an offer, sends it by email
// or as a link, and the candidate accepts or declines it online; once accepted, the profile, the employment and a draft
// contract are made from it. Open offers (drafts, and sent ones not past their last day) by default; a GET form, so the
// address can be shared. The API filters; the pay only for those who see salaries.

type Query = Record<string, string | string[] | undefined>;

const dash = <span className="text-muted">—</span>;
const chip = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold no-underline';

function StatusChips({ filters: f }: { filters: OfferFilters }) {
  return (
    <nav aria-label="Status" className="flex flex-wrap gap-2 px-4 pt-4">
      {OFFER_STATUS_FILTERS.map((s) => {
        const active = f.status === s.value;
        return (
          <Link
            key={s.value}
            href={offersHref({ ...f, status: s.value })}
            aria-current={active ? 'page' : undefined}
            className={`${chip} ${active ? 'border-ink bg-ink text-white hover:text-white' : 'border-line bg-white text-ink hover:bg-canvas hover:text-ink'}`}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Search({ filters: f }: { filters: OfferFilters }) {
  return (
    // keyed by the filters, so following a link to other filters (Clear) shows them, not what was typed before
    <form key={offersHref(f)} className="flex flex-wrap items-end gap-3 p-4">
      {f.status !== 'open' && <input type="hidden" name="status" value={f.status} />}
      <div className="min-w-56 flex-1">
        <label htmlFor="offer-search" className="label">
          Search
        </label>
        <input
          id="offer-search"
          name="q"
          type="search"
          maxLength={100}
          defaultValue={f.q}
          placeholder="Name, email or offer number"
          className="input"
        />
      </div>
      <button type="submit" className="btn btn-secondary">
        Search
      </button>
      {isFiltered(f) && (
        <Link href="/offers" className="btn btn-secondary">
          Clear
        </Link>
      )}
    </form>
  );
}

function OfferRow({ offer: o, salary, today }: { offer: OfferListItem; salary: boolean; today: string }) {
  const status = shownStatus(o.status, o.expiresOn, today);
  // the last day to accept, while it matters: open, or just past
  const open = status === 'draft' || status === 'sent' || status === 'expired';
  return (
    <tr>
      <td className="whitespace-nowrap">
        <Link href={offerHref(o.id)} className="font-semibold tabular-nums">
          {/* hidden from a developer (23 October 2026): the link still opens it, by its id */}
          <Shown text={o.number} />
        </Link>
      </td>
      <td>
        <span className="font-semibold">{o.fullNameEn}</span>
        <div className="text-xs text-muted">
          <span lang="ar" dir="rtl">
            {o.fullNameAr}
          </span>
        </div>
      </td>
      <td>
        {positionTitle(o)}
        {o.departmentName && <div className="text-xs text-muted">{o.departmentName}</div>}
      </td>
      <td className="whitespace-nowrap tabular-nums">{formatDate(o.joinDate)}</td>
      {salary && (
        <td className="text-right whitespace-nowrap tabular-nums">
          {o.salaryHidden || o.totalSalary === null ? dash : formatEgp(o.totalSalary)}
          {!o.salaryHidden && o.grossSalary !== null && o.totalSalary !== null && o.totalSalary !== o.grossSalary && (
            <div className="text-xs text-muted">Gross {formatEgp(o.grossSalary)}</div>
          )}
        </td>
      )}
      <td>
        <OfferStatusBadge status={status} />
      </td>
      <td className="whitespace-nowrap tabular-nums">{o.sentAt ? formatDate(o.sentAt) : dash}</td>
      <td className="whitespace-nowrap tabular-nums">{open ? formatDate(o.expiresOn) : dash}</td>
    </tr>
  );
}

const quiet = 'border-t border-line px-4 py-10 text-center text-sm text-muted';

async function OfferList({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await getCurrentUser();
  if (!canSeeOffers(user)) return <Empty>{WHO_SEES}</Empty>;
  const f = readOfferFilters(await searchParams);
  const listing = await loadOffers(offersListPath(f));
  const today = todayInCairo();
  // the pay column only when the API sends any (HR and the CEO see salaries)
  const salary = listing.kind === 'ok' && listing.rows.some((o) => !o.salaryHidden);

  return (
    <div className="space-y-4">
      {managesOffers(user) && (
        <Link href="/offers/new" className="btn btn-primary">
          New offer
        </Link>
      )}
      <div className="card">
        <StatusChips filters={f} />
        <Search filters={f} />
        {listing.kind === 'unavailable' ? (
          <p className={quiet}>Not available yet: the server does not have job offers yet.</p>
        ) : listing.kind === 'failed' ? (
          <p className={quiet}>
            Couldn&apos;t load the offers. <span className="block pt-1 text-xs">{listing.message}</span>
          </p>
        ) : listing.rows.length === 0 ? (
          <p className={quiet}>
            No offers match.{' '}
            {isFiltered(f) ? (
              <Link href="/offers">Show the open offers</Link>
            ) : (
              managesOffers(user) && <Link href="/offers/new">Draft the first one</Link>
            )}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto border-t border-line">
              <table className="table">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Candidate</th>
                    <th>Position</th>
                    <th>Join Date</th>
                    {salary && <th className="text-right">Total Pay</th>}
                    <th>Status</th>
                    <th>Sent</th>
                    <th>Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {listing.rows.map((o) => (
                    <OfferRow key={o.id} offer={o} salary={salary} today={today} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line px-4 py-3 text-sm text-muted">{countLabel(listing.rows.length)}</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function OffersPage({ searchParams }: { searchParams: Promise<Query> }) {
  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold">Job Offers</h1>
      <p className="mt-1 text-muted">
        Candidates aren&apos;t employees yet: draft an offer, send it by email or as a link, and the candidate accepts or declines it online. Accepting makes
        their profile, the employment and a draft contract.
      </p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <OfferList searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
