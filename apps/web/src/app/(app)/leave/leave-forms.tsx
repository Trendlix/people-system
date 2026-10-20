'use client';

import Link from 'next/link';
import { startTransition, useActionState, useRef, useState, useTransition } from 'react';
import {
  LEAVE_DECISION_LABELS,
  LEAVE_DECISIONS,
  LEAVE_DOCUMENTS_MAX,
  leaveDecisionNeedsComment,
  leaveTypeRulesText,
  type LeaveDecision,
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
import type { FormState, Holiday, LeaveBalances, LeaveTypeView } from '@/lib/types';
import { choice } from '../employees/[id]/contracts/pay-fields';
import { shrinkPhoto } from '../employees/shrink-photo';
import { sizeText } from '../reimbursements/claim';
import { leaveYearData } from './actions';
import { daysNumber, daysText, hrStageName, LEAVE_COMMENT_READERS, leaveCommentReaders, leaveDecisionButton } from './list';
import { correctionDecisionButton } from '../attendance/corrections/corrections';
import { permissionDecisionButton } from './permissions';
import { balanceAfter, countLeaveDays, countText, DOCUMENT_ACCEPT, leaveFormProblems, REASON_MAX, requestYear, rulesOf, type TypedLeave } from './request';

// The forms of a leave request (owner, 18 October 2026: "can you apply the leaves according to the law?"): the new
// request, for an employee themself or recorded by HR on their behalf, with the type's rules in words beside it, its days
// counted live as the law counts them (the shift's working days less the official holidays, Art. 124; calendar days for
// a type counted so), the annual balance after it, and the shared checks shown live, Send staying off while any is left;
// an approver's decision on the request's page (Approve, or Reject with a comment); the employee's Cancel; HR's Cancel of
// an approved one, with a comment; and HR's adjustment of a balance. The API checks everything again. A permission
// request (owner, 19 October 2026: "In the system, like leave") is decided and cancelled with the same forms, worded for
// it (`kind`): its hours, not days, go back.

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
}: {
  action: Action;
  types: LeaveTypeView[];
  today: string;
  person: LeavePerson;
  initial: YearData;
  cancelHref: string;
  /** The employee is C-level (19 October 2026): after their manager it goes to the CEO, not HR. */
  toCeo?: boolean;
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
  const [documents, setDocuments] = useState<Chosen[]>([]);
  const [shrinking, setShrinking] = useState(false);

  const type = types.find((t) => t.id === typed.typeId) ?? null;
  const year = requestYear(typed, today);
  const stale = year !== loaded.year;
  const ctx = { workingDays: person.workingDays, holidays: loaded.holidays, balances: stale ? null : loaded.balances, joinDate: person.joinDate, gender: person.gender, today, byHr };
  const days = countLeaveDays(typed, type, ctx);
  const after = balanceAfter(type, ctx.balances, days);
  const problems = leaveFormProblems(
    typed,
    type,
    documents.map((d) => d.file),
    ctx,
  );
  if (checking || (stale && !loadProblem)) problems.push(`Checking the balance and the holidays of ${year}…`);
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

  function set<K extends keyof TypedLeave>(key: K, value: TypedLeave[K]) {
    setTyped((t) => ({ ...t, [key]: value }));
    if (key === 'startDate') {
      const date = parseDate(value as string);
      if (date) readFor(Number(date.slice(0, 4)));
    }
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
          <DateInput id={fid('endDate')} name="endDate" defaultValue={typed.endDate} aria-describedby={fid('endDate-hint')} />
          <p id={fid('endDate-hint')} className="hint">
            Empty: one day, the first.
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
            {byHr ? ` for ${person.name}, approved at once.` : `, to your direct manager (without one, your lead), then ${hrStageName(toCeo)}.`}
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
