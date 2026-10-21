import { CUSTODY_KIND_LABELS, NOT_SIGNED_TEXT, type CustodyRowView, type CustodyStatus, type HeldItemView } from '@trendlix/shared';
import Link from 'next/link';
import { formatDate } from '@/lib/format';
import { custodyStatusText, custodyStatusTone, dueText, outText, valueText } from './custody';

// Small building blocks of the custody pages (Assets step 3, 21 October 2026): a record's status badge, its return date
// (red once overdue), "Signed copy not attached", the custody records' table and the table of what someone holds (the
// value at handover only when the API sent it: the CEO, Finance and a Super Admin). No hooks: the site's pages and the
// phone pages use them alike.

export function CustodyStatusBadge({ status }: { status: CustodyStatus }) {
  return <span className={`badge ${custodyStatusTone(status)}`}>{custodyStatusText(status)}</span>;
}

export function NotSignedBadge() {
  return <span className="badge bg-warn-soft text-warn">{NOT_SIGNED_TEXT}</span>;
}

/** Its return date in words, red once overdue. */
export function DueText({ r }: { r: Parameters<typeof dueText>[0] }) {
  const text = dueText(r);
  return r.overdue ? <span className="badge bg-danger-soft text-danger">{text}</span> : <span className={r.kind === 'shoot' ? '' : 'text-muted'}>{text}</span>;
}

/** Custody records as a table: the code (its page), whose, the kind, when it went out, the return date, what is out, signed. */
export function CustodyTable({ rows, href, person = true }: { rows: CustodyRowView[]; href: (code: string) => string; person?: boolean }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Record</th>
            {person && <th scope="col">Employee</th>}
            <th scope="col">Out On</th>
            <th scope="col">Return</th>
            <th scope="col">Items</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="min-w-40">
                <Link href={href(r.code)} className="font-mono font-semibold">
                  {r.code}
                </Link>
                <span className="block text-xs text-muted">
                  {CUSTODY_KIND_LABELS[r.kind]}
                  {r.purpose ? ` · ${r.purpose}` : ''}
                </span>
              </td>
              {person && (
                <td className="min-w-40">
                  {r.employee.fullNameEn}
                  <span className="block text-xs text-muted">{r.employee.employeeCode}</span>
                </td>
              )}
              <td className="whitespace-nowrap">{formatDate(r.outAt)}</td>
              <td className="min-w-36">
                <DueText r={r} />
              </td>
              <td className="whitespace-nowrap tabular-nums">{outText(r)}</td>
              <td className="min-w-40">
                <div className="flex flex-wrap gap-1.5">
                  <CustodyStatusBadge status={r.status} />
                  {!r.signed && <NotSignedBadge />}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What someone holds now: the asset (its page), the record (its page, when the caller can open it), since, the return date. */
export function HeldTable({ items, assetHref, recordHref }: { items: HeldItemView[]; assetHref: ((code: string) => string) | null; recordHref: ((code: string) => string) | null }) {
  const values = items.some((i) => 'valueAtOut' in i);
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Asset</th>
            <th scope="col">Record</th>
            <th scope="col">Since</th>
            <th scope="col">Return</th>
            {values && (
              <th scope="col" className="text-right">
                Value When Handed Over
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.itemId}>
              <td className="min-w-48">
                {assetHref ? (
                  <Link href={assetHref(i.asset.code)} className="font-semibold">
                    {i.asset.name}
                  </Link>
                ) : (
                  <span className="font-semibold">{i.asset.name}</span>
                )}
                <span className="block text-xs text-muted">
                  <span className="font-mono">{i.asset.code}</span>
                  {i.asset.serial ? ` · S/N ${i.asset.serial}` : ''}
                  {i.accessories ? ` · ${i.accessories}` : ''}
                </span>
              </td>
              <td className="font-mono text-sm whitespace-nowrap">{recordHref ? <Link href={recordHref(i.custody.code)}>{i.custody.code}</Link> : i.custody.code}</td>
              <td className="whitespace-nowrap">{formatDate(i.since)}</td>
              <td className="min-w-36">
                <DueText r={{ kind: i.custody.kind, dueDate: i.custody.dueDate, overdue: i.overdue, daysOverdue: i.daysOverdue }} />
              </td>
              {values && <td className="text-right whitespace-nowrap tabular-nums">{valueText(i.valueAtOut)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
