import Link from 'next/link';
import { LABELS, type EmploymentType } from '@trendlix/shared';
import { formatDate, titleCase } from '@/lib/format';
import type { EmploymentSalaryHistory, PayEventDocument, SalaryEvent } from '@/lib/raise-types';
import type { EmployeeProfile, GeneratedDocumentStatus } from '@/lib/types';
import { runHref } from '../../../payroll/list';
import { payslipHref } from '../../../payroll/payslips';
import { Loading, periodLabel, ProfileSection, todayInCairo } from '../../ui';
import { allowancesLabel, formatEgp } from '../contracts/salary';
import { DOCUMENT_STATUS_LABELS, documentFileHref } from '../documents/wording';
import { loadSalaryHistory } from './data';
import {
  eventsLabel,
  eventView,
  firstSignedDate,
  monthsLabel,
  paidRows,
  paidTotals,
  STAGE_BADGE,
  stepChart,
  summaryFigures,
  type EventView,
} from './salary-history';
import { GrossStepChart } from './step-chart';

// The Salary History, on the Employment tab after the Contract section (owner, 16 October 2026: "think about tracking
// the salary raises through the employment period too"). For the current employment: the summary (starting and current
// gross, the change since joining, the raises and the last one, a signed raise still to come), a step chart of the
// gross, every pay event in order (the hire, each amendment, each new contract, each renewal, with the same pay or the
// change), each with its dates, pay from → to, reason, promotion, the CEO's approval, status, insured-wage date and
// documents; then the pay actually received, month by month, with its payslips. Each past employment below it, the same
// way, folded away. HR, Finance and the CEO only, as salaries; the documents for HR and the CEO, who see the employee
// file's (the API leaves them out for Finance). The API checks all of it again.

const LINK = 'inline-flex min-h-9 items-center text-sm font-semibold text-accent hover:underline';
const dash = <span className="text-muted">—</span>;

type Employee = Pick<EmployeeProfile, 'id' | 'fullNameEn'>;

const Title = ({ note, children }: { note?: string; children: React.ReactNode }) => (
  <ProfileSection title="Salary History" note={note} restricted>
    {children}
  </ProfileSection>
);

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">{children}</p>;
}

export function SalaryHistoryLoading() {
  return (
    <Title>
      <Loading />
    </Title>
  );
}

/** A heading at the level its place in the page needs (h3 for the current employment, h4 inside a past one). */
function Heading({ level, className, children }: { level: 3 | 4 | 5; className?: string; children: React.ReactNode }) {
  const Tag = `h${level}` as const;
  return <Tag className={className}>{children}</Tag>;
}

