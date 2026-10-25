'use client';

import { COVER_REQUIRED_OVER_DAYS, HANDOVER_NOTE_MAX, staffingLimitText, type CoverageDay, type CoverageViewer, type LeaveCoverageView, type LeaveFormCoverage } from '@trendlix/shared';
import { Select } from '@/components/select';
import { titleCase } from '@/lib/format';
import { atWorkText, busyDays, clashText, coverGroups, coveringText, coversText, elsewhereLines, offLines, overLimitText, placeText, shortDay } from './coverage';

// Leave coverage on the leave pages (owner, 25 October 2026: "if there are leaves applied by an employee and another
// employee in the same department is on a leave, how can we manage it without affecting the workflow?"; asked, "Names,
// no leave types", "Warn and need HR", "Required over 2 days", "To a stand-in"): who else of the team is off on a
// request's days and "N of M at work" (coverage.ts words it, by who is looking); on the new request form, the staffing
// limit's warning (it can still be sent), the colleagues the employee covers on those days (a warning, never a block),
// the colleague who covers (required for annual and unpaid leave of more than 2 working days) with a handover note, and
// the stand-in of someone who approves for others; on a request's page, the same picture for its approvers with the
// clash. The API works it all out and checks it again.

/** The days someone else is off or works elsewhere, each with "N of M at work", the limit's day marked. */
function DayRows({ days }: { days: readonly CoverageDay[] }) {
  const busy = busyDays(days);
  if (!busy.length) return null;
  return (
    <ul className="divide-y divide-line-soft text-sm" aria-label="At work each day">
      {busy.map((d) => (
        <li key={d.date} className={`flex flex-wrap items-baseline justify-between gap-x-3 py-1.5 ${d.over ? 'text-warn' : ''}`}>
          <span className="tabular-nums">{shortDay(d.date)}</span>
          <span className="tabular-nums">
            {atWorkText(d)}
            {d.over && d.fewestAtWork !== null && <span className="font-semibold"> · the limit is {d.fewestAtWork}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Who else of the team is off on the days, in words for `viewer` (the employee: names only; an approver: "on leave"; HR
 * and the CEO: with the types), who works elsewhere, the busy days' "N of M at work", and the team's limit.
 */
export function WhoElseIsOff({ coverage, viewer, reading = false }: { coverage: Pick<LeaveCoverageView, 'group' | 'limit' | 'days'>; viewer: CoverageViewer; reading?: boolean }) {
  const lines = offLines(coverage.days, viewer);
  const elsewhere = elsewhereLines(coverage.days);
  const group = coverage.group;
  return (
    <div className="space-y-2" aria-busy={reading || undefined}>
      {!group ? (
        <p className="text-sm text-muted">Not in a department or team, so there is nobody else’s leave to show.</p>
      ) : lines.length ? (
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nobody else in {group.nameEn} is off on these days.</p>
      )}
      {elsewhere.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted">
          {elsewhere.map((l) => (
            <li key={l}>{l}, at work</li>
          ))}
        </ul>
      )}
      <DayRows days={coverage.days} />
      {group && coverage.limit && (
        <p className="text-xs text-muted">
          {titleCase(group.nameEn)}’s staffing limit for annual leave: {staffingLimitText(coverage.limit)}.
        </p>
      )}
    </div>
  );
}

/**
 * The request's page: who else of the team is off on its days, as its viewer reads it, the clash with the team's limit
 * highlighted (HR approves it too), and, for HR and the approvers, the colleagues its employee covers on those days.
 */
export function RequestCoverage({ coverage, employeeName }: { coverage: LeaveCoverageView; employeeName: string }) {
  const clash = clashText(coverage.group, coverage.days);
  return (
    <div className="space-y-3">
      {clash && (
        <p role="note" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          {clash} HR approves it too.
        </p>
      )}
      {/* the colleagues its employee covers on those days: a warning, never a block (HR sees the clash) */}
      {coverage.covering.map((c) => (
        <p key={c.requestId} role="note" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          {coverage.viewer === 'requester' ? coveringText(c) : coversText(employeeName, c)}.
        </p>
      ))}
      <WhoElseIsOff coverage={coverage} viewer={coverage.viewer} />
    </div>
  );
}

/** What the new request's form keeps of its coverage fields. */
export interface CoverageChoice {
  coverId: string;
  handoverNote: string;
  standIn: string;
}

/**
 * The new request's coverage part: who else is off, the limit's warning (still sendable), the colleagues the employee
 * covers on those days, the colleague who covers and the handover note, and the stand-in when they approve for others.
 * `coverage`: the API's answer for the days typed; null before the days are chosen (or from an API from before it).
 */
export function CoverageFields({
  fid,
  coverage,
  reading,
  problem,
  choice,
  onChange,
  toCeo,
}: {
  fid: (name: string) => string;
  coverage: LeaveFormCoverage | null;
  reading: boolean;
  problem: string | null;
  choice: CoverageChoice;
  onChange: (next: Partial<CoverageChoice>) => void;
  toCeo: boolean;
}) {
  if (!coverage) {
    return (
      <>
        {reading && <p className="text-sm text-muted">Checking who else is off…</p>}
        {problem && <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">{problem}</p>}
        {/* kept as typed while the days are being chosen */}
        <input type="hidden" name="coverId" value={choice.coverId} />
        <input type="hidden" name="handoverNote" value={choice.handoverNote} />
        <input type="hidden" name="standIn" value={choice.standIn} />
      </>
    );
  }
  const over = overLimitText(coverage.group, coverage.days, toCeo);
  const { team, others } = coverGroups(coverage.cover.candidates);
  const required = coverage.cover.required;
  const standIn = coverage.standIn;
  const defaultPerson = standIn.default?.employee ?? null;
  const defaultLabel = standIn.default ? (standIn.default.hr || !defaultPerson ? 'HR' : defaultPerson.fullNameEn) : null;
  const option = (c: { id: string; fullNameEn: string; department: string | null; team: string | null }) => (
    <option key={c.id} value={c.id}>
      {c.fullNameEn}
      {placeText(c) ? ` · ${placeText(c)}` : ''}
    </option>
  );
  return (
    <>
      <section aria-label="Who else is off" className="space-y-2 rounded-lg border border-line bg-canvas p-4">
        <h3 className="text-sm font-semibold">{coverage.group ? `Who Else in ${titleCase(coverage.group.nameEn)} Is Off` : 'Who Else Is Off'}</h3>
        <WhoElseIsOff coverage={coverage} viewer="requester" reading={reading} />
      </section>
      {over && (
        <p role="note" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          {over}
        </p>
      )}
      {coverage.covering.map((c) => (
        <p key={c.requestId} role="note" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          {coveringText(c)}: you can still send it; HR sees it.
        </p>
      ))}
      {problem && <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">{problem}</p>}

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Who Covers Your Work</legend>
        <div>
          <label htmlFor={fid('coverId')} className="label">
            Colleague who covers {!required && <span className="font-normal text-muted">(optional)</span>}
          </label>
          <Select
            id={fid('coverId')}
            name="coverId"
            required={required}
            value={choice.coverId}
            onChange={(e) => onChange({ coverId: e.target.value })}
            aria-describedby={fid('coverId-hint')}
            className="input"
          >
            <option value="">{required ? 'Choose a colleague' : 'Nobody'}</option>
            {team.length > 0 && <optgroup label={coverage.group ? `${coverage.group.nameEn}` : 'Your team'}>{team.map(option)}</optgroup>}
            {others.length > 0 && <optgroup label={team.length ? 'Everyone else' : 'Colleagues'}>{others.map(option)}</optgroup>}
          </Select>
          <p id={fid('coverId-hint')} className="hint">
            {required
              ? `Leave of this type for more than ${COVER_REQUIRED_OVER_DAYS} working days needs a colleague who covers your work, someone not off on these days. They are told, and see your handover note.`
              : 'A colleague not off on these days. They are told, and see your handover note.'}
          </p>
        </div>
        <div>
          <label htmlFor={fid('handoverNote')} className="label">
            Handover note <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id={fid('handoverNote')}
            name="handoverNote"
            rows={2}
            maxLength={HANDOVER_NOTE_MAX}
            value={choice.handoverNote}
            onChange={(e) => onChange({ handoverNote: e.target.value })}
            aria-describedby={fid('handoverNote-hint')}
            className="input"
          />
          <p id={fid('handoverNote-hint')} className="hint">
            What the colleague who covers should know: open tasks, files, who to call. Up to {HANDOVER_NOTE_MAX} characters.
          </p>
        </div>
      </fieldset>

      {standIn.needed ? (
        <div>
          <label htmlFor={fid('standIn')} className="label">
            Stand-in while you are away
          </label>
          <Select
            id={fid('standIn')}
            name="standIn"
            value={choice.standIn}
            onChange={(e) => onChange({ standIn: e.target.value })}
            aria-describedby={fid('standIn-hint')}
            className="input"
          >
            <option value="">{defaultLabel ? `${defaultLabel} (the default)` : 'Nobody'}</option>
            {standIn.hr && !standIn.default?.hr && <option value="hr">HR</option>}
            {standIn.options.filter((o) => o.id !== defaultPerson?.id).map(option)}
          </Select>
          <p id={fid('standIn-hint')} className="hint">
            {standIn.cLevel
              ? 'While you are on leave, the CEO or a Super Admin decides the requests that wait for you, then they come back to you.'
              : 'While you are on leave, they decide the requests that wait for you (your team’s leave, permission, working from home and more), then what still waits comes back to you.'}
          </p>
        </div>
      ) : (
        <input type="hidden" name="standIn" value="" />
      )}
    </>
  );
}
