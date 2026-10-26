import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { CLevelBadge } from '@/components/c-level-badge';
import { formatDate, formatDateTime } from '@/lib/format';
import type { LeaveImportRow, LeaveImportView } from '@/lib/leave-import-types';
import { canDelete } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { ActionButton } from '../../../employees/[id]/contracts/contract-buttons';
import { profileHref } from '../../../employees/tab-list';
import { BackLink, Empty, Loading, UUID } from '../../../organization/ui';
import { notLoadedText } from '../../../payroll/load';
import { ChoiceButton, PickPerson } from '../../../payroll/[id]/attendance/[importId]/person-forms';
import { applyLeaveImport, chooseImportPerson, deleteLeaveImport, mapImportType, undoLeaveImport } from '../actions';
import { loadLeaveImport } from '../data';
import { TypeMapForm } from '../forms';
import {
  adjustmentText,
  applyConfirmText,
  countChips,
  deleteBlocked,
  deleteConfirmText,
  importsLeave,
  LEAVE_IMPORT_PATH,
  MATCH_TEXT,
  odSpanText,
  orderedRows,
  peopleChosen,
  peopleToConfirm,
  personIds,
  rowDaysText,
  rowPersonText,
  rowTypeText,
  STATUS_TONE,
  statusLabel,
  typeMapValue,
  undoConfirmText,
  undoWhatText,
  whenText,
  wfhDaysListText,
} from '../import';
import { shownCode, withCode } from '@/lib/hidden';

// A leave import's review (owner, 21 October 2026: "how to import bulk leaves?"; "Both" and "Our Excel template"; Zoho
// People's leave export too): the file, where it comes from, and the counts; what to check first (the same file imported
// before: every row a duplicate; holidays Zoho counts that aren't set here; the no-shows on a draft payroll the leave turns
// into leave); a Zoho file's leave types, each mapped once to the system's, to work-from-home days or skipped (Working
// from home as work-from-home days, owner, 21 October 2026: "Yes, as approved WFH days"; Compensatory Off waits for a
// type of its own in Leave Setup); the people to confirm or choose (a name alone, a close
// name, not found) or skip; then every row of Leaves taken and Balances with its status and why, the warnings that don't
// block history and what applying does on the payroll; Apply (the rows ready that are the user's), Undo and, for a Super
// Admin, Delete. A C-level person's rows are one line for HR: the CEO imports them (owner, 19 October 2026). The API
// decides every row and what Apply and Undo change.

export const metadata: Metadata = { title: 'Leave Import Review · People System' };

const chip = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-white px-3.5 text-sm font-semibold';

function Notes({ r }: { r: LeaveImportRow }) {
  return (
    <div className="space-y-1 text-xs">
      {r.reasons.map((t) => (
        <p key={`r:${t}`} className={r.status === 'problem' ? 'text-danger' : r.status === 'waiting' ? 'text-warn' : 'text-muted'}>
          {t}
        </p>
      ))}
      {r.warnings.map((t) => (
        <p key={`w:${t}`} className="text-warn">
          {t}
        </p>
      ))}
      {r.notes.map((t) => (
        <p key={`n:${t}`} className="text-muted">
          {t}
        </p>
      ))}
      {r.notYours && r.status === 'ready' && <p className="text-muted">{r.notYours}</p>}
    </div>
  );
}

function Who({ r }: { r: LeaveImportRow }) {
  const who = rowPersonText(r);
  return (
    <>
      {r.employee ? (
        <Link href={profileHref(r.employee.id)} className="font-semibold">
          {who.name}
        </Link>
      ) : (
        <span className="font-semibold">{who.name}</span>
      )}
      {r.confidential && <CLevelBadge className="ml-1.5" title="C-level: the CEO imports their leave." />}
      {who.detail && <span className="block text-xs text-muted">{who.detail}</span>}
    </>
  );
}

function Status({ r }: { r: LeaveImportRow }) {
  return <span className={`badge ${STATUS_TONE[r.status]}`}>{statusLabel(r)}</span>;
}