function Item({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? 'sm:col-span-2 lg:col-span-3' : undefined}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

// ---------- the summary ----------

function Summary({ history: h }: { history: EmploymentSalaryHistory }) {
  if (!h.summary) return <Quiet>No signed contract yet in this employment: its salary history starts once one is signed.</Quiet>;
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {summaryFigures(h.summary, firstSignedDate(h.events)).map((f) => (
        <div key={f.key} className="card px-4 py-3">
          <dt className="text-xs text-muted">{f.label}</dt>
          <dd className="mt-1 text-lg font-semibold">{f.value}</dd>
          {f.note && <dd className="text-xs text-muted">{f.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

// ---------- the timeline ----------

function Documents({ employee, documents, what }: { employee: Employee; documents: PayEventDocument[]; what: string }) {
  if (documents.length === 0) return <span className="text-muted">None generated yet</span>;
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1">
      {documents.map((d) => (
        <li key={d.id} className="inline-flex items-baseline gap-1.5">
          {/* a plain link, never prefetched: the web server fetches the PDF from the API with the session */}
          <a href={documentFileHref(employee.id, d.id)} target="_blank" rel="noopener" className={LINK}>
            {d.name}
            <span className="sr-only"> of {what} (PDF), in a new tab</span>
          </a>
          <span className="text-xs text-muted">{DOCUMENT_STATUS_LABELS[d.status as GeneratedDocumentStatus] ?? d.status}</span>
        </li>
      ))}
    </ul>
  );
}

function EventItem({
  employee,
  event,
  view: v,
  level,
  last,
}: {
  employee: Employee;
  event: SalaryEvent;
  view: EventView;
  level: 3 | 4 | 5;
  last: boolean;
}) {
  const what = `${v.title}, ${v.reference}`;
  return (
    <li className="relative pb-6 pl-7 last:pb-0">
      {/* the line down the timeline to the next event, and this event's dot on it: filled once signed (paid) */}
      {!last && <span aria-hidden="true" className="absolute top-2 bottom-0 left-[7px] w-px bg-line" />}
      <span
        aria-hidden="true"
        className={`absolute top-1.5 left-0 size-[15px] rounded-full border-2 ${v.signed ? 'border-accent bg-accent' : 'border-line bg-card'}`}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Heading level={level} className="font-semibold">
          {v.title}
          <span className="font-normal text-muted tabular-nums"> · {v.reference}</span>
        </Heading>
        <span className={`badge ${STAGE_BADGE[v.stage] ?? ''}`}>{v.stageLabel}</span>
      </div>
      <dl className="mt-2 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Item label="Effective">
          <span className="tabular-nums">{v.effective}</span>
        </Item>
        <Item label="Gross a month">
          <span className="tabular-nums">{v.gross}</span>
          {v.change && <span className={`block text-xs ${v.change.startsWith('+') ? 'font-semibold text-ok' : 'text-muted'}`}>{v.change}</span>}
          {v.hourly && <span className="block text-xs text-muted">{v.hourly}</span>}
        </Item>
        <Item label="Allowances a month">
          <span className="tabular-nums">{v.allowances}</span>
          {event.allowances.length > 0 && <span className="block text-xs text-muted">{allowancesLabel(event.allowances)}</span>}
        </Item>
        <Item label="Total a month">
          <span className="tabular-nums">{v.total}</span>
        </Item>
        {v.reason && <Item label="Reason">{v.reason}</Item>}
        {v.promotion && <Item label="Promotion">{v.promotion}</Item>}
        {v.approved && <Item label="Approved by the CEO">{v.approved}</Item>}
        {v.signedOn && <Item label="Signed on">{v.signedOn}</Item>}
        {v.insuredWage && <Item label="Insured wage">{v.insuredWage}</Item>}
        {event.documents && (
          <Item label="Documents" wide>
            <Documents employee={employee} documents={event.documents} what={what} />
          </Item>
        )}
      </dl>
    </li>
  );
}

function Timeline({ employee, history: h, level }: { employee: Employee; history: EmploymentSalaryHistory; level: 3 | 4 }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <Heading level={level} className="font-semibold">
          Pay Events
        </Heading>
        <span className="text-xs text-muted">{eventsLabel(h.events.length)}, oldest first</span>
      </div>
      {h.events.length === 0 ? (
        <Quiet>No contract yet in this employment.</Quiet>
      ) : (
        <ol className="card px-5 py-5">
          {h.events.map((e, i) => (
            <EventItem
              key={e.contractId}
              employee={employee}
              event={e}
              view={eventView(e)}
              level={(level + 1) as 4 | 5}
              last={i === h.events.length - 1}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

// ---------- the pay received ----------

function PayReceived({ employee, history: h, level }: { employee: Employee; history: EmploymentSalaryHistory; level: 3 | 4 }) {
  const rows = paidRows(h.paid);
  const totals = paidTotals(h.paid);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <Heading level={level} className="font-semibold">
          Pay Received
        </Heading>
        <span className="text-xs text-muted">Each paid payroll month, oldest first</span>
      </div>
      {rows.length === 0 ? (
        <Quiet>No paid payroll month yet in this employment.</Quiet>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <caption className="sr-only">Pay {employee.fullNameEn} received in each paid payroll month</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Paid On</th>
                <th scope="col" className="text-right">
                  Net
                </th>
                <th scope="col" className="text-right">
                  Transfer
                </th>
                <th scope="col">Payslips</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.lineId}>
                  <th scope="row" className="text-left font-semibold whitespace-nowrap">
                    <Link href={runHref(r.runId)} prefetch={false}>
                      {r.title}
                    </Link>
                  </th>
                  <td className="whitespace-nowrap tabular-nums">{r.paidOn ? formatDate(r.paidOn) : dash}</td>
                  <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(r.net)}</td>
                  <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(r.transfer)}</td>
                  <td>
                    {r.onHold ? (
                      <span className="text-sm text-muted">On hold: not paid, no payslip</span>
                    ) : (
                      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                        {r.links.map((l) => (
                          // plain links, never prefetched: the API draws the payslip the first time it is asked for
                          <span key={l.language} className="inline-flex items-baseline gap-1.5">
                            <a href={payslipHref(r.lineId, l.language)} target="_blank" rel="noopener" className={LINK}>
                              {l.label}
                              <span className="sr-only">
                                {' '}
                                payslip of {employee.fullNameEn} for {r.title} (PDF), in a new tab
                              </span>
                            </a>
                            {l.note && <span className="text-xs text-muted">{l.note}</span>}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="px-4 py-3 text-left font-semibold">
                  Received in all
                </th>
                <td className="px-4 py-3 text-muted">{monthsLabel(totals.months)}</td>
                <td className="px-4 py-3 text-right font-semibold whitespace-nowrap tabular-nums">{formatEgp(totals.net)}</td>
                <td className="px-4 py-3 text-right font-semibold whitespace-nowrap tabular-nums">{formatEgp(totals.transfer)}</td>
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------- one employment ----------

function EmploymentPay({
  employee,
  history: h,
  today,
  level,
}: {
  employee: Employee;
  history: EmploymentSalaryHistory;
  today: string;
  level: 3 | 4;
}) {
  const chart = stepChart({ events: h.events, joinDate: h.joinDate, endDate: h.endDate, today });
  return (
    <div className="space-y-6">
      <Summary history={h} />
      {chart && <GrossStepChart chart={chart} />}
      <Timeline employee={employee} history={h} level={level} />
      <PayReceived employee={employee} history={h} level={level} />
    </div>
  );
}

/** "Full-time · Senior Designer", for a past employment's heading. */
function employmentName(h: EmploymentSalaryHistory): string {
  const type = LABELS.employmentType[h.employmentType as EmploymentType] ?? h.employmentType;
  return titleCase([type, h.jobTitle].filter(Boolean).join(' · '));
}

export async function SalaryHistorySection({ employee }: { employee: Employee }) {
  const load = await loadSalaryHistory(employee.id);
  if (load.kind === 'forbidden') return null; // not the caller's to see
  if (load.kind === 'unavailable') {
    return (
      <Title>
        <Quiet>Not available yet: the server does not have the salary history yet.</Quiet>
      </Title>
    );
  }
  if (load.kind === 'failed') {
    return (
      <Title>
        <Quiet>The salary history could not be loaded. Please try again in a moment.</Quiet>
      </Title>
    );
  }

  const today = todayInCairo();
  const current = load.history.employments.find((e) => e.current) ?? null;
  const past = load.history.employments.filter((e) => !e.current);
  if (!current && past.length === 0) {
    return (
      <Title>
        <Quiet>No employments yet: the salary history starts with the first contract.</Quiet>
      </Title>
    );
  }

  return (
    <Title note={current ? `Since ${formatDate(current.joinDate)}` : undefined}>
      {current ? (
        <EmploymentPay employee={employee} history={current} today={today} level={3} />
      ) : (
        <Quiet>No current employment. The past employments&apos; pay is below.</Quiet>
      )}
      {past.length > 0 && (
        <section className="space-y-3 pt-2">
          <h3 className="font-semibold">Past Employments</h3>
          {past.map((h) => (
            <details key={h.employmentId} className="card group">
              <summary className="flex min-h-11 cursor-pointer flex-wrap items-baseline gap-x-3 px-5 py-3">
                <span className="font-semibold">{employmentName(h)}</span>
                <span className="text-sm text-muted tabular-nums">{periodLabel(h)}</span>
                {h.summary && (
                  <span className="text-sm text-muted tabular-nums">
                    {formatEgp(h.summary.startingGross)} → {formatEgp(h.summary.currentGross)}
                  </span>
                )}
              </summary>
              <div className="border-t border-line px-5 py-5">
                <EmploymentPay employee={employee} history={h} today={today} level={4} />
              </div>
            </details>
          ))}
        </section>
      )}
    </Title>
  );
}
