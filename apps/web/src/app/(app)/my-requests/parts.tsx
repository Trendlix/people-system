import {
  ArrowLeftRight,
  ArrowRight,
  Briefcase,
  CalendarCheck,
  CalendarDays,
  Clock,
  DoorOpen,
  House,
  MapPin,
  Receipt,
  TrendingUp,
  UserPen,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { IconTile, PanelHead, Pill, Ring } from '@/components/design';
import { formatDate } from '@/lib/format';
import type { LeaveBalances, LeaveTypeView } from '@/lib/types';
import { annualFigures } from '../leave/balance';
import { daysNumber, requestsLabel } from '../leave/list';
import {
  emptyHistoryText,
  filterHistory,
  HISTORY_FILTER_LABELS,
  HISTORY_ID,
  HISTORY_LIMIT,
  historyHref,
  type HistoryFilter,
  type HistoryKind,
  type HistoryRow,
  type HistoryState,
} from './history';
import { annualShareLeft, otherLeaveFigure, otherLeaveTypes, percentText } from './overview';

// The parts of My Requests drawn to the owner's design (Figma "PeopleTrendlix", the desktop version, 30 October 2026):
// the annual leave card with its ring and bar, the figure tiles beside it, Recent requests with its All / Approved /
// Waiting filter, the Other leave cards, the cards to start a request, and a section's head on the page. Built on the
// shared kit (components/design.tsx); the figure tile is the design's tall one (icon, label, figure, a note at the foot),
// which the kit's StatTile (a row) isn't. Colours from globals.css, so they follow the light and the dark look. No hooks.

/** The icon each kind of request shows, in Recent requests and on its card to start one. */
export const KIND_ICONS: Record<HistoryKind, LucideIcon> = {
  leave: CalendarDays,
  permission: Clock,
  correction: CalendarCheck,
  wfh: House,
  od: Briefcase,
  compensatory: ArrowLeftRight,
  home: MapPin,
  claim: Receipt,
  resignation: DoorOpen,
  details: UserPen,
  raise: TrendingUp,
  team: TrendingUp,
};

/** A section's head on the page (not in a card): the small capitals over its title, and a line under it. */
export function SectionHead({ id, eyebrow, title, intro }: { id: string; eyebrow?: string; title: React.ReactNode; intro?: React.ReactNode }) {
  return (
    <div>
      <PanelHead eyebrow={eyebrow} title={<span id={id}>{title}</span>} />
      {intro && <p className="mt-2 max-w-3xl text-sm text-muted">{intro}</p>}
    </div>
  );
}

/** The design's tall figure: its icon, what it counts, the figure large and a note at the foot. `spoken`: the figure as read aloud ("2" for "02"). */
export function FigureTile({ icon, label, value, spoken, note }: { icon: LucideIcon; label: string; value: string; spoken?: string; note: React.ReactNode }) {
  return (
    <div className="card flex min-h-[168px] flex-col p-[18px] sm:p-[22px] lg:min-h-[200px]">
      <IconTile icon={icon} />
      <p className="mt-5 text-xs text-muted sm:mt-7">{label}</p>
      <p className="mt-1 text-[2.1rem] leading-tight tracking-[-0.055em] tabular-nums">
        {spoken ? (
          <>
            <span aria-hidden="true">{value}</span>
            <span className="sr-only">{spoken}</span>
          </>
        ) : (
          value
        )}
      </p>
      <p className="mt-auto pt-4 text-[11px] text-muted">{note}</p>
    </div>
  );
}

/**
 * The annual leave of the year (owner, 18 October 2026; the design's card): the days available large, the share of the
 * year's days still there as a ring and a bar, and each figure of the balance under it in the order they add up (the
 * entitlement, from when it may be used in a first year, carried in, adjusted by HR, taken, booked, waiting). "Available"
 * in its corner; "Usable from …" instead in a first year before then.
 */
export function AnnualLeaveCard({ balances, today, className = '' }: { balances: LeaveBalances; today: string; className?: string }) {
  const a = balances.annual;
  const share = annualShareLeft(a);
  const figures = annualFigures(a, balances.year).filter((f) => f.key !== 'available');
  const notYet = a.usableFrom > today;
  return (
    <section aria-labelledby="annual-leave-heading" className={`card flex flex-col p-[22px] ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <h2 id="annual-leave-heading" className="pt-1 text-xs font-normal text-muted">
          Annual leave · {balances.year}
        </h2>
        {notYet ? <Pill>Usable from {formatDate(a.usableFrom)}</Pill> : <Pill strong>Available</Pill>}
      </div>
      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="flex items-center gap-3">
          <span className="text-[3.25rem] leading-none font-normal tracking-[-0.08em] tabular-nums">{daysNumber(a.available)}</span>
          <span className="text-[13px] leading-tight text-muted">
            {a.available === 1 ? 'day' : 'days'}
            <br />
            available
          </span>
        </p>
        <Ring share={share} size={80} stroke={7} label={`${percentText(share)} of your ${balances.year} annual leave is still available`}>
          <span className="text-[15px] leading-none tabular-nums">{percentText(share)}</span>
          <span className="mt-0.5 text-[9px] text-muted">remaining</span>
        </Ring>
      </div>
      <div aria-hidden="true" className="mt-5 h-[7px] overflow-hidden rounded-full bg-line-soft">
        <div className="h-full rounded-full bg-ink" style={{ width: `${share * 100}%` }} />
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-6">
        {figures.map((f) => (
          <div key={f.key} className="min-w-0">
            <dt className="text-[11px] text-muted">{f.label}</dt>
            <dd className="mt-1 text-[15px] tabular-nums">{f.value}</dd>
            {f.note && <dd className="text-[11px] text-muted">{f.note}</dd>}
          </div>
        ))}
      </dl>
      <p className="mt-auto pt-4 text-[11px] text-muted">Annual leave, {balances.year}: what you can still ask for, once what is waiting is decided.</p>
    </section>
  );
}

/** The other types' cards (Other leave): each type's name in English and Arabic, and what is left of it, large. */
export function OtherLeaveCards({ balances, types }: { balances: LeaveBalances; types?: LeaveTypeView[] | null }) {
  const others = otherLeaveTypes(balances, types);
  if (!others.length) return null;
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {others.map((t) => {
        const f = otherLeaveFigure(
          t,
          types?.find((x) => x.id === t.typeId),
        );
        return (
          <li key={t.typeId} className="flex items-start justify-between gap-4 rounded-[14px] border border-line bg-card p-[15px]">
            <div className="min-w-0">
              <p className="text-sm">{t.nameEn}</p>
              <p lang="ar" dir="rtl" className="mt-1.5 inline-block text-xs text-muted">
                {t.nameAr}
              </p>
            </div>
            <p className="shrink-0 text-right">
              <span className="block text-xl leading-tight tabular-nums">{f.value}</span>
              <span className="mt-1 block text-[11px] text-muted">{f.note}</span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/** A card to start a request: its icon, what it is, a line on it, and the way on (the whole card opens it). */
export function StartCard({ icon, title, text, href, action }: { icon: LucideIcon; title: string; text: string; href: string; action: string }) {
  return (
    <li className="card relative flex flex-col rounded-[15px] p-[17px] sm:min-h-[190px] shadow-none transition-colors hover:bg-raised has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-accent">
      <IconTile icon={icon} />
      <h3 className="mt-4 text-[15px] font-normal">{title}</h3>
      <p className="mt-1.5 text-xs text-muted">{text}</p>
      <Link
        href={href}
        className="mt-auto inline-flex items-center gap-1.5 self-start pt-4 text-[13px] text-ink no-underline after:absolute after:inset-0 after:rounded-[15px] focus-visible:outline-none"
      >
        {action}
        <ArrowRight aria-hidden="true" className="size-3.5" strokeWidth={1.6} />
      </Link>
    </li>
  );
}

/** Where a request stands, as a badge: approved strong (black, off-white on dark); waiting quiet with a dot; closed quiet. */
function StatePill({ state, children }: { state: HistoryState; children: React.ReactNode }) {
  if (state === 'approved') return <Pill strong>{children}</Pill>;
  return (
    <Pill>
      {state === 'waiting' && <span aria-hidden="true" className="size-1.5 rounded-full bg-warn" />}
      {children}
    </Pill>
  );
}

type Query = Record<string, string | string[] | undefined>;

/** All / Approved / Waiting: links, so the address keeps the choice. */
function HistoryFilterLinks({ query, show }: { query: Query; show: HistoryFilter }) {
  return (
    <nav aria-label="Show requests" className="inline-flex rounded-full border border-line bg-raised p-[3px]">
      {(['', 'approved', 'waiting'] as const).map((v) => {
        const active = show === v;
        return (
          <Link
            key={v || 'all'}
            href={historyHref(query, v)}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex min-h-8 items-center rounded-full px-3.5 text-xs no-underline transition-colors ${
              active ? 'bg-accent text-on-accent hover:text-on-accent' : 'text-muted hover:text-ink'
            }`}
          >
            {HISTORY_FILTER_LABELS[v]}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Recent requests (the design's HISTORY): every request in one table, newest asked first, the latest HISTORY_LIMIT until
 * "Show all"; each row: its icon, what it is with a line under it, the day or days, how long, where it stands, opening
 * its page. `failed`: the kinds that couldn't be read, said over the table.
 */
export function HistoryPanel({ rows, show, all, query, failed }: { rows: readonly HistoryRow[]; show: HistoryFilter; all: boolean; query: Query; failed: string[] }) {
  const matching = filterHistory(rows, show);
  const shown = all ? matching : matching.slice(0, HISTORY_LIMIT);
  return (
    <section id={HISTORY_ID} aria-labelledby={`${HISTORY_ID}-heading`} className="card scroll-mt-6 p-[22px]">
      <PanelHead eyebrow="History" title={<span id={`${HISTORY_ID}-heading`}>Recent requests</span>} aside={<HistoryFilterLinks query={query} show={show} />} />
      {failed.length > 0 && <p className="mt-4 text-sm text-muted">Some of your requests couldn&apos;t be loaded ({failed.join(', ')}). Please try again in a moment.</p>}
      {shown.length === 0 ? (
        <div className="mt-5 rounded-[13px] border border-line px-6 py-10 text-center text-sm text-muted">
          {rows.length === 0 ? emptyHistoryText('') : emptyHistoryText(show)}
          {show && rows.length > 0 && (
            <>
              {' '}
              <Link href={historyHref(query, '')}>Show all</Link>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="mt-5 overflow-x-auto rounded-[13px] border border-line">
            <table className="table [&_tbody_tr:last-child_td]:border-b-0">
              <thead>
                <tr>
                  {/* the design's proportions, so a filter doesn't move the columns */}
                  <th scope="col" className="w-[36%]">
                    Type
                  </th>
                  <th scope="col" className="w-[24%]">
                    Date
                  </th>
                  <th scope="col" className="w-[14%]">
                    Duration
                  </th>
                  <th scope="col" className="w-[17%]">
                    Status
                  </th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const Icon = KIND_ICONS[r.kind];
                  return (
                    <tr key={r.key} className="transition-colors hover:bg-raised">
                      <td className="min-w-64">
                        <div className="flex items-center gap-2.5">
                          <span aria-hidden="true" className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] border border-line bg-raised text-ink">
                            <Icon className="size-4" strokeWidth={1.6} />
                          </span>
                          <div className="min-w-0">
                            <Link href={r.href} className="text-sm text-ink no-underline hover:underline">
                              {r.title}
                              {r.date !== '—' && <span className="sr-only">, {r.date}</span>}
                            </Link>
                            <p className="mt-0.5 line-clamp-1 text-[11px] text-muted" title={r.sub}>
                              {r.sub}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="min-w-40 text-[13px] tabular-nums">{r.date}</td>
                      <td className="min-w-24 text-[13px] tabular-nums">{r.duration}</td>
                      <td>
                        <StatePill state={r.state}>{r.status}</StatePill>
                      </td>
                      <td className="w-12 text-right">
                        {/* the row's way on for a pointer; the title is the link for a keyboard and a screen reader */}
                        <Link href={r.href} tabIndex={-1} aria-hidden="true" className="inline-flex text-ink no-underline hover:opacity-70">
                          <ArrowRight className="size-4" strokeWidth={1.6} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-muted">
            {shown.length < matching.length ? `The latest ${shown.length} of ${matching.length}` : requestsLabel(matching.length)}, newest first. Each kind lists all of
            its own, with every detail, further down.
            {shown.length < matching.length && (
              <>
                {' '}
                <Link href={historyHref(query, show, true)}>Show all {matching.length}</Link>
              </>
            )}
          </p>
        </>
      )}
    </section>
  );
}
