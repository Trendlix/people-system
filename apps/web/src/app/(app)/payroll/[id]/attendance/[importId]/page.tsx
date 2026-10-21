import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { formatHours } from '@trendlix/shared';
import { CLevelBadge } from '@/components/c-level-badge';
import type { AttendancePersonView } from '@/lib/attendance-types';
import { formatDate, formatDateTime } from '@/lib/format';
import { canDelete } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { ActionButton } from '../../../../employees/[id]/contracts/contract-buttons';
import { profileHref } from '../../../../employees/tab-list';
import { recordLeaveHref } from '../../../../leave/list';
import { weekdayOf } from '../../../../organization/holidays/holidays';
import { BackLink, Empty, Loading, UUID } from '../../../../organization/ui';
import { loadRun } from '../../../data';
import { canSeePayroll, monthName, preparesPayroll, runHref, runTitle } from '../../../list';
import { notLoadedText } from '../../../load';
import { applyAttendance, choosePerson, deleteAttendanceImport, undoAttendance } from '../actions';
import {
  applyConfirmText,
  attendanceUploadHref,
  CHECKS_IN_NOTE,
  checkTimesText,
  countChips,
  daysCount,
  dayStatusText,
  dayTone,
  deleteImportBlocked,
  deleteImportConfirmText,
  deleteImportLabel,
  fileMonthsNote,
  MATCH_TEXT,
  notAppliedReason,
  permissionText,
  placeText,
  reviewSections,
  undoConfirmText,
  undoesBeforeDelete,
} from '../attendance';
import { loadImport } from '../data';
import { ApplyButton, ChoiceButton, PickPerson, UndoButton } from './person-forms';

// An attendance import's review (owner, 19 October 2026: attendance runs in Zoho People today, "Import Zoho now, replace
// it later"; on a draft run, upload → review → Apply): the files read (their months: another month's days left out, the
// owner's "month mismatches warned"), how many people are matched, to confirm, not found, skipped and not on this
// payroll, then each section. To Confirm: a close name, "Did you mean …?", confirmed or chosen otherwise, or skipped. Not
// Found: chosen from the payroll's people, or skipped. Matched: each person's month by the system's rules (the days
// worked at the office and remote, the hours counted within their shift, the absent days, the permission hours and where
// they come from, the days Zoho marks as leave without leave in the system, each with Record leave, as "In the system,
// stop it in Zoho"), every day of it under Days, and why a line isn't filled when it isn't (matched twice, not on this
// payroll, not the user's to fill). Skipped: Undo. Apply fills the lines the user fills (the CEO the C-level people's,
// owner, 19 October 2026); for HR, the C-level people of the files are one row without their figures. What Apply filled
// can't be typed over on the run (owner, 19 October 2026: "imported data shouldn't be editable"): Undo this import puts
// the lines the user fills back to what they had before it, and its days go. Read only once the run isn't a draft. The
// API decides every choice and what Apply and Undo change. Someone who checks in on the system this month (owner, 19
// October 2026: "Check-in through the system (phone or web with the office location check, or a device) to replace
// Zoho") is said so: their Zoho days count before their first check-in, and their line is filled from their days. At
// the bottom, a Super Admin deletes the import on a draft (asked, 21 October 2026: "how to delete previous imports"; only
// a Super Admin deletes: owner, 15 October 2026), undoing it first when it is applied, after saying what happens.

export const metadata: Metadata = { title: 'Attendance Review · People System' };

const chip = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-white px-3.5 text-sm font-semibold';

function Section({ title, intro, children, count }: { title: string; intro: string; children: React.ReactNode; count: number }) {
  if (!count) return null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">
          {title} <span className="font-normal text-muted tabular-nums">({count})</span>
        </h2>
        <p className="text-sm text-muted">{intro}</p>
      </div>
      {children}
    </section>
  );
}

/** Zoho's name for someone, and their Zoho ID. */
function ZohoName({ p }: { p: AttendancePersonView }) {
  return (
    <>
      <span className="font-semibold">{p.zohoName || 'No name'}</span>
      {p.zohoId && <span className="block text-xs text-muted">Zoho ID {p.zohoId}</span>}
      <span className="block text-xs text-muted">{daysCount(p.rows)} of the month in the files</span>
    </>
  );
}

