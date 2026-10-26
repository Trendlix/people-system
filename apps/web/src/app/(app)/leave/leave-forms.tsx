'use client';

import Link from 'next/link';
import { startTransition, useActionState, useRef, useState, useTransition } from 'react';
import {
  LEAVE_DECISION_LABELS,
  LEAVE_DECISIONS,
  HANDOVER_NOTE_MAX,
  LEAVE_DOCUMENTS_MAX,
  leaveDecisionNeedsComment,
  leaveTypeRulesText,
  type CoverCandidate,
  type LeaveDecision,
  type LeaveFormCoverage,
  type LeaveGender,
  type LeaveStage,
} from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { DocumentViewer } from '@/components/document-viewer';
import { fits } from '@/components/file-drop';
import { FormErrors, useFieldIds, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import { SurfaceField, useAppSection } from '@/components/surface';
import { CameraButton } from '@/components/camera-button';
import { formatDate, parseDate, titleCase } from '@/lib/format';
import type { FormState, Holiday, LeaveBalances, LeaveRequestView, LeaveTypeView } from '@/lib/types';
import { choice } from '../employees/[id]/contracts/pay-fields';
import { shrinkPhoto } from '../employees/shrink-photo';
import { sizeText } from '../reimbursements/claim';
import { leaveCoverage, leaveYearData } from './actions';
import { CoverageFields, type CoverageChoice } from './coverage-fields';
import { placeText } from './coverage';
import { EDIT_NOTE_MAX, editChanged, editHint, editPreview, editPreviewText, editStart, type TypedEdit } from './edit';
import { daysNumber, daysText, hrStageName, LEAVE_COMMENT_READERS, leaveCommentReaders, leaveDecisionButton } from './list';
import { correctionDecisionButton } from '../attendance/corrections/corrections';
import { permissionDecisionButton } from './permissions';
import { balanceAfter, countLeaveDays, countText, coverProblems, datesLine, DOCUMENT_ACCEPT, endFollowingStart, leaveFormProblems, overBalanceNote, readDates, REASON_MAX, requestYear, rulesOf, type TypedLeave } from './request';

// The forms of a leave request (owner, 18 October 2026: "can you apply the leaves according to the law?"): the new
// request, for an employee themself or recorded by HR on their behalf, with the type's rules in words beside it, its days
// counted live as the law counts them (the shift's working days less the official holidays, Art. 124; calendar days for
// a type counted so), the annual balance after it, and the shared checks shown live, Send staying off while any is left;
// an approver's decision on the request's page (Approve, or Reject with a comment); the employee's Cancel; HR's Cancel of
// an approved one, with a comment; and HR's adjustment of a balance. The API checks everything again. A permission
// request (owner, 19 October 2026: "In the system, like leave") is decided and cancelled with the same forms, worded for
// it (`kind`): its hours, not days, go back. Leave coverage (owner, 25 October 2026: "Names, no leave types", "Warn and
// need HR", "Required over 2 days", "To a stand-in"): the employee's own request reads, as its days and type are chosen,
// who else of their team is off (names only), the staffing limit's warning (still sendable), the colleagues they cover
// on those days, and asks for the colleague who covers (required over 2 working days of annual or unpaid leave), a
// handover note and, for someone who approves for others, their stand-in; its employee changes the cover later.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const optional = <span className="font-normal text-muted">(optional)</span>;

// ---------- the documents ----------

/** A document chosen, with a key of its own for the list (two files may have the same name). */
interface Chosen {
  key: number;
  file: File;
}

/**
 * The documents (a medical certificate, proof of sitting the exam), photos or PDFs, up to LEAVE_DOCUMENTS_MAX: chosen
 * (several at once), dragged in or pasted, each shown with its size, View (the document viewer, on the file itself) and
 * Remove. Photos are made smaller first: all of them go in one upload, which Vercel limits.
 */
function DocumentsField({
  fid,
  documents,
  onChange,
  onBusy,
  required,
}: {
  fid: (name: string) => string;
  documents: Chosen[];
  onChange: (next: (list: Chosen[]) => Chosen[]) => void;
  onBusy: (busy: boolean) => void;
  required: boolean;
}) {
  const box = useRef<HTMLInputElement>(null);
  const next = useRef(1);
  const [over, setOver] = useState(false);
  const [refused, setRefused] = useState<string[]>([]);
  // on the phone pages (owner, 20 October 2026: the employee app): Take a photo too, e.g. of a medical certificate
  const onPhonePages = useAppSection() !== null;

  async function add(files: readonly File[]) {
    const taken = files.filter((f) => fits(f, DOCUMENT_ACCEPT));
    setRefused(files.filter((f) => !fits(f, DOCUMENT_ACCEPT)).map((f) => f.name || 'A file'));
    if (!taken.length) return;
    onBusy(true);
    try {
      const smaller = await Promise.all(taken.map((f) => shrinkPhoto(f)));
      onChange((list) => [...list, ...smaller.map((file) => ({ key: next.current++, file }))]);
    } finally {
      onBusy(false);
      if (box.current) box.current.value = '';
    }
  }

  const left = LEAVE_DOCUMENTS_MAX - documents.length;
  return (
    <fieldset aria-describedby={fid('documents-hint')}>
      <legend className="label">Documents {required ? <span className="font-normal text-muted">(required for this type)</span> : optional}</legend>
      <div
        tabIndex={-1}
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.types).includes('Files')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setOver(false);
          void add(Array.from(e.dataTransfer.files));
        }}
        onPaste={(e) => {
          const files = e.clipboardData?.files;
          if (!files?.length) return;
          e.preventDefault();
          void add(Array.from(files));
        }}
        className={`space-y-2 rounded-lg border border-dashed p-3 outline-none focus:border-accent ${over ? 'border-accent bg-accent-soft' : 'border-line bg-white'}`}
      >
        <label htmlFor={fid('documents')} className="sr-only">
          Add documents
        </label>
        <input
          ref={box}
          id={fid('documents')}
          type="file"
          multiple
          accept={DOCUMENT_ACCEPT}
          onChange={(e) => void add(Array.from(e.currentTarget.files ?? []))}
          className="block w-full text-sm file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border file:border-line file:bg-white file:px-4 file:text-sm file:font-semibold"
        />
        {onPhonePages && <CameraButton onFiles={(files) => void add(files)} disabled={left <= 0} label="Take a photo of the document" />}
        <p aria-live="polite" className={`text-xs ${refused.length ? 'text-danger' : 'text-muted'}`}>
          {refused.length
            ? `${refused.join(', ')} ${refused.length === 1 ? 'was' : 'were'} not added: a document is a photo (JPG, PNG or WebP) or a PDF.`
            : over
              ? 'Drop the files here to add them.'
              : left > 0
                ? `Choose, drag or paste photos or PDFs; ${left === LEAVE_DOCUMENTS_MAX ? `up to ${left}` : `${left} more`}.`
                : `That is ${LEAVE_DOCUMENTS_MAX}, the most a request takes.`}
        </p>
      </div>
      <p id={fid('documents-hint')} className="hint">
        A medical certificate for sick leave, proof of sitting the exam for exam leave, or another paper the leave needs. On a phone you can take
        the photo here.
      </p>
      {documents.length > 0 && (
        <ul className="mt-2 divide-y divide-line-soft rounded-lg border border-line bg-white" aria-label="Documents added">
          {documents.map(({ key, file }, i) => (
            <li key={key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="min-w-0 break-all">
                {file.name || `Document ${i + 1}`} <span className="text-muted tabular-nums">· {sizeText(file.size)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <DocumentViewer title={`Document ${i + 1} · ${file.name}`} files={[{ alt: file.name || `Document ${i + 1}`, src: file }]}>
                  View<span className="sr-only"> {file.name}</span>
                </DocumentViewer>
                <button
                  type="button"
                  onClick={() => onChange((list) => list.filter((r) => r.key !== key))}
                  className="inline-flex min-h-9 cursor-pointer items-center text-sm font-semibold text-danger hover:underline"
                >
                  Remove<span className="sr-only"> {file.name}</span>
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

// ---------- the type chosen ----------

/** The type's rules in words, its Arabic name, and what is left of it for the employee. */
function TypePanel({ type, balances }: { type: LeaveTypeView; balances: LeaveBalances | null }) {
  const mine = balances?.types.find((t) => t.typeId === type.id);
  const annual = type.balance === 'annual' || type.balance === 'from_annual';
  return (
    <section aria-label={`What ${type.nameEn} allows`} className="space-y-2 rounded-lg border border-line bg-canvas p-4">
      <h3 className="text-sm font-semibold">
        {titleCase(type.nameEn)}{' '}
        <span lang="ar" dir="rtl" className="inline-block font-normal text-muted">
          {type.nameAr}
        </span>
      </h3>
      <p className="text-sm">{leaveTypeRulesText(rulesOf(type))}</p>
      {balances && (
        <p className="text-sm text-muted">
          {annual && (
            <>
              Annual balance available in {balances.year}: <span className="font-semibold text-ink tabular-nums">{daysNumber(balances.annual.available)}</span>
              {mine?.left != null && ' · '}
            </>
          )}
          {mine?.left != null && (
            <>
              Left of {type.nameEn.toLowerCase()} this year: <span className="font-semibold text-ink tabular-nums">{daysNumber(mine.left)}</span>
            </>
          )}
          {!annual && mine?.left == null && type.maxTimesInService !== null && mine && `Taken ${mine.timesInService} of ${type.maxTimesInService} times in service.`}
        </p>
      )}
    </section>
  );
}

/** The balances and holidays the checks use: of a year, for whom. */
interface YearData {
  year: number;
  balances: LeaveBalances | null;
  holidays: Holiday[];
}

/** Who the leave is for: the employee themself, or someone HR records it for. */
export interface LeavePerson {
  /** For HR recording on their behalf; null for the employee themself. */
  employeeId: string | null;
  name: string;
  workingDays: readonly number[] | null;
  joinDate: string | null;
  gender: LeaveGender | null;
}

/**
 * A new leave request (POST /me/leave/requests), or HR's record of leave on someone's behalf (POST /leave/requests,
 * `person.employeeId`), approved at once with no notice needed: the type, among the active ones, with its rules and what
 * is left; the first and last day; a half day where the type allows it; the reason; the documents. The days are counted
 * live and the checks show live; Send stays off while any is left. A first day in another year reads that year's
 * balances and holidays. Once sent, the request's page opens; a refusal shows here, with what was typed (the documents
 * too: they stay in the page).
 */
export function NewLeaveForm({
  action,
  types,
  today,
  person,
  initial,
  cancelHref,
  toCeo = false,
  allowNegative = false,
}: {
  action: Action;
  types: LeaveTypeView[];
  today: string;
  person: LeavePerson;
  initial: YearData;
  cancelHref: string;
  /** The employee is C-level (19 October 2026): after their manager it goes to the CEO, not HR. */
  toCeo?: boolean;
  /** A Super Admin recording it: beyond the annual balance is allowed, after a warning (26 October 2026). */
  allowNegative?: boolean;
}) {
  const [state, formAction, sending] = useActionState(action, {});
  const fid = useFieldIds();
  const byHr = person.employeeId !== null;
  const [typed, setTyped] = useState<TypedLeave>(() => ({
    typeId: valueOf(state, 'typeId', types.length === 1 ? types[0].id : ''),
    startDate: valueOf(state, 'startDate'),
    endDate: valueOf(state, 'endDate'),
    halfDay: valueOf(state, 'halfDay') === 'true',
    reason: valueOf(state, 'reason'),
  }));
  const [loaded, setLoaded] = useState<YearData>(initial);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [checking, startChecking] = useTransition();
  const asked = useRef(initial.year);
  // the last day follows the first, unless it was changed by hand in this form (26 October 2026)
  const lastStart = useRef(parseDate(valueOf(state, 'startDate')) || '');
  const endByHand = useRef(false);
  const [endKey, setEndKey] = useState(0);
  const [documents, setDocuments] = useState<Chosen[]>([]);
  const [shrinking, setShrinking] = useState(false);
  // who else is off, the cover and the stand-in (25 October 2026): the employee's own request only
  const [coverage, setCoverage] = useState<LeaveFormCoverage | null>(null);
  const [coverageProblem, setCoverageProblem] = useState<string | null>(null);
  const [readingCoverage, startCoverage] = useTransition();
  const coverageAsked = useRef('');
  const [choice, setChoice] = useState<CoverageChoice>(() => ({
    coverId: valueOf(state, 'coverId'),
    handoverNote: valueOf(state, 'handoverNote'),
    standIn: valueOf(state, 'standIn'),
  }));

  const type = types.find((t) => t.id === typed.typeId) ?? null;
  const year = requestYear(typed, today);
  const stale = year !== loaded.year;
  const ctx = { workingDays: person.workingDays, holidays: loaded.holidays, balances: stale ? null : loaded.balances, joinDate: person.joinDate, gender: person.gender, today, byHr, allowNegative: allowNegative && byHr };
  const days = countLeaveDays(typed, type, ctx);
  const after = balanceAfter(type, ctx.balances, days);
  // a Super Admin's record saves beyond the balance, after this warning (owner, 26 October 2026)
  const overNote = ctx.allowNegative ? overBalanceNote(type, ctx.balances, days) : null;
  const problems = leaveFormProblems(
    typed,
    type,
    documents.map((d) => d.file),
    ctx,
  );
  if (checking || (stale && !loadProblem)) problems.push(`Checking the balance and the holidays of ${year}…`);
  if (!byHr && coverage) {
    problems.push(...coverProblems(coverage.cover.required, choice.coverId, choice.handoverNote));
    // the colleague chosen is off on the days chosen since
    if (choice.coverId && !coverage.cover.candidates.some((c: CoverCandidate) => c.id === choice.coverId)) problems.push('The colleague chosen to cover is off on some of these days: choose another.');
  }
  if (!byHr && readingCoverage) problems.push('Checking who else is off on these days…');
  const blocked = problems.length > 0 || shrinking || sending;

  /** The balances and holidays again, for the year of the first day typed. */
  function readFor(wanted: number) {
    if (wanted === asked.current) return;
    asked.current = wanted;
    setLoadProblem(null);
    startChecking(async () => {
      const answer = await leaveYearData(wanted, person.employeeId);
      if (asked.current !== wanted) return;
      if ('balances' in answer) setLoaded({ year: wanted, balances: answer.balances, holidays: answer.holidays });
      else setLoadProblem(`The balance of ${wanted} couldn't be checked: ${answer.errors.join(' ')} It is checked again when you send it.`);
    });
  }

  /**
   * Who else is off on the days typed, the limit, the cover and the stand-in (GET /me/leave/coverage), read again once
   * the days, the type or the half day change (25 October 2026); the latest asked wins.
   */
  function readCoverage(next: TypedLeave) {
    if (byHr) return;
    const { startDate, endDate } = readDates(next);
    if (!startDate || !endDate || endDate < startDate) {
      // while a date is being typed the last answer stays (Send waits for the dates anyway); none once they are cleared
      coverageAsked.current = '';
      if (next.startDate.trim() === '') setCoverage(null);
      return;
    }
    const key = `${startDate}|${endDate}|${next.typeId}|${next.halfDay}`;
    if (key === coverageAsked.current) return;
    coverageAsked.current = key;
    startCoverage(async () => {
      const answer = await leaveCoverage(startDate, endDate, next.typeId, next.halfDay);
      if (coverageAsked.current !== key) return;
      if ('coverage' in answer) {
        setCoverage(answer.coverage);
        setCoverageProblem(null);
      } else {
        setCoverage(null);
        setCoverageProblem(`Who else is off couldn't be checked: ${answer.errors.join(' ')} The cover and the limit are checked when you send it.`);
      }
    });
  }

  function set<K extends keyof TypedLeave>(key: K, value: TypedLeave[K]) {
    let next: TypedLeave = { ...typed, [key]: value };
    if (key === 'endDate') endByHand.current = true;
    if (key === 'startDate') {
      const moved = endFollowingStart(lastStart.current, value as string, typed.endDate, endByHand.current);
      if (moved !== typed.endDate) {
        next = { ...next, endDate: moved };
        setEndKey((k) => k + 1);
      }
      const date = parseDate(value as string);
      if (date) {
        lastStart.current = date;
        readFor(Number(date.slice(0, 4)));
      }
    }
    setTyped(next);
    if (key === 'startDate' || key === 'endDate' || key === 'typeId' || key === 'halfDay') readCoverage(next);
  }

  function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (blocked) return;
    const fd = new FormData(e.currentTarget);
    fd.delete('documents');
    for (const { file } of documents) fd.append('documents', file, file.name);
    startTransition(() => formAction(fd));
  }

  const halfAllowed = !!type?.halfDays;
  const oneDay = (() => {
    const s = parseDate(typed.startDate);
    const end = typed.endDate.trim() === '' ? s : parseDate(typed.endDate);
    return !!s && s === end;
  })();

  return (
    <form
      onSubmit={send}
      onChange={(e) => {
        // the dates typed, for the count and the checks (the fields stay uncontrolled)
        if (e.target instanceof HTMLInputElement && (e.target.name === 'startDate' || e.target.name === 'endDate')) set(e.target.name as 'startDate' | 'endDate', e.target.value);
      }}
      aria-label={byHr ? `Record leave for ${person.name}` : 'New leave request'}
      className="card space-y-5 p-5"
    >
      <FormErrors errors={state.errors} />
      <SurfaceField />
      {person.employeeId && <input type="hidden" name="employeeId" value={person.employeeId} />}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={fid('typeId')} className="label">
            Type of leave
          </label>
          <Select
            id={fid('typeId')}
            name="typeId"
            required
            value={typed.typeId}
            onChange={(e) => set('typeId', e.target.value)}
            aria-describedby={fid('typeId-hint')}
            className="input"
          >
            <option value="">Choose a type</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nameEn}
              </option>
            ))}
          </Select>
          <p id={fid('typeId-hint')} className="hint">
            The types HR set up, each with its rules from the Labour Law.
          </p>
        </div>
        {type && (
          <div className="sm:col-span-2">
            <TypePanel type={type} balances={ctx.balances} />
          </div>
        )}
        <div>
          <label htmlFor={fid('startDate')} className="label">
            First day
          </label>
          <DateInput id={fid('startDate')} name="startDate" required defaultValue={typed.startDate} aria-describedby={fid('startDate-hint')} />
          <p id={fid('startDate-hint')} className="hint">
            {byHr ? 'It may be in the past, e.g. sick leave reported afterwards.' : type?.noticeDays ? `This type needs ${daysText(type.noticeDays)}' notice.` : 'The first day off.'}
          </p>
        </div>
        <div>
          <label htmlFor={fid('endDate')} className="label">
            Last day {optional}
          </label>
          <DateInput key={endKey} id={fid('endDate')} name="endDate" defaultValue={typed.endDate} aria-describedby={fid('endDate-hint')} />
          <p id={fid('endDate-hint')} className="hint">
            Empty: one day, the first. It moves with the first day unless you set it.
          </p>
        </div>
        {halfAllowed && (
          <div className="sm:col-span-2">
            <label className={`${choice} w-fit ${oneDay ? '' : 'opacity-60'}`}>
              <input
                type="checkbox"
                checked={typed.halfDay}
                onChange={(e) => set('halfDay', e.target.checked)}
                disabled={!oneDay && !typed.halfDay}
                aria-describedby={fid('halfDay-hint')}
                className="size-4 accent-accent"
              />
              Half a day
            </label>
            <p id={fid('halfDay-hint')} className="hint">
              For one day only: make the first and last day the same.
            </p>
          </div>
        )}
        {/* sent as "true" or "false", whatever the type (a type without half days sends false) */}
        <input type="hidden" name="halfDay" value={String(typed.halfDay && halfAllowed)} />
        <div className="sm:col-span-2" role="status" aria-live="polite">
          {overNote && (
            <p className="mb-2 rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">{overNote} Only a Super Admin may record leave beyond the balance.</p>
          )}
          <p className="rounded-lg bg-canvas px-4 py-3 text-sm">
            <span className="font-semibold tabular-nums">{countText(days, after, byHr)}</span>
            {type && days > 0 && (
              <span className="block text-xs text-muted">
                {type.calendarDays
                  ? 'Counted in calendar days, every day from the first to the last.'
                  : 'Counted in working days of the shift: rest days and official holidays aren’t counted (Labour Law Art. 124).'}
                {!type.calendarDays &&
                  (() => {
                    const s = parseDate(typed.startDate);
                    const end = typed.endDate.trim() === '' ? s : parseDate(typed.endDate);
                    const off = loaded.holidays.filter((h) => s && end && h.date >= s && h.date <= end);
                    return off.length ? ` Holidays left out: ${off.map((h) => `${h.nameEn} (${formatDate(h.date)})`).join(', ')}.` : '';
                  })()}
              </span>
            )}
          </p>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={fid('reason')} className="label">
            Reason {optional}
          </label>
          <textarea
            id={fid('reason')}
            name="reason"
            rows={2}
            maxLength={REASON_MAX}
            value={typed.reason}
            onChange={(e) => set('reason', e.target.value)}
            aria-describedby={fid('reason-hint')}
            className="input"
          />
          <p id={fid('reason-hint')} className="hint">
            {byHr ? 'E.g. reported by phone; the certificate follows.' : 'Your direct manager and HR read it.'} Up to {REASON_MAX} characters.
          </p>
        </div>
        <div className="sm:col-span-2">
          <DocumentsField fid={fid} documents={documents} onChange={setDocuments} onBusy={setShrinking} required={!!type?.documentRequired} />
        </div>
        {!byHr && (
          <div className="space-y-4 sm:col-span-2">
            <CoverageFields
              fid={fid}
              coverage={coverage}
              reading={readingCoverage}
              problem={coverageProblem}
              choice={choice}
              onChange={(next) => setChoice((c) => ({ ...c, ...next }))}
              toCeo={toCeo}
            />
          </div>
        )}
      </div>

      {loadProblem && <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">{loadProblem}</p>}
      {!initial.balances && !loadProblem && <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">The balance couldn&apos;t be loaded: it is checked when you send it.</p>}
      <div role="status" aria-live="polite">
        {problems.length ? (
          <div className="rounded-lg border border-line bg-canvas px-4 py-3 text-sm">
            <p className="font-medium">Before you can send it:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
            Ready to {byHr ? 'record' : 'send'}: {daysText(days)} of {type?.nameEn.toLowerCase()}
            {byHr
              ? ` for ${person.name}, approved at once.`
              : `, to your direct manager (without one, your lead), then ${hrStageName(toCeo)}${coverage?.overLimit ? ' (over the staffing limit)' : ''}.`}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={blocked} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-60">
          {sending ? (byHr ? 'Recording…' : 'Sending…') : shrinking ? 'Preparing the photos…' : byHr ? 'Record leave' : 'Send request'}
        </button>
        <Link href={cancelHref} className={`btn btn-secondary ${sending ? 'pointer-events-none opacity-60' : ''}`} aria-disabled={sending || undefined}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

// ---------- a Super Admin edits a leave ----------

/**
 * A Super Admin edits any leave (PATCH /leave/requests/:id; owner, 26 October 2026: "as a superadmin i need to edit the
 * leaves"; asked, the type, the dates, the reason and who covers it, in any status): the leave's own values to start
 * with; the days counted live as the leave form counts them, with the annual balance after it; half a day where the type
 * allows it; the colleague who covers (anyone employed now but the employee: the API checks the days they are off) and
 * why it is edited, kept on the leave's step and in the audit log. Only Save is needed: the API finds what changed and
 * answers what is wrong, shown here with what was typed. A first day in another year reads that year's balance and
 * holidays.
 */
export function EditLeaveForm({
  action,
  request,
  types,
  person,
  initial,
  colleagues,
  today,
}: {
  action: Action;
  request: LeaveRequestView;
  /** The types it can become (its own among them). */
  types: LeaveTypeView[];
  person: Pick<LeavePerson, 'workingDays'>;
  initial: YearData;
  /** The colleagues who may cover it, employed now (null: they couldn't be loaded). */
  colleagues: readonly { id: string; label: string }[] | null;
  today: string;
}) {
  const [state, formAction, saving] = useActionState(action, {});
  const fid = useFieldIds();
  const start = editStart(request);
  const [typed, setTyped] = useState<TypedEdit>(() => ({
    typeId: valueOf(state, 'typeId', start.typeId),
    startDate: valueOf(state, 'startDate', start.startDate),
    endDate: valueOf(state, 'endDate', start.endDate),
    halfDay: valueOf(state, 'halfDay', String(start.halfDay)) === 'true',
    reason: valueOf(state, 'reason', start.reason),
    coverId: valueOf(state, 'coverId', start.coverId),
    note: valueOf(state, 'note'),
  }));
  const [loaded, setLoaded] = useState<YearData>(initial);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [checking, startChecking] = useTransition();
  const asked = useRef(initial.year);
  // the last day follows the first, unless it was changed by hand in this form (26 October 2026)
  const lastStart = useRef(parseDate(valueOf(state, 'startDate', start.startDate)) || '');
  const endByHand = useRef(false);
  const [endKey, setEndKey] = useState(0);

  const type = types.find((t) => t.id === typed.typeId) ?? null;
  const currentType = types.find((t) => t.id === request.type.id) ?? null;
  const wanted = requestYear(typed, today);
  const stale = wanted !== loaded.year;
  const preview = editPreview(typed, type, { workingDays: person.workingDays, holidays: loaded.holidays, balances: stale ? null : loaded.balances }, request, currentType);
  const changed = editChanged(typed, request);
  const saved = datesLine(typed, preview.days);
  // the balance this leaves, below 0 for a Super Admin's edit: allowed, after this warning (owner, 26 October 2026)
  const overNote = preview.after !== null && preview.after < 0 ? `This leaves the annual balance at −${daysNumber(-preview.after)}.` : null;
  const halfAllowed = !!type?.halfDays;
  const oneDay = (() => {
    const s = parseDate(typed.startDate);
    const end = typed.endDate.trim() === '' ? s : parseDate(typed.endDate);
    return !!s && s === end;
  })();

  /** The balances and holidays again, for the year of the first day typed. */
  function readFor(year: number) {
    if (year === asked.current) return;
    asked.current = year;
    setLoadProblem(null);
    startChecking(async () => {
      const answer = await leaveYearData(year, request.employee.id);
      if (asked.current !== year) return;
      if ('balances' in answer) setLoaded({ year, balances: answer.balances, holidays: answer.holidays });
      else setLoadProblem(`The balance of ${year} couldn't be checked: ${answer.errors.join(' ')} It is checked when you save.`);
    });
  }

  function set<K extends keyof TypedEdit>(key: K, value: TypedEdit[K]) {
    if (key === 'endDate') endByHand.current = true;
    if (key === 'startDate') {
      const moved = endFollowingStart(lastStart.current, value as string, typed.endDate, endByHand.current);
      setTyped((t) => ({ ...t, startDate: value as string, endDate: moved }));
      if (moved !== typed.endDate) setEndKey((k) => k + 1);
      const date = parseDate(value as string);
      if (date) {
        lastStart.current = date;
        readFor(Number(date.slice(0, 4)));
      }
      return;
    }
    setTyped((t) => ({ ...t, [key]: value }));
  }

  return (
    <form
      action={formAction}
      onChange={(e) => {
        // the dates typed, for the count (the fields stay uncontrolled)
        if (e.target instanceof HTMLInputElement && (e.target.name === 'startDate' || e.target.name === 'endDate')) set(e.target.name as 'startDate' | 'endDate', e.target.value);
      }}
      aria-label={`Edit the ${request.type.nameEn.toLowerCase()} of ${request.employee.fullNameEn}`}
      className="space-y-5"
    >
      <FormErrors errors={state.errors} />
      <SurfaceField />
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={fid('typeId')} className="label">
            Type of leave
          </label>
          <Select id={fid('typeId')} name="typeId" required value={typed.typeId} onChange={(e) => set('typeId', e.target.value)} className="input">
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nameEn}
                {t.active ? '' : ' (off)'}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor={fid('startDate')} className="label">
            First day
          </label>
          <DateInput id={fid('startDate')} name="startDate" required defaultValue={typed.startDate} />
        </div>
        <div>
          <label htmlFor={fid('endDate')} className="label">
            Last day {optional}
          </label>
          <DateInput key={endKey} id={fid('endDate')} name="endDate" defaultValue={typed.endDate} aria-describedby={fid('endDate-hint')} />
          <p id={fid('endDate-hint')} className="hint">
            Empty: one day, the first. It moves with the first day unless you set it.
          </p>
        </div>
        {halfAllowed && (
          <div className="sm:col-span-2">
            <label className={`${choice} w-fit ${oneDay ? '' : 'opacity-60'}`}>
              <input
                type="checkbox"
                checked={typed.halfDay}
                onChange={(e) => set('halfDay', e.target.checked)}
                disabled={!oneDay && !typed.halfDay}
                aria-describedby={fid('halfDay-hint')}
                className="size-4 accent-accent"
              />
              Half a day
            </label>
            <p id={fid('halfDay-hint')} className="hint">
              For one day only: make the first and last day the same.
            </p>
          </div>
        )}
        {/* sent as "true" or "false", whatever the type (a type without half days sends false) */}
        <input type="hidden" name="halfDay" value={String(typed.halfDay && halfAllowed)} />
        <div className="sm:col-span-2" role="status" aria-live="polite">
          <p className="rounded-lg bg-canvas px-4 py-3 text-sm font-semibold tabular-nums">{checking ? 'Checking the balance and the holidays…' : editPreviewText(preview)}</p>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={fid('reason')} className="label">
            Reason {optional}
          </label>
          <textarea id={fid('reason')} name="reason" rows={2} maxLength={REASON_MAX} value={typed.reason} onChange={(e) => set('reason', e.target.value)} className="input" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={fid('coverId')} className="label">
            Covered by {optional}
          </label>
          <Select id={fid('coverId')} name="coverId" value={typed.coverId} onChange={(e) => set('coverId', e.target.value)} aria-describedby={fid('coverId-hint')} className="input">
            <option value="">Nobody</option>
            {/* the one covering now, even if the list lacks them (no longer employed) */}
            {request.cover && !colleagues?.some((c) => c.id === request.cover?.id) && <option value={request.cover.id}>{request.cover.fullNameEn}</option>}
            {colleagues
              ?.filter((c) => c.id !== request.employee.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
          </Select>
          <p id={fid('coverId-hint')} className="hint">
            {colleagues ? 'Anyone employed now but the employee, not off on these days. Type to search. The new colleague is told, and the one before.' : 'The colleagues couldn’t be loaded: try again in a moment.'}
          </p>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={fid('note')} className="label">
            Why it’s edited {optional}
          </label>
          <input id={fid('note')} name="note" maxLength={EDIT_NOTE_MAX} autoComplete="off" value={typed.note} onChange={(e) => set('note', e.target.value)} aria-describedby={fid('note-hint')} className="input" />
          <p id={fid('note-hint')} className="hint">
            {editHint(request)}
          </p>
        </div>
      </div>
      {loadProblem && <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">{loadProblem}</p>}
      {overNote && <p role="status" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">{overNote} Only a Super Admin may.</p>}
      {saved && (
        <p role="status" aria-live="polite" className="text-sm font-semibold tabular-nums">
          Will be saved: {saved}
        </p>
      )}
      <button type="submit" disabled={saving || checking || !changed} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-60">
        {saving ? 'Saving…' : 'Save the edit'}
      </button>
    </form>
  );
}

// ---------- deciding a request ----------

/** Leave, or a permission request (19 October 2026), for the forms' words. */
// an attendance correction (owner, 19 October 2026: "Attendance corrections with approval") is decided and cancelled
// with the same forms
type RequestKindWord = 'leave' | 'permission' | 'correction';

/**
 * An approver's decision on a request waiting for them: Approve (a comment optional), or Reject with a comment. Rejecting
 * asks first. `confidential`: a C-level person's request, which goes on to the CEO, not HR, and HR doesn't read (19
 * October 2026). `kind`: a leave or a permission request.
 */
export function LeaveDecisionForm({
  action,
  stage,
  name,
  confidential = false,
  kind = 'leave',
}: {
  action: Action;
  stage: LeaveStage;
  name: string;
  confidential?: boolean;
  kind?: RequestKindWord;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const [decision, setDecision] = useState<LeaveDecision | ''>(() => {
    const kept = valueOf(state, 'decision');
    return (LEAVE_DECISIONS as readonly string[]).includes(kept) ? (kept as LeaveDecision) : '';
  });
  const [comment, setComment] = useState(() => valueOf(state, 'comment'));
  const needsComment = decision !== '' && leaveDecisionNeedsComment(decision);
  const ready = decision !== '' && (!needsComment || comment.trim() !== '');
  const button =
    kind === 'permission'
      ? permissionDecisionButton(decision, stage, confidential)
      : kind === 'correction'
        ? correctionDecisionButton(decision, stage, confidential)
        : leaveDecisionButton(decision, stage, confidential);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (decision === 'reject' && !window.confirm(`Reject the ${kind} request by ${name}? Your comment shows on it.`)) e.preventDefault();
      }}
      aria-label={`Decide on the ${kind} request by ${name}`}
      className="space-y-4"
    >
      <FormErrors errors={state.errors} />
      <SurfaceField />
      <fieldset>
        <legend className="label">Decision</legend>
        <div className="flex flex-wrap gap-2">
          {LEAVE_DECISIONS.map((d) => (
            <label key={d} className={choice}>
              <input type="radio" name="decision" value={d} checked={decision === d} onChange={() => setDecision(d)} className="size-4 accent-accent" />
              {LEAVE_DECISION_LABELS[d]}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor={fid('comment')} className="label">
          Comment {decision !== 'reject' && optional}
        </label>
        <textarea
          id={fid('comment')}
          name="comment"
          rows={3}
          maxLength={1000}
          required={needsComment}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          aria-describedby={fid('comment-hint')}
          className="input"
        />
        <p id={fid('comment-hint')} className="hint">
          {decision === 'reject' ? 'Why it is rejected. ' : ''}
          {leaveCommentReaders(confidential)}
        </p>
      </div>
      <button
        type="submit"
        disabled={pending || !ready}
        className={`btn ${decision === 'reject' ? 'btn-danger' : 'btn-primary'} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {pending ? button.busy : button.label}
      </button>
    </form>
  );
}

/** The employee's Cancel: asks first; the request stays on their list, cancelled, its days (a permission's hours) given back. */
export function CancelLeaveForm({ action, what, kind = 'leave' }: { action: () => Promise<FormState>; what: string; kind?: RequestKindWord }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`Cancel your ${what}? It stays on your list, cancelled; ask again with a new request.`)) e.preventDefault();
      }}
      className="space-y-3"
    >
      <FormErrors errors={state.errors} />
      <SurfaceField />
      <button type="submit" disabled={pending} className="btn btn-secondary">
        {pending ? 'Cancelling…' : `Cancel this ${kind}`}
      </button>
    </form>
  );
}

/** HR's Cancel of an approved request, with the comment the employee reads; its days go back to the balance (a permission's hours to the month). */
export function HrCancelLeaveForm({ action, what, kind = 'leave' }: { action: Action; what: string; kind?: RequestKindWord }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const [comment, setComment] = useState(() => valueOf(state, 'comment'));
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const back = kind === 'permission' ? 'Its hours go back to the month’s allowance' : 'Its days go back to the balance';
        if (!window.confirm(`Cancel the approved ${what}? ${back}; your comment shows on it.`)) e.preventDefault();
      }}
      className="space-y-3"
    >
      <FormErrors errors={state.errors} />
      <SurfaceField />
      <div>
        <label htmlFor={fid('comment')} className="label">
          Why it is cancelled
        </label>
        <textarea
          id={fid('comment')}
          name="comment"
          rows={2}
          maxLength={1000}
          required
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          aria-describedby={fid('comment-hint')}
          className="input"
        />
        <p id={fid('comment-hint')} className="hint">
          {kind === 'permission' ? 'E.g. the employee stayed at work after all, or it was recorded by mistake.' : 'E.g. the employee came back early, or it was recorded by mistake.'}{' '}
          {LEAVE_COMMENT_READERS}
        </p>
      </div>
      <button type="submit" disabled={pending || comment.trim() === ''} className="btn btn-danger">
        {pending ? 'Cancelling…' : `Cancel the ${kind}`}
      </button>
    </form>
  );
}

/**
 * A Super Admin undoes a cancellation (owner, 26 October 2026: "allow superadmin to undo cancellation and go through the
 * edit to prevent this mistake"): an optional why, and the warning before saving when restoring takes the annual balance
 * below 0 (`warning`, restoreWarning). The API checks it all again.
 */
export function RestoreLeaveForm({ action, what, warning }: { action: Action; what: string; warning: string | null }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`Restore the cancelled ${what}? It goes back to where it stood before it was cancelled.${warning ? ` ${warning}` : ''}`)) e.preventDefault();
      }}
      className="space-y-3"
    >
      <FormErrors errors={state.errors} />
      <SurfaceField />
      {warning && (
        <p role="status" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          {warning} Only a Super Admin may.
        </p>
      )}
      <div>
        <label htmlFor={fid('note')} className="label">
          Why {optional}
        </label>
        <textarea id={fid('note')} name="note" rows={2} maxLength={500} defaultValue={valueOf(state, 'note')} className="input" />
      </div>
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? 'Restoring…' : 'Restore the leave'}
      </button>
    </form>
  );
}

/**
 * The employee changes the colleague who covers their request, or the handover note (owner's brief, 25 October 2026: "if
 * the cover becomes unavailable, the requester can change the cover, which is audited"): those not off on its days, the
 * team first; none only where the leave doesn't need one. The API checks it again, tells the new colleague and the one
 * before, and logs it.
 */
export function ChangeCoverForm({
  action,
  cover,
  note,
  candidates,
  required,
  groupName,
}: {
  action: Action;
  cover: { id: string; fullNameEn: string } | null;
  note: string | null;
  /** Those who may cover its days now (null: they couldn't be read: only the note can change). */
  candidates: CoverCandidate[] | null;
  required: boolean;
  groupName: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const [open, setOpen] = useState(() => !!state.errors?.length);
  const [coverId, setCoverId] = useState(() => valueOf(state, 'coverId', cover?.id ?? ''));
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-secondary min-h-9 px-3">
        Change the cover
      </button>
    );
  }
  const list = candidates ?? [];
  const team = list.filter((c) => c.sameTeam);
  const others = list.filter((c) => !c.sameTeam);
  // the one covering now, even if the list no longer has them (off on some of the days since)
  const kept = cover && !list.some((c) => c.id === cover.id) ? cover : null;
  const option = (c: CoverCandidate) => (
    <option key={c.id} value={c.id}>
      {c.fullNameEn}
      {placeText(c) ? ` · ${placeText(c)}` : ''}
    </option>
  );
  return (
    <form action={formAction} aria-label="Change who covers this leave" className="space-y-4">
      <FormErrors errors={state.errors} />
      <SurfaceField />
      <div>
        <label htmlFor={fid('coverId')} className="label">
          Colleague who covers {!required && optional}
        </label>
        <Select id={fid('coverId')} name="coverId" required={required} value={coverId} onChange={(e) => setCoverId(e.target.value)} aria-describedby={fid('coverId-hint')} className="input">
          <option value="">{required ? 'Choose a colleague' : 'Nobody'}</option>
          {kept && <option value={kept.id}>{kept.fullNameEn} (off on some of these days now)</option>}
          {team.length > 0 && <optgroup label={groupName ?? 'Your team'}>{team.map(option)}</optgroup>}
          {others.length > 0 && <optgroup label={team.length ? 'Everyone else' : 'Colleagues'}>{others.map(option)}</optgroup>}
        </Select>
        <p id={fid('coverId-hint')} className="hint">
          {candidates ? 'Colleagues not off on these days. The new one is told, and the one before is told they no longer cover it.' : 'The colleagues couldn’t be loaded: try again in a moment.'}
        </p>
      </div>
      <div>
        <label htmlFor={fid('handoverNote')} className="label">
          Handover note {optional}
        </label>
        <textarea id={fid('handoverNote')} name="handoverNote" rows={2} maxLength={HANDOVER_NOTE_MAX} defaultValue={valueOf(state, 'handoverNote', note ?? '')} className="input" />
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending || (required && !coverId)} className="btn btn-primary min-h-9 px-3 disabled:cursor-not-allowed disabled:opacity-60">
          {pending ? 'Saving…' : 'Save the cover'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary min-h-9 px-3">
          Close
        </button>
      </div>
    </form>
  );
}

/** HR's adjustment of a year's annual balance: the days (+ or −, whole or half) and the reason, logged with it. */
export function AdjustBalanceForm({ action, year, name }: { action: Action; year: number; name: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="space-y-2">
        {state.message && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
        <button type="button" onClick={() => setOpen(true)} className="btn btn-secondary min-h-9 px-3">
          Adjust balance
        </button>
      </div>
    );
  }
  return (
    <form
      action={formAction}
      aria-label={`Adjust ${name}'s annual balance for ${year}`}
      className="space-y-3 rounded-lg border border-line bg-canvas p-4"
    >
      <FormErrors errors={state.errors} />
      {state.message && (
        <p role="status" className="text-sm text-ok">
          {state.message}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <div>
          <label htmlFor={fid('days')} className="label">
            Days
          </label>
          <input
            id={fid('days')}
            name="days"
            required
            inputMode="decimal"
            autoComplete="off"
            placeholder="e.g. 2 or -1.5"
            defaultValue={valueOf(state, 'days')}
            aria-describedby={fid('days-hint')}
            className="input tabular-nums"
          />
          <p id={fid('days-hint')} className="hint">
            Added to {year}&apos;s balance; a minus takes days off.
          </p>
        </div>
        <div>
          <label htmlFor={fid('reason')} className="label">
            Reason
          </label>
          <input id={fid('reason')} name="reason" required maxLength={500} autoComplete="off" defaultValue={valueOf(state, 'reason')} className="input" />
          <p className="hint">Kept with the adjustment, e.g. days worked on an official holiday given as leave (Art. 129).</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary min-h-9 px-3">
          {pending ? 'Saving…' : 'Save adjustment'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary min-h-9 px-3">
          Close
        </button>
      </div>
    </form>
  );
}
