import { WHATSAPP_LOG_STAFF_ONLY, WHATSAPP_MESSAGES_PATH, type WhatsAppMessagePage, type WhatsAppMessageRow } from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { Select } from '@/components/select';
import { formatDate, formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { BADGE_CLASSES, languageText, messageBadge, RECIPIENT_KIND_LABELS, recipientText, seesWhatsAppLog } from '@/lib/whatsapp';
import { Empty, Loading } from '../organization/ui';
import { loadJson } from '../payroll/load';
import { StaffOnly } from '../staff-only';
import { apiMessagesPath, daysTotals, isFiltered, MESSAGE_STATUSES, MESSAGE_TYPES, messagesHref, pagesOf, rangeText, readMessageFilters, type MessageFilters } from './messages';

// WhatsApp Messages (owner, 24 October 2026: "how to make whatsapp notifications?"; the brief: "a WhatsApp Messages log
// (Super Admin and HR) with filters (status, type, date), without message bodies beyond template name and reference;
// failures with plain reasons; per-day counts (cost awareness)"). Every WhatsApp message the system made, newest first,
// 50 a page: when, to whom and at which number, which template, the record it is about, its language, where it stands
// at Meta (waiting, sent, delivered, read, failed or not sent) and why it failed in plain words; above them, each day's
// counts, as Meta charges per template message delivered. Never what a message said. Filtered in the address
// (?status=&template=&from=&to=&page=). HR doesn't see what is about a C-level person (the API leaves it out); a
// developer sees none of it.

export const metadata: Metadata = { title: 'WhatsApp Messages · People System' };

type Query = Record<string, string | string[] | undefined>;

const quiet = 'px-4 py-10 text-center text-sm text-muted';
const small = 'btn btn-secondary min-h-9 px-3';

function Filters({ filters }: { filters: MessageFilters }) {
  return (
    <form key={messagesHref(filters)} action={WHATSAPP_MESSAGES_PATH} aria-label="Filter the WhatsApp messages" className="card space-y-4 p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="wa-status" className="label">
            Status
          </label>
          <Select id="wa-status" name="status" defaultValue={filters.status} className="input">
            <option value="">Any status</option>
            {MESSAGE_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="wa-type" className="label">
            Type
          </label>
          <Select id="wa-type" name="template" defaultValue={filters.template} className="input">
            <option value="">Any type</option>
            {MESSAGE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="wa-from" className="label">
            From
          </label>
          <DateInput id="wa-from" name="from" defaultValue={formatDate(filters.from)} />
        </div>
        <div>
          <label htmlFor="wa-to" className="label">
            To
          </label>
          <DateInput id="wa-to" name="to" defaultValue={formatDate(filters.to)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-primary">
          Show
        </button>
        {isFiltered(filters) && (
          <Link href={WHATSAPP_MESSAGES_PATH} className="btn btn-secondary">
            Clear filters
          </Link>
        )}
      </div>
    </form>
  );
}

/** Each day's counts, for what WhatsApp costs (Meta charges each template message delivered). */
function Days({ page }: { page: WhatsAppMessagePage }) {
  if (!page.days.length) return null;
  const totals = daysTotals(page.days);
  return (
    <section aria-labelledby="wa-days" className="card">
      <div className="border-b border-line px-4 py-3">
        <h2 id="wa-days" className="font-semibold">
          Messages a Day
        </h2>
        <p className="text-xs text-muted">
          Meta charges for each template message delivered; failed and waiting ones cost nothing. The STOP answers are free at Meta. Through Twilio, Twilio
          adds its own small fee per message, sent or received.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col" className="text-right">
                All
              </th>
              <th scope="col" className="text-right">
                Sent
              </th>
              <th scope="col" className="text-right">
                Delivered
              </th>
              <th scope="col" className="text-right">
                Read
              </th>
              <th scope="col" className="text-right">
                Failed
              </th>
              <th scope="col" className="text-right">
                Waiting
              </th>
            </tr>
          </thead>
          <tbody>
            {page.days.map((d) => (
              <tr key={d.day}>
                <th scope="row" className="font-medium tabular-nums">
                  {formatDate(d.day)}
                </th>
                <td className="text-right tabular-nums">{d.total}</td>
                <td className="text-right tabular-nums">{d.sent}</td>
                <td className="text-right tabular-nums">{d.delivered}</td>
                <td className="text-right tabular-nums">{d.read}</td>
                <td className={`text-right tabular-nums ${d.failed ? 'text-danger' : ''}`}>{d.failed}</td>
                <td className="text-right tabular-nums">{d.waiting}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <th scope="row">Total</th>
              <td className="text-right tabular-nums">{totals.total}</td>
              <td className="text-right tabular-nums">{totals.sent}</td>
              <td className="text-right tabular-nums">{totals.delivered}</td>
              <td className="text-right tabular-nums">{totals.read}</td>
              <td className="text-right tabular-nums">{totals.failed}</td>
              <td className="text-right tabular-nums">{totals.waiting}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function Row({ m }: { m: WhatsAppMessageRow }) {
  const badge = messageBadge(m.status);
  return (
    <tr className="align-top">
      <td className="whitespace-nowrap tabular-nums">
        <time dateTime={m.at}>{formatDateTime(m.at)}</time>
      </td>
      <td className="min-w-40">
        <span className="block font-medium break-words">{recipientText(m.recipient)}</span>
        <span className="block text-xs text-muted">{RECIPIENT_KIND_LABELS[m.recipient.kind]}</span>
      </td>
      <td className="whitespace-nowrap font-mono text-sm tabular-nums">{m.mobile}</td>
      <td className="min-w-40">
        <span className="block">{m.label}</span>
        <span className="block font-mono text-xs text-muted">{m.template}</span>
      </td>
      <td className="min-w-28 break-words">{m.reference ?? <span className="text-muted">—</span>}</td>
      <td className="whitespace-nowrap">{languageText(m.language)}</td>
      <td className="min-w-48">
        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE_CLASSES[badge.tone]}`}>{badge.text}</span>
        {m.problem && <span className="mt-1 block text-sm text-danger">{m.problem}</span>}
        {(m.readAt ?? m.deliveredAt ?? m.sentAt) && (
          <span className="mt-1 block text-xs text-muted">
            {m.readAt ? `Read ${formatDateTime(m.readAt)}` : m.deliveredAt ? `Delivered ${formatDateTime(m.deliveredAt)}` : `Sent ${formatDateTime(m.sentAt)}`}
          </span>
        )}
      </td>
      <td className="text-right tabular-nums">{m.attempts}</td>
    </tr>
  );
}

function Pager({ page, filters }: { page: WhatsAppMessagePage; filters: MessageFilters }) {
  const pages = pagesOf(page);
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
      <span className="text-muted">
        {rangeText(page)}, newest first{pages > 1 && ` · page ${page.page} of ${pages.toLocaleString('en-US')}`}
      </span>
      {pages > 1 && (
        <div className="flex gap-2">
          {page.page > 1 && (
            <Link href={messagesHref(filters, page.page - 1)} className={small}>
              ← Newer
            </Link>
          )}
          {page.page < pages && (
            <Link href={messagesHref(filters, page.page + 1)} className={small}>
              Older →
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}

async function Log({ searchParams }: { searchParams: Promise<Query> }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (user.developer) return <Empty>The WhatsApp messages carry people’s numbers: they aren’t open to developers.</Empty>;
  if (!seesWhatsAppLog(user)) return <Empty>{WHATSAPP_LOG_STAFF_ONLY}</Empty>;
  const { filters, problems } = readMessageFilters(query);
  const loaded = await loadJson<WhatsAppMessagePage>(apiMessagesPath(filters));
  if (loaded.kind !== 'ok') {
    return (
      <Empty>
        {loaded.kind === 'forbidden'
          ? WHATSAPP_LOG_STAFF_ONLY
          : loaded.kind === 'unavailable'
            ? 'Not available yet: the server does not send WhatsApp messages yet. Please try again after its next update.'
            : `The WhatsApp messages could not be loaded. ${loaded.messages.join(' ')}`}
      </Empty>
    );
  }
  const page = loaded.value;
  return (
    <div className="space-y-4">
      {problems.length > 0 && (
        <div role="alert" className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
          {problems.map((p) => (
            <p key={p}>{p} That filter is left out.</p>
          ))}
        </div>
      )}
      <Filters filters={filters} />
      <Days page={page} />
      <section aria-labelledby="wa-messages" className="card">
        <div className="border-b border-line px-4 py-3">
          <h2 id="wa-messages" className="font-semibold">
            Messages
          </h2>
          <p className="text-xs text-muted">{rangeText(page)}</p>
        </div>
        {page.items.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">To</th>
                    <th scope="col">Number</th>
                    <th scope="col">Type</th>
                    <th scope="col">Reference</th>
                    <th scope="col">Language</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="text-right">
                      Tries
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((m) => (
                    <Row key={m.id} m={m} />
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} filters={filters} />
          </>
        ) : (
          <p className={quiet}>{isFiltered(filters) ? 'No WhatsApp messages match these filters.' : 'No WhatsApp messages yet.'}</p>
        )}
      </section>
    </div>
  );
}

export default function WhatsAppMessagesPage({ searchParams }: PageProps<'/whatsapp-messages'>) {
  return (
    <StaffOnly>
      <div className="max-w-7xl space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">WhatsApp Messages</h1>
          <p className="mt-1 max-w-3xl text-muted">
            Every WhatsApp message the system made, newest first: to whom, which template, and whether it was delivered. What a message said is never kept
            here, only its template and the record it is about.
          </p>
        </div>
        <Suspense fallback={<Loading />}>
          <Log searchParams={searchParams} />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