/** Every day of the person's month, by the system's rules. */
function Days({ p }: { p: AttendancePersonView }) {
  const days = p.month?.days ?? [];
  if (!days.length) return null;
  const tone = { danger: 'text-danger', warn: 'text-warn' } as const;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-sm font-semibold">
        Days<span className="sr-only"> of {p.employee?.fullNameEn ?? p.zohoName}</span>
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">What It Was</th>
              <th scope="col">Check-in – Check-out</th>
              <th scope="col" className="text-right">
                Hours Counted
              </th>
              <th scope="col">Where</th>
              <th scope="col">Zoho Says</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const t = dayTone(d.status);
              return (
                <tr key={d.date}>
                  <td className="whitespace-nowrap tabular-nums">
                    {weekdayOf(d.date)} {formatDate(d.date)}
                  </td>
                  <td className={t ? `font-medium ${tone[t]}` : undefined}>{dayStatusText(d.status)}</td>
                  <td className="whitespace-nowrap tabular-nums">{checkTimesText(d)}</td>
                  <td className="text-right tabular-nums">{d.hoursCounted > 0 ? formatHours(d.hoursCounted) : '—'}</td>
                  <td>{placeText(d.place)}</td>
                  <td className="text-sm text-muted">
                    {d.zohoStatus ?? '—'}
                    {d.permissionHours > 0 && <span className="block">Permission {formatHours(d.permissionHours)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

async function Review({ params }: { params: PageProps<'/payroll/[id]/attendance/[importId]'>['params'] }) {
  const { id, importId } = await params;
  if (!UUID.test(id) || !UUID.test(importId)) notFound();
  const user = await getCurrentUser();
  if (!canSeePayroll(user)) return <Empty>Only HR, Finance and the CEO can see payroll.</Empty>;
  const [run, loaded] = await Promise.all([loadRun(Promise.resolve({ id })), loadImport(id, importId)]);
  if (!run) return <Empty>Not available yet: the server does not have payroll yet.</Empty>;
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind !== 'ok') return <Empty>{loaded.kind === 'forbidden' ? 'Only HR and the CEO review attendance imports.' : notLoadedText(loaded, 'attendance import')}</Empty>;
  const view = loaded.value;
  const draft = run.status === 'draft';
  const hr = preparesPayroll(user);
  const s = reviewSections(view.people);
  const choose = choosePerson.bind(null, id, importId);
  // the payroll's people, for choosing who someone of the files is: Apply fills lines on this payroll only
  const options = run.lines.map((l) => ({ id: l.employeeId, label: `${l.name} · ${l.employeeCode}` })).sort((a, b) => a.label.localeCompare(b.label));
  const title = runTitle(run.month);
  const deletes = canDelete(user);
  const undoesFirst = undoesBeforeDelete(view);
  const blocked = deleteImportBlocked(run.status);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <BackLink href={runHref(run.id)}>{title}</BackLink>
        <h1 className="text-2xl font-semibold">Attendance from Zoho People</h1>
        <p className="text-muted">
          {monthName(view.month)} · read {formatDateTime(view.createdAt)}
          {view.createdBy && ` by ${view.createdBy}`}
          {view.appliedAt ? ` · last applied ${formatDateTime(view.appliedAt)}` : ' · not applied yet'}
        </p>
        {!draft && (
          <p role="status" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
            This payroll isn&apos;t a draft any more: the review is read only.
          </p>
        )}
      </div>

      <section aria-labelledby="files-heading" className="space-y-2">
        <h2 id="files-heading" className="text-lg font-semibold">
          Files
        </h2>
        <ul className="card divide-y divide-line-soft">
          {view.files.map((f) => {
            const note = fileMonthsNote(f, view.month);
            return (
              <li key={f.name} className="px-4 py-3 text-sm">
                <span className="font-medium break-all">{f.name}</span>
                <span className="text-muted">
                  {' '}
                  · {f.rows} {f.rows === 1 ? 'row' : 'rows'} · {f.people} {f.people === 1 ? 'person' : 'people'} · sheet {f.sheet}
                </span>
                {note && <span className="block text-warn">{note}</span>}
                {f.problems.map((p) => (
                  <span key={p} className="block text-xs text-muted">
                    {p}
                  </span>
                ))}
              </li>
            );
          })}
        </ul>
        {hr && draft && (
          <Link href={attendanceUploadHref(run.id)} className="inline-block text-sm font-semibold">
            Upload other files
          </Link>
        )}
      </section>

      <nav aria-label="How many in each section" className="flex flex-wrap gap-2">
        {countChips(view).map((c) => (
          <span key={c.key} className={chip}>
            {c.label}
            <span className="text-muted tabular-nums">{c.count}</span>
          </span>
        ))}
      </nav>

      <Section title="To Confirm" count={s.toConfirm.length} intro="Close to an employee's name, but not the same: confirm who they are, choose someone else, or skip them.">
        <ul className="card divide-y divide-line-soft">
          {s.toConfirm.map((p) => (
            <li key={p.key} className="space-y-3 px-4 py-4">
              <ZohoName p={p} />
              {p.candidates.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-3">
                  <span className="text-sm">
                    Did you mean <Link href={profileHref(c.id)}>{c.fullNameEn}</Link> <span className="text-muted">({c.employeeCode})</span>?
                  </span>
                  {draft && <ChoiceButton action={choose} personKey={p.key} employeeId={c.id} label="Confirm" srLabel={`${c.fullNameEn} for ${p.zohoName}`} variant="primary" />}
                </div>
              ))}
              {draft && (
                <div className="flex flex-wrap items-end gap-3">
                  <PickPerson action={choose} personKey={p.key} zohoName={p.zohoName} options={options} />
                  <ChoiceButton action={choose} personKey={p.key} choice="skip" label="Skip" srLabel={p.zohoName} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Not Found" count={s.notFound.length} intro="No employee has this name: choose who they are from this payroll's people, or skip them.">
        <ul className="card divide-y divide-line-soft">
          {s.notFound.map((p) => (
            <li key={p.key} className="space-y-3 px-4 py-4">
              <ZohoName p={p} />
              {draft && (
                <div className="flex flex-wrap items-end gap-3">
                  <PickPerson action={choose} personKey={p.key} zohoName={p.zohoName} options={options} />
                  <ChoiceButton action={choose} personKey={p.key} choice="skip" label="Skip" srLabel={p.zohoName} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Matched"
        count={s.matched.length + (view.hidden?.count ?? 0)}
        intro="Each person's month by the system's rules: the hours within their shift, at most its hours a day; a working day without a check-in is absent (a no-show day on the payroll); leave from the Leave module."
      >
        <ul className="card divide-y divide-line-soft">
          {s.matched.map((p) => {
            const m = p.month;
            const why = notAppliedReason(p, hr);
            return (
              <li key={p.key} className="px-4 py-4">
                <div className="grid gap-x-6 gap-y-3 md:grid-cols-[minmax(12rem,1fr)_2fr]">
                  <div className="space-y-1">
                    {p.employee && (
                      <Link href={profileHref(p.employee.id)} className="font-semibold">
                        {p.employee.fullNameEn}
                      </Link>
                    )}
                    {p.confidential && <CLevelBadge className="ml-2" title="C-level: the CEO fills their line." />}
                    <span className="block text-xs text-muted">
                      {p.employee?.employeeCode} · Zoho: {p.zohoName}
                      {p.zohoId && ` (${p.zohoId})`}
                    </span>
                    <span className="block text-xs text-muted">{MATCH_TEXT[p.match]}</span>
                    {/* checking in on the system (19 October 2026): their line is filled from their attendance days */}
                    {p.checksIn && <p className="rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs text-accent">{CHECKS_IN_NOTE}</p>}
                    {p.applied && <span className="badge bg-ok-soft text-ok">Applied {formatDateTime(p.applied.at)}</span>}
                    {!p.applied && p.undone && (
                      <span className="badge bg-line-soft text-muted">
                        Undone {formatDateTime(p.undone.at)}
                        {p.undone.by && ` by ${p.undone.by}`}
                      </span>
                    )}
                    {why && <p className="text-xs text-warn">{why}</p>}
                    {draft && p.match === 'confirmed' && <ChoiceButton action={choose} personKey={p.key} choice="undo" label="Undo the choice" srLabel={`for ${p.zohoName}`} />}
                  </div>
                  {m ? (
                    <div className="space-y-2">
                      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div>
                          <dt className="text-xs text-muted">Days worked</dt>
                          <dd className="font-semibold tabular-nums">{m.daysWorked}</dd>
                          <dd className="text-[11px] text-muted">
                            {m.officeDays} at the office · {m.remoteDays} remote
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted">Hours counted</dt>
                          <dd className="font-semibold tabular-nums">{formatHours(m.hoursCounted)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted">Absent days</dt>
                          <dd className={`font-semibold tabular-nums ${m.absentDays ? 'text-danger' : ''}`}>{m.absentDays}</dd>
                          <dd className="text-[11px] text-muted">The payroll&apos;s no-show days</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted">Permission hours</dt>
                          <dd className="text-sm">{permissionText(m)}</dd>
                        </div>
                      </dl>
                      {m.zohoLeaveDays.length > 0 && (
                        <div className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
                          Leave in Zoho, not in the system (not counted as absent): {m.zohoLeaveDays.map((d) => formatDate(d)).join(', ')}.{' '}
                          {p.employee && (
                            <Link href={recordLeaveHref(p.employee.id)} className="font-semibold">
                              Record leave<span className="sr-only"> for {p.employee.fullNameEn}</span>
                            </Link>
                          )}
                        </div>
                      )}
                      {m.warnings.length > 0 && (
                        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
                          {m.warnings.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      )}
                      <Days p={p} />
                    </div>
                  ) : (
                    <p className="text-sm text-muted">No employment of theirs in {monthName(view.month)}: nothing to count.</p>
                  )}
                </div>
              </li>
            );
          })}
          {view.hidden && <li className="px-4 py-4 text-sm font-semibold">{view.hidden.label}</li>}
        </ul>
      </Section>

      <Section title="Skipped" count={s.skipped.length} intro="Left out of this import. Undo to match them again.">
        <ul className="card divide-y divide-line-soft">
          {s.skipped.map((p) => (
            <li key={p.key} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <span className="text-sm">
                <ZohoName p={p} />
              </span>
              {draft && <ChoiceButton action={choose} personKey={p.key} choice="undo" label="Undo" srLabel={`skipping ${p.zohoName}`} />}
            </li>
          ))}
        </ul>
      </Section>

      {draft && (
        <section aria-labelledby="apply-heading" className="card space-y-3 p-6">
          <h2 id="apply-heading" className="font-semibold">
            Apply to the Payroll
          </h2>
          <p className="text-sm text-muted">
            Fills each matched person&apos;s line on {title} that you fill: the worked hours (the hours counted), the no-show days (the absent days) and the
            permission hours, replacing what was typed on them, marked &ldquo;from Zoho&rdquo; on the figures and read only there. Their days are
            kept, replacing the month&apos;s days of an earlier import. The C-level people&apos;s lines are the CEO&apos;s to fill.
          </p>
          {view.canApply ? (
            <ApplyButton action={applyAttendance.bind(null, id, importId)} confirmText={applyConfirmText(view)} />
          ) : (
            <p className="text-sm text-muted">Nobody here is yours to fill yet: confirm or choose the people above, and put them on this payroll first.</p>
          )}
        </section>
      )}

      {draft && (view.undoable ?? 0) > 0 && (
        <section aria-labelledby="undo-heading" className="card space-y-3 p-6">
          <h2 id="undo-heading" className="font-semibold">
            Undo This Import
          </h2>
          <p className="text-sm text-muted">
            The figures it filled can&apos;t be typed over on {title}. To change them, import the month again (its figures replace these), or undo it:
            the {view.undoable === 1 ? 'line' : `${view.undoable} lines`} you fill that it filled go back to the worked hours, no-show days and
            permission hours typed before it was applied (empty if none were), and the days it kept for them are removed.
          </p>
          <UndoButton action={undoAttendance.bind(null, id, importId)} confirmText={undoConfirmText(view)} />
        </section>
      )}

      {deletes && (
        <section aria-labelledby="delete-heading" className="card space-y-3 p-6">
          <h2 id="delete-heading" className="font-semibold">
            Delete This Import
          </h2>
          <p className="text-sm text-muted">
            {undoesFirst
              ? `It is applied, so it is undone first on every line it filled on ${title}, whoever fills them (the C-level people's too): the worked hours, no-show days and permission hours go back to what was typed before it (empty if none were), and the days it kept are removed. Then the import and its files are deleted.`
              : `It isn't applied: the import and its files are deleted, and nothing on ${title} changes.`}{' '}
            This can&apos;t be undone.
          </p>
          <ActionButton
            action={deleteAttendanceImport.bind(null, id, importId, undoesFirst)}
            pendingText="Deleting…"
            variant="danger"
            confirmText={deleteImportConfirmText(view)}
            disabled={blocked !== null}
            disabledNote={blocked ?? undefined}
          >
            {deleteImportLabel(view)}
          </ActionButton>
        </section>
      )}
    </div>
  );
}

export default function AttendanceReviewPage({ params }: PageProps<'/payroll/[id]/attendance/[importId]'>) {
  return (
    <div className="max-w-6xl">
      <Suspense fallback={<Loading />}>
        <Review params={params} />
      </Suspense>
    </div>
  );
}
