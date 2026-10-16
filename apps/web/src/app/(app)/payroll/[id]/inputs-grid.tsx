'use client';

import Link from 'next/link';
import { Fragment, memo, useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { formatHours, type PayBasis } from '@trendlix/shared';
import { GroupHeading } from '@/components/group-heading';
import { titleCase } from '@/lib/format';
import { groupByPlace, showsDepartment } from '@/lib/place-groups';
import type { FormState } from '@/lib/types';
import { formatEgp } from '../../employees/[id]/contracts/salary';
import { profileHref } from '../../employees/tab-list';
import {
  attendancePercent,
  cellText,
  columnNote,
  errorLine,
  expectedCell,
  GRID_COLUMNS,
  linePatches,
  noShowPay,
  parseCell,
  placeApiErrors,
  tidyCell,
  unsavedCount,
  unsavedText,
  type CellError,
  type FieldKind,
  type GridEdits,
  type GridLine,
  type InputField,
  type LinePatch,
  type RowEdits,
} from './grid';

// The run's inputs grid (owner's decisions, 16 October 2026): the month's figures for each employee, laid out like the
// owner's payroll sheet, typed by HR on a draft until attendance fills them. A wide table, the employee's column kept in
// view while it scrolls sideways. Hours are typed as attendance shows them (270:00) or as a number (270.5); a cell is
// tidied as it is left (270.5 → 270:30). Nothing is saved until Save changes, which sends only the rows that changed in
// one request; a cell that can't be read, or that the API refuses, is marked with the reason. Read only once the run is
// with the CEO, or for anyone but HR. The expected hours are filled in from the shift (owner, 17 October 2026: "prefill
// the expected hours, and dont count abcent days or leave days, as they already have their own deduction and fields"):
// the shift's hours for the month less a day of it for each no-show and leave day typed in the row, shown as the cell's
// figure (marked "from the shift") and changing as those days are typed; only shown, never sent. What HR types over
// them is marked "typed by HR" and taken as already without those days; clearing it brings the shift's back. The
// Attendance % is the worked hours over those expected hours, as the pay counts it, so a day off is charged once
// (owner's decisions, 16 October 2026). A month under two contracts says so under the employee's name (owner,
// 17 October 2026: "take into consideration the start and end date of the contract if it is in the middle of the
// billing period").

export interface GridRow extends GridLine {
  employeeId: string;
  employeeCode: string;
  department: string | null;
  jobTitle: string | null;
  payBasis: PayBasis;
  gross: number;
  hourlyRate: number | null;
  /**
   * A day of the employee's shift, in hours: its hours to work a day, else its window (owner, 16 October 2026: flexible
   * shifts). What a no-show or leave day takes out of the shift's hours (17 October 2026); null without a shift.
   */
  hoursPerDay: number | null;
  /**
   * The shift's hours for the month the run worked out: its working days in the days paid less the holidays, at its
   * hours to work a day (owner's request, 16 October 2026). Less the no-show and leave days typed in the row, the
   * Expected hours cell's figure until HR types another (owner, 17 October 2026). Null without a shift, and by the hour.
   */
  shiftExpectedHours: number | null;
  /** A month under two contracts or more: each one's days (contractsNote); null on one. */
  contractsNote: string | null;
}

const WIDTH: Record<FieldKind, string> = { hours: 'w-24', days: 'w-20', amount: 'w-28', released: 'w-28' };
const cellInput = 'input min-h-9 px-2 py-1 text-right tabular-nums';
const invalid = 'border-danger bg-danger-soft/40';
const stickyCell = 'sticky left-0 z-10 bg-card';

/** Employee, Gross, the inputs, Attendance %, Hold and Comments: what a group's heading spans. */
const COLUMN_COUNT = GRID_COLUMNS.length + 5;

const cellId = (lineId: string, field: string) => `payroll-cell-${lineId}-${field}`;
const cellKey = (e: Pick<CellError, 'lineId' | 'field'>) => `${e.lineId}:${e.field}`;

/** The Attendance % column comes after this one: the hours it is worked out from. */
const ATTENDANCE_AFTER: InputField = 'expectedHours';

const percentFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** What an Expected hours figure is: filled in from the shift, or typed by HR over it (owner, 17 October 2026). */
function expectedTitle(own: boolean, editable: boolean): string {
  return own
    ? `Typed by HR: taken as the expected hours already without the no-show and leave days.${editable ? " Clear it to use the shift's hours." : ''}`
    : `From the shift: its working days this month less the holidays, the no-show and leave days, at its hours to work a day.${editable ? ' Type other hours to replace them.' : ''}`;
}

/** The text a cell shows: as typed, else the saved value. */
function shownText(row: GridLine, edits: RowEdits | undefined, field: InputField, kind: FieldKind): string {
  return edits?.inputs?.[field] ?? cellText(kind, row.inputs[field]);
}

/** The figures a row's expected hours and attendance are worked out from, as typed: a cell that can't be read counts as empty. */
function typedCells(row: GridRow, edits: RowEdits | undefined) {
  const value = (field: InputField, kind: 'hours' | 'days') => {
    const parsed = parseCell(kind, shownText(row, edits, field, kind));
    return parsed.ok ? parsed.value : null;
  };
  return {
    workedHours: value('workedHours', 'hours'),
    expectedHours: value('expectedHours', 'hours'),
    noShowDays: value('noShowDays', 'days'),
    leaveDays: value('leaveDays', 'days'),
  };
}

const Row = memo(function Row({
  row,
  edits,
  errors,
  editable,
  onCell,
  onLeave,
  onHold,
  onComments,
}: {
  row: GridRow;
  edits: RowEdits | undefined;
  errors: CellError[] | undefined;
  editable: boolean;
  onCell: (lineId: string, field: InputField, text: string) => void;
  onLeave: (lineId: string, field: InputField, kind: FieldKind) => void;
  onHold: (lineId: string, held: boolean) => void;
  onComments: (lineId: string, text: string) => void;
}) {
  const errorOf = (field: CellError['field']) => errors?.find((e) => e.field === field)?.message;
  const rowError = errorOf(null);
  const held = edits?.onHold ?? row.onHold;
  const comments = edits?.comments ?? row.comments ?? '';
  // while HR is in the Expected hours cell, the shift's figure is its placeholder, so typing starts afresh
  const [inExpected, setInExpected] = useState(false);
  const cells = typedCells(row, edits);
  // HR's expected hours, else the shift's less the no-show and leave days as typed now (owner, 17 October 2026)
  const expected = expectedCell(row, cells);
  const attendance = attendancePercent(cells.workedHours, expected.hours);
  return (
    <tr className={rowError ? 'bg-danger-soft/40' : undefined}>
      <td className={`${stickyCell} min-w-52`}>
        <Link href={profileHref(row.employeeId)} className="font-semibold">
          {row.name}
        </Link>
        <div className="text-xs text-muted">
          <span className="tabular-nums">{row.employeeCode}</span>
          {row.jobTitle && ` · ${row.jobTitle}`}
        </div>
        {/* a month under two contracts (owner, 17 October 2026) */}
        {row.contractsNote && <p className="mt-0.5 max-w-52 text-xs text-muted">{row.contractsNote}</p>}
        {rowError && (
          <p role="alert" className="mt-1 max-w-52 text-xs text-danger">
            {rowError}
          </p>
        )}
      </td>
      <td className="text-right whitespace-nowrap tabular-nums">
        {row.payBasis === 'hourly' && row.hourlyRate !== null ? (
          <>
            {formatEgp(row.hourlyRate)}
            <div className="text-xs text-muted">an hour</div>
          </>
        ) : (
          formatEgp(row.gross)
        )}
      </td>
      {GRID_COLUMNS.map((c) => {
        const text = shownText(row, edits, c.field, c.kind);
        const error = errorOf(c.field);
        // the Expected hours of a row with a shift: filled in from the shift's unless HR typed others (owner, 17 October
        // 2026); `filled` is only shown, never an edit, so it is never sent nor counts as unsaved
        const shift = c.field === 'expectedHours' && row.shiftExpectedHours !== null;
        const own = text.trim() !== '';
        const filled = shift && !own && expected.hours !== null ? formatHours(expected.hours) : '';
        const markId = `${cellId(row.id, c.field)}-from`;
        return (
          <Fragment key={c.field}>
            <td className="px-2 py-2">
              {editable ? (
                <input
                  id={cellId(row.id, c.field)}
                  value={filled && !inExpected ? filled : text}
                  onChange={(e) => onCell(row.id, c.field, e.target.value)}
                  onFocus={shift ? () => setInExpected(true) : undefined}
                  onBlur={() => {
                    if (shift) setInExpected(false);
                    onLeave(row.id, c.field, c.kind);
                  }}
                  inputMode={c.kind === 'hours' ? 'text' : 'decimal'}
                  autoComplete="off"
                  aria-label={`${c.label} for ${row.name}`}
                  aria-describedby={shift ? markId : undefined}
                  aria-invalid={error ? true : undefined}
                  title={error ?? (shift ? expectedTitle(own, true) : undefined)}
                  placeholder={shift ? filled : c.kind === 'hours' ? '0:00' : undefined}
                  className={`${cellInput} ${WIDTH[c.kind]} ${filled ? 'text-muted italic' : ''} ${error ? invalid : ''}`}
                />
              ) : (
                <span className="block text-right whitespace-nowrap tabular-nums" title={shift ? expectedTitle(own, false) : undefined}>
                  {own ? text : filled ? <span className="text-muted italic">{filled}</span> : <span className="text-muted">—</span>}
                </span>
              )}
              {shift && (
                <span id={markId} className={`mt-0.5 block text-right text-[11px] whitespace-nowrap ${own ? 'text-accent' : 'text-muted'}`}>
                  {own ? 'typed by HR' : 'from the shift'}
                </span>
              )}
            </td>
            {/* the attendance the hours give, after the expected hours */}
            {c.field === ATTENDANCE_AFTER && (
              <td className="text-right whitespace-nowrap tabular-nums">{attendance === null ? '—' : `${percentFormat.format(attendance)}%`}</td>
            )}
          </Fragment>
        );
      })}
      <td className="text-center">
        {editable ? (
          <input
            type="checkbox"
            checked={held}
            onChange={(e) => onHold(row.id, e.target.checked)}
            aria-label={`Hold ${row.name}'s pay this month`}
            className="size-4 accent-accent"
          />
        ) : held ? (
          <span className="badge bg-warn-soft text-warn">On hold</span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className="px-2 py-2">
        {editable ? (
          <input
            id={cellId(row.id, 'comments')}
            value={comments}
            onChange={(e) => onComments(row.id, e.target.value)}
            maxLength={500}
            autoComplete="off"
            aria-label={`Comments for ${row.name}`}
            className="input min-h-9 w-56 px-2 py-1"
          />
        ) : (
          <span className="block min-w-40 text-sm whitespace-normal">{comments || <span className="text-muted">—</span>}</span>
        )}
      </td>
    </tr>
  );
});

/** Drops a row's edits that put it back as saved, so the unsaved count only counts real changes. */
function withoutEmpty(edits: GridEdits, lineId: string, row: RowEdits): GridEdits {
  const next = { ...edits };
  const empty = !row.inputs || Object.keys(row.inputs).length === 0;
  if (empty && row.onHold === undefined && row.comments === undefined) delete next[lineId];
  else next[lineId] = row;
  return next;
}

export function InputsGrid({
  rows,
  noShowDayMultiplier,
  editable,
  save,
}: {
  rows: GridRow[];
  /** The run's rule: what a no-show day costs, in days' pay. */
  noShowDayMultiplier: number;
  editable: boolean;
  /** Saves the changed rows (PATCH /payroll/runs/:id/lines); null when the grid is read only. */
  save: ((lines: LinePatch[]) => Promise<FormState>) | null;
}) {
  const [edits, setEdits] = useState<GridEdits>({});
  // the cells left (or saved) with something that can't be read: marked from then on, until put right
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  // what the API refused at the last save, by cell; a cell's goes once it is changed
  const [apiErrors, setApiErrors] = useState<CellError[]>([]);
  const [general, setGeneral] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const canEdit = editable && save !== null;

  const byLine = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const groups = useMemo(() => groupByPlace(rows, (l) => l.department), [rows]);
  const changes = useMemo(() => linePatches(rows, edits), [rows, edits]);
  const unsaved = useMemo(() => (canEdit ? unsavedCount(rows, edits) : { cells: 0, rows: 0 }), [canEdit, rows, edits]);
  const errors = useMemo(() => {
    if (!canEdit) return [];
    const typed = changes.errors.filter((e) => touched.has(cellKey(e)));
    return [...typed, ...apiErrors.filter((a) => !typed.some((t) => cellKey(t) === cellKey(a)))];
  }, [canEdit, changes, touched, apiErrors]);
  const errorsByLine = useMemo(() => {
    const map = new Map<string, CellError[]>();
    for (const e of errors) map.set(e.lineId, [...(map.get(e.lineId) ?? []), e]);
    return map;
  }, [errors]);

  // leaving the page with changes not saved asks first
  useEffect(() => {
    if (unsaved.cells === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved.cells]);

  /** A cell changed: what the API said about it no longer holds. */
  const changed = useCallback((lineId: string, field: CellError['field']) => {
    setMessage(null);
    setApiErrors((all) => all.filter((e) => !(e.lineId === lineId && (e.field === field || e.field === null))));
  }, []);

  const onCell = useCallback(
    (lineId: string, field: InputField, text: string) => {
      changed(lineId, field);
      setEdits((all) => ({ ...all, [lineId]: { ...all[lineId], inputs: { ...all[lineId]?.inputs, [field]: text } } }));
    },
    [changed],
  );

  const onLeave = useCallback(
    (lineId: string, field: InputField, kind: FieldKind) => {
      const row = byLine.get(lineId);
      setTouched((all) => new Set(all).add(`${lineId}:${field}`));
      setEdits((all) => {
        const typed = all[lineId]?.inputs?.[field];
        if (typed === undefined || !row) return all;
        const parsed = parseCell(kind, typed);
        const inputs = { ...all[lineId]?.inputs };
        // typed back to what is saved: no longer a change
        if (parsed.ok && parsed.value === row.inputs[field]) delete inputs[field];
        else inputs[field] = tidyCell(kind, typed);
        return withoutEmpty(all, lineId, { ...all[lineId], inputs });
      });
    },
    [byLine],
  );

  const onHold = useCallback(
    (lineId: string, held: boolean) => {
      changed(lineId, 'onHold');
      const row = byLine.get(lineId);
      setEdits((all) => withoutEmpty(all, lineId, { ...all[lineId], onHold: row && held === row.onHold ? undefined : held }));
    },
    [byLine, changed],
  );

  const onComments = useCallback(
    (lineId: string, text: string) => {
      changed(lineId, 'comments');
      setEdits((all) => ({ ...all, [lineId]: { ...all[lineId], comments: text } }));
    },
    [changed],
  );

  function saveChanges() {
    if (!save) return;
    setGeneral([]);
    setMessage(null);
    if (changes.errors.length > 0) {
      // every cell that can't be read is marked, not only those left already
      setTouched((all) => new Set([...all, ...changes.errors.map(cellKey)]));
      return;
    }
    const patches = changes.patches;
    if (patches.length === 0) {
      setEdits({});
      return;
    }
    startTransition(async () => {
      const answer = await save(patches);
      if (answer.errors?.length) {
        const placed = placeApiErrors(answer.errors, patches);
        setApiErrors(placed.cells);
        setGeneral(placed.general);
        return;
      }
      setEdits({});
      setTouched(new Set());
      setApiErrors([]);
      setMessage(answer.message ?? 'Saved.');
    });
  }

  function discard() {
    if (!window.confirm('Discard the changes not saved? The grid goes back to what is saved.')) return;
    setEdits({});
    setTouched(new Set());
    setApiErrors([]);
    setGeneral([]);
  }

  const focusCell = (e: CellError) => document.getElementById(cellId(e.lineId, e.field ?? 'comments'))?.focus();

  return (
    <div className="space-y-3">
      {(errors.length > 0 || general.length > 0) && (
        <div role="alert" className="space-y-1 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          {errors.length > 0 && <p className="font-semibold">Put right the cells marked in red, then save again.</p>}
          <ul className="list-disc space-y-0.5 pl-4">
            {general.map((g) => (
              <li key={g}>{g}</li>
            ))}
            {errors.map((e) => (
              <li key={`${e.lineId}-${e.field}`}>
                {e.field ? (
                  <button type="button" onClick={() => focusCell(e)} className="text-left underline-offset-2 hover:underline">
                    {errorLine(e, byLine.get(e.lineId)?.name ?? 'A row')}
                  </button>
                ) : (
                  errorLine(e, byLine.get(e.lineId)?.name ?? 'A row')
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card max-h-[75vh] overflow-auto">
        <table className="table [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-20 [&_thead_th]:bg-card">
          <thead>
            <tr>
              <th scope="col" className="left-0 z-30! min-w-52">
                Employee
              </th>
              <th scope="col" className="text-right">
                Gross
              </th>
              {GRID_COLUMNS.map((c) => (
                <Fragment key={c.field}>
                  <th scope="col" className="px-2 text-right">
                    {titleCase(c.label)}
                    {columnNote(c.field, noShowDayMultiplier) && (
                      <span className="ml-auto block max-w-32 text-xs font-normal whitespace-normal text-muted">{columnNote(c.field, noShowDayMultiplier)}</span>
                    )}
                  </th>
                  {c.field === ATTENDANCE_AFTER && (
                    <th scope="col" className="text-right">
                      Attendance %
                    </th>
                  )}
                </Fragment>
              ))}
              <th scope="col" className="text-center">
                Hold
              </th>
              <th scope="col" className="px-2">
                Comments
              </th>
            </tr>
          </thead>
          {/* by department, then by team (owner's request, 16 October 2026) */}
          {groups.map((g) => (
            <tbody key={g.department ?? ''}>
              {showsDepartment(groups, g) && <GroupHeading level="department" name={g.department} count={g.count} span={COLUMN_COUNT} />}
              {g.teams.map((t) => (
                <Fragment key={t.team ?? ''}>
                  {t.team !== null && <GroupHeading level="team" name={t.team} count={t.rows.length} span={COLUMN_COUNT} />}
                  {t.rows.map((row) => (
                    <Row
                      key={row.id}
                      row={row}
                      edits={canEdit ? edits[row.id] : undefined}
                      errors={errorsByLine.get(row.id)}
                      editable={canEdit}
                      onCell={onCell}
                      onLeave={onLeave}
                      onHold={onHold}
                      onComments={onComments}
                    />
                  ))}
                </Fragment>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={saveChanges} disabled={pending || unsaved.cells === 0} className="btn btn-primary">
            {pending ? 'Saving…' : 'Save changes'}
          </button>
          {unsaved.cells > 0 && (
            <>
              <button type="button" onClick={discard} disabled={pending} className="btn btn-secondary">
                Discard changes
              </button>
              <span role="status" className="badge bg-warn-soft text-warn">
                {unsavedText(unsaved)}
              </span>
            </>
          )}
          {message && unsaved.cells === 0 && (
            <p role="status" className="text-sm text-ok">
              {message}
            </p>
          )}
        </div>
      )}
      {canEdit && (
        <p className="hint">
          Hours as 270:00 or 270.5; days in whole or half days. Leave a cell empty when it doesn&apos;t apply: empty
          worked hours count in full. The expected hours are filled in from the shift: its working days in the days paid
          less the holidays (<Link href="/organization/holidays">Organization → Holidays</Link>) and less the no-show and
          leave days, at its hours to work a day, and they change as you type those days. Type other hours to replace
          them, already without the no-show and leave days; clearing them brings the shift&apos;s back. Without a shift,
          type them yourself, without those days. No-show days: {noShowPay(noShowDayMultiplier)}, and their hours
          aren&apos;t counted in attendance. Leave days: approved paid leave this month, typed until the Leave module
          fills them: nothing is cut, and their hours aren&apos;t counted in attendance. On hold: left out of the bank
          files this month.
        </p>
      )}
    </div>
  );
}
