import { ASSET_CONDITION_LABELS, CUSTODY_KIND_LABELS, type AssetHistoryView } from '@trendlix/shared';
import Link from 'next/link';
import { APP_CUSTODY_PATHS, CUSTODY_PATHS } from '@/lib/asset-paths';
import { formatDate, formatDateTime } from '@/lib/format';
import { hiddenRecordsText, maintenanceTitle, returnLabel, returnTone, valueText, whoText } from './custody';

// An asset's custody history and maintenance log on its page (Assets step 3; the spec's asset detail: "custody history,
// maintenance log"), on the site and in the phone layout: each handover of it, newest first (whose, the kind, when it
// went out and came back, in what state), C-level people's records left out for those who don't see them (said as a
// count); and each repair, service or inspection (the cost only when the API sent it: the CEO, Finance and a Super Admin).

export function CustodyHistoryList({ history, surface }: { history: AssetHistoryView; surface: 'site' | 'app' }) {
  const recordHref = surface === 'site' ? CUSTODY_PATHS.record : APP_CUSTODY_PATHS.record;
  const hidden = hiddenRecordsText(history.hiddenRecords);
  return (
    <div className="space-y-2">
      {history.custody.length ? (
        <ul className="divide-y divide-line-soft">
          {history.custody.map((c) => (
            <li key={c.itemId} className="space-y-1 py-3 first:pt-0 last:pb-0">
              <p className="flex flex-wrap items-center gap-2">
                <Link href={recordHref(c.code)} className="font-mono font-semibold">
                  {c.code}
                </Link>
                <span>{c.employee.fullNameEn}</span>
                <span className={`badge ${returnTone(c.returnCondition)}`}>{returnLabel(c.returnCondition)}</span>
              </p>
              <p className="text-xs text-muted">
                {CUSTODY_KIND_LABELS[c.kind]} · out {formatDateTime(c.outAt)}
                {c.dueDate ? ` · due ${formatDate(c.dueDate)}` : ''}
                {c.conditionOut ? ` · went out ${ASSET_CONDITION_LABELS[c.conditionOut].toLowerCase()}` : ''}
                {c.returnedAt ? ` · back ${formatDateTime(c.returnedAt)}${c.receivedBy ? ` (${whoText(c.receivedBy)})` : ''}` : ''}
                {'valueAtOut' in c ? ` · value then ${valueText(c.valueAtOut)}` : ''}
              </p>
              {c.returnNotes && <p className="text-sm">{c.returnNotes}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Never handed over yet.</p>
      )}
      {hidden && <p className="text-xs text-muted">{hidden}</p>}
    </div>
  );
}

export function MaintenanceList({ history, surface }: { history: AssetHistoryView; surface: 'site' | 'app' }) {
  const recordHref = surface === 'site' ? CUSTODY_PATHS.record : APP_CUSTODY_PATHS.record;
  if (!history.maintenance.length) return <p className="text-sm text-muted">No repairs, services or inspections yet.</p>;
  return (
    <ul className="divide-y divide-line-soft">
      {history.maintenance.map((m) => (
        <li key={m.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">{maintenanceTitle(m)}</span>
            <span className="text-sm text-muted">{formatDate(m.on)}</span>
            {m.custodyCode && (
              <Link href={recordHref(m.custodyCode)} className="font-mono text-xs">
                {m.custodyCode}
              </Link>
            )}
          </p>
          {m.notes && <p className="text-sm whitespace-pre-line">{m.notes}</p>}
          <p className="text-xs text-muted">
            {[m.vendor ? `Vendor: ${m.vendor}` : null, 'cost' in m ? `Cost: ${valueText(m.cost)}` : null, `Recorded ${formatDateTime(m.createdAt)}${m.createdBy ? ` by ${whoText(m.createdBy)}` : ''}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </li>
      ))}
    </ul>
  );
}
