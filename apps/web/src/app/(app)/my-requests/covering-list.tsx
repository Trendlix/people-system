import type { CoverAssignment } from '@trendlix/shared';
import { coverDaysText, coverStateText, coverWhenText } from './covering';

// "I'm Covering" (owner, 25 October 2026: "Required over 2 days", "Names, no leave types"): each colleague's leave the
// person covers, as My Requests and the dashboard list it: whom, the days and when they start, approved or still waiting,
// and the colleague's handover note. Never the kind of leave, which isn't the cover's to know.

export function CoveringList({ list, today, compact = false }: { list: readonly CoverAssignment[]; today: string; compact?: boolean }) {
  return (
    <ul className={`divide-y divide-line-soft ${compact ? '' : 'card'}`} aria-label="Colleagues’ leave you cover">
      {list.map((a) => (
        <li key={a.requestId} className={`space-y-1.5 text-sm ${compact ? 'py-2.5 first:pt-0' : 'px-5 py-4'}`}>
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <p className="font-medium">{a.employee.fullNameEn}</p>
              <p className="text-xs text-muted tabular-nums">
                {coverDaysText(a)} · {coverWhenText(a, today)}
              </p>
            </div>
            <span className={`badge ${a.waiting ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}>{coverStateText(a)}</span>
          </div>
          {a.handoverNote ? (
            <div className="rounded-lg bg-canvas px-3 py-2">
              <p className="text-xs text-muted">Their handover note</p>
              <p className="mt-0.5 whitespace-pre-line break-words">{a.handoverNote}</p>
            </div>
          ) : (
            !compact && <p className="text-xs text-muted">No handover note: ask them what to pick up.</p>
          )}
        </li>
      ))}
    </ul>
  );
}