function LeavesTable({ rows }: { rows: LeaveImportRow[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col" className="text-right">
              Row
            </th>
            <th scope="col">Status</th>
            <th scope="col">Employee</th>
            <th scope="col">Leave Type</th>
            <th scope="col">When</th>
            <th scope="col">Days</th>
            <th scope="col">Why and What Happens</th>
          </tr>
        </thead>
        <tbody>
          {orderedRows(rows).map((r) => (
            <tr key={r.row} className="align-top">
              <td className="text-right text-muted tabular-nums">{r.row}</td>
              <td className="whitespace-nowrap">
                <Status r={r} />
                {r.approvalText && <span className="mt-1 block text-xs text-muted">Zoho: {r.approvalText}</span>}
              </td>
              <td className="min-w-44">
                <Who r={r} />
              </td>
              <td className="min-w-36 text-sm">
                {rowTypeText(r)}
                {(r.type || r.wfh || r.od) && r.typeText && r.typeText !== rowTypeText(r) && <span className="block text-xs text-muted">In the file: {r.typeText}</span>}
              </td>
              <td className="text-sm whitespace-nowrap tabular-nums">{whenText(r)}</td>
              <td className="text-sm tabular-nums">
                <span className="whitespace-nowrap">{rowDaysText(r)}</span>
                {wfhDaysListText(r) && <span className="block max-w-40 text-xs text-muted">{wfhDaysListText(r)}</span>}
                {odSpanText(r) && <span className="block max-w-40 text-xs text-muted">{odSpanText(r)}</span>}
              </td>
              <td className="min-w-64 max-w-md">
                <Notes r={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BalancesTable({ rows }: { rows: LeaveImportRow[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col" className="text-right">
              Row
            </th>
            <th scope="col">Status</th>
            <th scope="col">Employee</th>
            <th scope="col" className="text-right">
              Balance
            </th>
            <th scope="col">As Of</th>
            <th scope="col" className="text-right">
              Change
            </th>
            <th scope="col">Why and What Happens</th>
          </tr>
        </thead>
        <tbody>
          {orderedRows(rows).map((r) => (
            <tr key={r.row} className="align-top">
              <td className="text-right text-muted tabular-nums">{r.row}</td>
              <td className="whitespace-nowrap">
                <Status r={r} />
              </td>
              <td className="min-w-44">
                <Who r={r} />
              </td>
              <td className="text-right text-sm tabular-nums">{r.balance ?? '—'}</td>
              <td className="text-sm whitespace-nowrap tabular-nums">{r.asOf ? formatDate(r.asOf) : r.fromText || '—'}</td>
              <td className="text-right text-sm whitespace-nowrap tabular-nums">{adjustmentText(r) ?? '—'}</td>
              <td className="min-w-64 max-w-md">
                <Notes r={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Notices({ view }: { view: LeaveImportView }) {
  const items = [
    view.sameFile && { tone: 'bg-danger-soft text-danger', text: `${view.sameFile} Every row of it is a duplicate: nothing new to apply.` },
    view.uploadedBefore && { tone: 'bg-line-soft text-muted', text: view.uploadedBefore },
    view.holidaysHint && { tone: 'bg-warn-soft text-warn', text: view.holidaysHint },
    view.noShowsToLeave && { tone: 'bg-accent-soft text-accent', text: view.noShowsToLeave.text },
    view.hidden && { tone: 'bg-line-soft text-muted', text: view.hidden.label },
  ].filter((x): x is { tone: string; text: string } => !!x);
  if (!items.length) return null;
  return (
    <div className="space-y-2">
      {items.map((i) => (
        <p key={i.text} role="status" className={`rounded-lg px-4 py-3 text-sm ${i.tone}`}>
          {i.text}
        </p>
      ))}
    </div>
  );
}

async function Review({ params }: { params: PageProps<'/leave/import/[id]'>['params'] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await getCurrentUser();
  if (!importsLeave(user)) return <Empty>Only HR imports leave (and the CEO, for C-level people).</Empty>;
  const loaded = await loadLeaveImport(id);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind !== 'ok') return <Empty>{loaded.kind === 'forbidden' ? 'Only HR imports leave (and the CEO, for C-level people).' : notLoadedText(loaded, 'leave import')}</Empty>;
  const view = loaded.value;
  const choose = chooseImportPerson.bind(null, id);
  const options = view.options.map((o) => ({ id: o.id, label: withCode(o.fullNameEn, o.employeeCode) }));
  const toConfirm = peopleToConfirm(view);
  const chosen = peopleChosen(view);
  const deletes = canDelete(user);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <BackLink href={LEAVE_IMPORT_PATH}>Import Leave</BackLink>
        <h1 className="text-2xl font-semibold">Leave Import Review</h1>
        <p className="text-muted">
          <span className="font-medium break-all text-ink">{view.fileName}</span> · {view.sourceLabel} · read {formatDateTime(view.createdAt)}
          {view.createdBy && ` by ${view.createdBy}`}
          {view.appliedAt && ` · applied ${formatDateTime(view.appliedAt)}${view.appliedBy ? ` by ${view.appliedBy}` : ''}`}
          {view.undoneAt && ` · undone ${formatDateTime(view.undoneAt)}${view.undoneBy ? ` by ${view.undoneBy}` : ''}`}
        </p>
      </div>

      <Notices view={view} />

      <nav aria-label="How many rows of each status" className="flex flex-wrap gap-2">
        {countChips(view).map((c) => (
          <span key={c.key} className={chip}>
            {c.label}
            <span className="text-muted tabular-nums">{c.count}</span>
          </span>
        ))}
      </nav>

      {view.types.length > 0 && (
        <section aria-labelledby="types-heading" className="space-y-3">
          <div>
            <h2 id="types-heading" className="text-lg font-semibold">
              Leave Types
            </h2>
            <p className="text-sm text-muted">
              Each of Zoho&apos;s leave types once: the system&apos;s type its rows are imported as, work-from-home days, official duty days, or Skip.
            </p>
          </div>
          <ul className="card divide-y divide-line-soft">
            {view.types.map((t) => (
              <li key={t.zohoType} className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(12rem,1fr)_2fr]">
                <div>
                  <span className="font-semibold">{t.zohoType}</span>
                  <span className="block text-xs text-muted">
                    {t.rows} {t.rows === 1 ? 'row' : 'rows'} · {t.chosen ? 'chosen by you' : 'by default'}
                  </span>
                </div>
                <div className="space-y-2">
                  <TypeMapForm action={mapImportType.bind(null, id)} zohoType={t.zohoType} value={typeMapValue(t)} options={view.typeOptions} />
                  {t.note && <p className="text-xs text-muted">{t.note}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {toConfirm.length > 0 && (
        <section aria-labelledby="people-heading" className="space-y-3">
          <div>
            <h2 id="people-heading" className="text-lg font-semibold">
              People to Confirm <span className="font-normal text-muted tabular-nums">({toConfirm.length})</span>
            </h2>
            <p className="text-sm text-muted">Found by their name only, close to a name, or not found: say who they are, or skip them. Their rows wait until then.</p>
          </div>
          <ul className="card divide-y divide-line-soft">
            {toConfirm.map((p) => (
              <li key={p.key} className="space-y-3 px-4 py-4">
                <div>
                  <span className="font-semibold">{p.name || p.code || 'No name'}</span>
                  <span className="block text-xs text-muted">
                    {[personIds(p), `${p.rows} ${p.rows === 1 ? 'row' : 'rows'}`, MATCH_TEXT[p.match]].filter(Boolean).join(' · ')}
                  </span>
                </div>
                {p.candidates.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-3">
                    <span className="text-sm">
                      Did you mean <Link href={profileHref(c.id)}>{c.fullNameEn}</Link>
                      {shownCode(c.employeeCode) && <span className="text-muted"> ({c.employeeCode})</span>}?
                    </span>
                    <ChoiceButton action={choose} personKey={p.key} employeeId={c.id} label="Confirm" srLabel={`${c.fullNameEn} for ${p.name}`} variant="primary" />
                  </div>
                ))}
                <div className="flex flex-wrap items-end gap-3">
                  <PickPerson action={choose} personKey={p.key} zohoName={p.name || p.code || 'this person'} options={options} />
                  <ChoiceButton action={choose} personKey={p.key} choice="skip" label="Skip" srLabel={p.name} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {chosen.length > 0 && (
        <section aria-labelledby="chosen-heading" className="space-y-3">
          <h2 id="chosen-heading" className="text-lg font-semibold">
            Your Choices <span className="font-normal text-muted tabular-nums">({chosen.length})</span>
          </h2>
          <ul className="card divide-y divide-line-soft">
            {chosen.map((p) => (
              <li key={p.key} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <span className="text-sm">
                  <span className="font-semibold">{p.name || p.code}</span>
                  <span className="block text-xs text-muted">{p.match === 'skipped' ? 'Skipped' : `Chosen as ${p.employee?.fullNameEn ?? 'an employee'}`}</span>
                </span>
                <ChoiceButton action={choose} personKey={p.key} choice="undo" label="Undo" srLabel={`the choice for ${p.name}`} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.leaves.length > 0 && (
        <section aria-labelledby="leaves-heading" className="space-y-3">
          <div>
            <h2 id="leaves-heading" className="text-lg font-semibold">
              Leaves Taken <span className="font-normal text-muted tabular-nums">({view.leaves.length})</span>
            </h2>
            <p className="text-sm text-muted">
              Counted as recorded leave is: working days by the person&apos;s shift, without rest days and the official holidays; a different figure in the
              file is a warning and the system&apos;s is used. A type&apos;s limits and a missing document are warnings only: this is history. A
              work-from-home row makes a work-from-home day each working day of it, not leave; its limits are warnings only too. An official duty row
              makes one approved official duty from its first working day to its last, full days, not leave: its days count as attended.
            </p>
          </div>
          <LeavesTable rows={view.leaves} />
        </section>
      )}

      {view.balances.length > 0 && (
        <section aria-labelledby="balances-heading" className="space-y-3">
          <div>
            <h2 id="balances-heading" className="text-lg font-semibold">
              Balances <span className="font-normal text-muted tabular-nums">({view.balances.length})</span>
            </h2>
            <p className="text-sm text-muted">
              Each person&apos;s annual leave left as of a day, set after the leave above is counted: the change is the figure less what the system has
              left as of that day. A balance at its figure already changes nothing.
            </p>
          </div>
          <BalancesTable rows={view.balances} />
        </section>
      )}

      <section aria-labelledby="apply-heading" className="card space-y-3 p-6">
        <h2 id="apply-heading" className="font-semibold">
          Apply the Import
        </h2>
        <p className="text-sm text-muted">
          In one go: the leave ready is recorded as approved and marked imported (Zoho&apos;s pending leave as requests, sent to their deciders), with
          the work-from-home days and the official duties (approved, or pending ones as requests), then each balance is set. The draft payrolls of
          their months take the leave and the official duties; a payroll with the CEO, approved or paid isn&apos;t changed. A C-level person&apos;s rows
          are the CEO&apos;s to apply.
        </p>
        {view.canApply ? (
          <ActionButton action={applyLeaveImport.bind(null, id)} pendingText="Applying…" variant="primary" confirmText={applyConfirmText(view)}>
            Apply the import
          </ActionButton>
        ) : (
          <p className="text-sm text-muted">Nothing is ready for you to apply: put right the rows with problems, or say who the people waiting are.</p>
        )}
      </section>

      {view.undoable > 0 && (
        <section aria-labelledby="undo-heading" className="card space-y-3 p-6">
          <h2 id="undo-heading" className="font-semibold">
            Undo the Import
          </h2>
          <p className="text-sm text-muted">
            Removes {undoWhatText(view)} it made that you import, while no payroll counting its leave is past its draft; its rows can then be
            imported again.
          </p>
          <ActionButton action={undoLeaveImport.bind(null, id)} pendingText="Undoing…" confirmText={undoConfirmText(view)}>
            Undo the import
          </ActionButton>
        </section>
      )}

      {deletes && (
        <section aria-labelledby="delete-heading" className="card space-y-3 p-6">
          <h2 id="delete-heading" className="font-semibold">
            Delete the Import
          </h2>
          <p className="text-sm text-muted">Deletes the file and its review. Only an import with nothing left in the system: not applied, or undone.</p>
          <ActionButton
            action={deleteLeaveImport.bind(null, id)}
            pendingText="Deleting…"
            variant="danger"
            confirmText={deleteConfirmText(view.fileName)}
            disabled={deleteBlocked(view.kept) !== null}
            disabledNote={deleteBlocked(view.kept) ?? undefined}
          >
            Delete the import
          </ActionButton>
        </section>
      )}
    </div>
  );
}

export default function LeaveImportReviewPage({ params }: PageProps<'/leave/import/[id]'>) {
  return (
    <div className="max-w-7xl">
      <Suspense fallback={<Loading />}>
        <Review params={params} />
      </Suspense>
    </div>
  );
}
