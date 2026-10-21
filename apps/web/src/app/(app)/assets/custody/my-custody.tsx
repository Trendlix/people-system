import { CUSTODY_KIND_LABELS, type MyCustodyView } from '@trendlix/shared';
import { CUSTODY_PATHS } from '@/lib/asset-paths';
import { formatDate } from '@/lib/format';
import { itemsText, outText, sizeText } from '../custody';
import { CustodyStatusBadge, DueText, NotSignedBadge } from '../custody-ui';

// My custody (owner, 21 October 2026: "Yes, My custody"): what the person holds of the company's assets, since when and
// until when (a shoot's return date, overdue in red), and their custody records with their signed forms to open. Read
// only, never a value. On their own profile (its Custody tab) and on the phone pages (/app/custody), alike.

export function MyCustody({ view }: { view: MyCustodyView }) {
  return (
    <div className="space-y-6">
      {view.overdue > 0 && (
        <p role="status" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          {view.overdue === 1 ? 'One item is' : `${view.overdue} items are`} past the return date. Please return {view.overdue === 1 ? 'it' : 'them'}, or speak to the
          person who handed {view.overdue === 1 ? 'it' : 'them'} over.
        </p>
      )}

      <section aria-labelledby="my-custody-now" className="space-y-2">
        <h2 id="my-custody-now" className="font-semibold">
          What You Hold
        </h2>
        {view.current.length ? (
          <ul className="card divide-y divide-line-soft">
            {view.current.map((i) => (
              <li key={i.itemId} className="space-y-1 px-4 py-3">
                <p className="font-medium break-words">
                  {i.asset.name} <span className="font-mono text-xs text-muted">{i.asset.code}</span>
                </p>
                <p className="text-xs text-muted">
                  {[i.asset.serial ? `S/N ${i.asset.serial}` : null, i.accessories, `${i.custody.code} · since ${formatDate(i.since)}`].filter(Boolean).join(' · ')}
                </p>
                <p className="text-sm">
                  <DueText r={{ kind: i.custody.kind, dueDate: i.custody.dueDate, overdue: i.overdue, daysOverdue: i.daysOverdue }} />
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">You hold nothing of the company&apos;s assets now.</p>
        )}
      </section>

      <section aria-labelledby="my-custody-records" className="space-y-2">
        <h2 id="my-custody-records" className="font-semibold">
          Your Custody Records
        </h2>
        {view.records.length ? (
          <ul className="card divide-y divide-line-soft">
            {view.records.map((r) => (
              <li key={r.id} className="space-y-1.5 px-4 py-3">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">{r.code}</span>
                  <CustodyStatusBadge status={r.status} />
                  {!r.signed && <NotSignedBadge />}
                </p>
                <p className="text-xs text-muted">
                  {CUSTODY_KIND_LABELS[r.kind]}
                  {r.purpose ? ` · ${r.purpose}` : ''} · out {formatDate(r.outAt)} · {itemsText(r.items)}, {outText(r).toLowerCase()}
                </p>
                <p className="text-sm">
                  <DueText r={r} />
                </p>
                {r.files.length > 0 && (
                  <ul className="text-sm">
                    {r.files.map((f) => (
                      <li key={f.id}>
                        <a href={CUSTODY_PATHS.myFile(r.code, f.id)} target="_blank" rel="noopener noreferrer" className="font-semibold">
                          Signed form: {f.fileName}
                        </a>
                        <span className="text-xs text-muted"> · {sizeText(f.sizeBytes)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No custody records yet.</p>
        )}
      </section>
    </div>
  );
}
