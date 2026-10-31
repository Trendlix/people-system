import { DAY_SOURCE_CHOICE_LABELS, cairoClock, removedText } from '@trendlix/shared';
import { PageHead, Panel, PanelHead, Pill } from '@/components/design';
import { countsWords, hoursWords, recordWhere, recordWords, SOURCE_HEADS, type DayRecord, type DayRecordsView } from '@/lib/attendance-records';
import { formatDate } from '@/lib/format';
import { weekdayOf } from '../../organization/holidays/holidays';
import { BackLink } from '../../organization/ui';
import { ChooseSourceForm, ClearSourceForm, RemoveRecordForm, RestoreRecordForm } from './records-forms';

// A day's attendance records (owner, 31 October 2026: "is there a way to check the checkin records? even if imported
// from zoho and delete one of them?" — "as a super admin"; "zoho or system"): the system's check-ins and Zoho's side by
// side, which of them the day uses, and for a Super Admin (the month not locked) Remove on each, the records removed with
// who, when and why and Restore, and which records the day uses when it has both.

function RecordList({ view, source, records }: { view: DayRecordsView; source: 'system' | 'zoho'; records: DayRecord[] }) {
  if (!records.length) return <p className="mt-3 text-sm text-muted">No records.</p>;
  return (
    <ul className="mt-3 divide-y divide-line">
      {records.map((r) => {
        const where = source === 'system' ? recordWhere(r) : null;
        return (
          <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
            <div>
              <p className="font-medium tabular-nums">{recordWords(r)}</p>
              {where && <p className="text-xs text-muted">{where}</p>}
            </div>
            {view.canChange && <RemoveRecordForm employeeId={view.employee.id} date={view.date} source={source} recordId={r.id} what={recordWords(r).toLowerCase()} />}
          </li>
        );
      })}
    </ul>
  );
}

export function RecordsView({ view, back }: { view: DayRecordsView; back: { href: string; label: string } }) {
  const both = view.system.kept && view.zoho.kept;
  const sources = (['system', 'zoho'] as const).filter((s) => view[s].kept || view[s].records.length || view.removed.some((r) => r.source === s));
  // the source not counting now, offered when the day has both (owner: "zoho or system")
  const offer = (['zoho', 'system'] as const).filter((s) => s !== view.counts);
  return (
    <div className="space-y-6">
      <BackLink href={back.href}>{back.label}</BackLink>
      <PageHead
        eyebrow={`${view.employee.fullNameEn} · ${view.employee.employeeCode}`}
        title={`${weekdayOf(view.date)} ${formatDate(view.date)}`}
        intro="Every check-in and check-out kept for the day, the system’s and Zoho People’s, and which of them the day uses."
      />
      <p className="rounded-lg bg-raised px-4 py-3 text-sm">{countsWords(view)}</p>
      {view.locked && <p className="rounded-lg bg-raised px-4 py-3 text-sm text-muted">{view.locked}</p>}
      {sources.length === 0 ? (
        <p className="text-muted">No check-ins or check-outs kept for this day.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sources.map((s) => (
            <Panel key={s}>
              <PanelHead
                eyebrow={view[s].hoursCounted === null ? 'Records' : `${hoursWords(view[s].hoursCounted)} counted`}
                title={SOURCE_HEADS[s]}
                aside={view.counts === s ? <Pill strong>Counts</Pill> : view[s].kept ? <Pill>Not used</Pill> : null}
              />
              <RecordList view={view} source={s} records={view[s].records} />
            </Panel>
          ))}
        </div>
      )}
      {view.removed.length > 0 && (
        <Panel>
          <PanelHead eyebrow="Super Admin" title="Removed" />
          <ul className="mt-3 divide-y divide-line">
            {view.removed.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                <div>
                  <p className="font-medium tabular-nums text-muted line-through">
                    {r.kind === 'in' ? 'Check-in' : 'Check-out'} {cairoClock(r.at)} · {SOURCE_HEADS[r.source]}
                  </p>
                  <p className="text-xs text-muted">{removedText(r)}</p>
                </div>
                {view.canChange && <RestoreRecordForm removalId={r.id} />}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {view.canChange && both && (
        <Panel>
          <PanelHead eyebrow="Super Admin" title="Which records the day uses" />
          <p className="mt-2 text-sm text-muted">
            Usually the system&apos;s check-ins come before Zoho&apos;s. Choose for this day only; an approved correction still applies over it.
            {view.chosen && ` Chosen now: ${DAY_SOURCE_CHOICE_LABELS[view.chosen.source]}.`}
          </p>
          <div className="mt-4 space-y-4">
            <ChooseSourceForm employeeId={view.employee.id} date={view.date} offer={offer.length ? [...offer] : ['zoho', 'system']} />
            {view.chosen && <ClearSourceForm employeeId={view.employee.id} date={view.date} />}
          </div>
        </Panel>
      )}
    </div>
  );
}
