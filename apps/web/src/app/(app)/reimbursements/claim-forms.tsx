'use client';

import Link from 'next/link';
import { startTransition, useActionState, useRef, useState, useTransition } from 'react';
import {
  decisionNeedsComment,
  lowerAmountProblem,
  REIMBURSEMENT_DECISION_LABELS,
  REIMBURSEMENT_DECISIONS,
  REIMBURSEMENT_RECEIPTS_MAX,
  reimbursementRulesText,
  type ReimbursementDecision,
  type ReimbursementStage,
} from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { DocumentViewer } from '@/components/document-viewer';
import { fits } from '@/components/file-drop';
import { FormErrors, useFieldIds, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import { SurfaceField, useAppSection } from '@/components/surface';
import { CameraButton } from '@/components/camera-button';
import { formatDate, parseDate, titleCase } from '@/lib/format';
import type { FormState, MyReimbursementType } from '@/lib/types';
import { choice } from '../employees/[id]/contracts/pay-fields';
import { formatEgp } from '../employees/[id]/contracts/salary';
import { shrinkPhoto } from '../employees/shrink-photo';
import { monthName } from '../payroll/list';
import { typesForDate } from './actions';
import { capsMonth, claimProblems, DESCRIPTION_MAX, leftText, RECEIPT_ACCEPT, sizeText } from './claim';
import { amountTyped, commentReaders, decisionButton } from './list';

// The forms of a reimbursement claim (owner, 18 October 2026: "allow the employee to add reimbursement request … for
// specific preset up conditions"): the new claim, with the type's conditions and what is left of its caps beside it
// ("in the setup i need to enter for it a cap") and the shared checks shown live, Send claim staying off while any is
// left; an approver's decision on the claim's page (Approve, Approve a lower amount, Reject, a comment required for the
// last two); and the employee's Cancel while it is being decided. The API checks everything again.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const optional = <span className="font-normal text-muted">(optional)</span>;

// ---------- the receipts ----------

/** A receipt chosen, with a key of its own for the list (two files may have the same name). */
interface Chosen {
  key: number;
  file: File;
}

/**
 * The receipts, photos or PDFs, up to REIMBURSEMENT_RECEIPTS_MAX: chosen (several at once), dragged in or pasted, each
 * shown with its size, a View button (the document viewer, on the file itself) and Remove. Photos are made smaller
 * first (shrink-photo.ts): all of them go in one upload, which Vercel limits. The files are kept here, not on the file
 * box, and added to what the form sends (`receipts`). `busy`: while photos are being made smaller.
 */
function ReceiptsField({
  fid,
  receipts,
  onChange,
  onBusy,
  required,
}: {
  fid: (name: string) => string;
  receipts: Chosen[];
  onChange: (next: (list: Chosen[]) => Chosen[]) => void;
  onBusy: (busy: boolean) => void;
  required: boolean;
}) {
  const box = useRef<HTMLInputElement>(null);
  const next = useRef(1);
  const [over, setOver] = useState(false);
  const [refused, setRefused] = useState<string[]>([]);
  // on the phone pages (owner, 20 October 2026: the employee app, "reimbursement with a receipt photo"): Take a photo too
  const onPhonePages = useAppSection() !== null;

  async function add(files: readonly File[]) {
    const taken = files.filter((f) => fits(f, RECEIPT_ACCEPT));
    setRefused(files.filter((f) => !fits(f, RECEIPT_ACCEPT)).map((f) => f.name || 'A file'));
    if (!taken.length) return;
    onBusy(true);
    try {
      const smaller = await Promise.all(taken.map((f) => shrinkPhoto(f)));
      onChange((list) => [...list, ...smaller.map((file) => ({ key: next.current++, file }))]);
    } finally {
      onBusy(false);
      // the box is emptied, so the same file can be chosen again after it was removed
      if (box.current) box.current.value = '';
    }
  }

  const left = REIMBURSEMENT_RECEIPTS_MAX - receipts.length;
  return (
    <fieldset aria-describedby={fid('receipts-hint')}>
      <legend className="label">Receipts {required ? <span className="font-normal text-muted">(required for this type)</span> : optional}</legend>
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
        className={`space-y-2 rounded-lg border border-dashed p-3 outline-none focus:border-accent ${over ? 'border-accent bg-accent-soft' : 'border-line bg-card'}`}
      >
        <label htmlFor={fid('receipts')} className="sr-only">
          Add receipts
        </label>
        <input
          ref={box}
          id={fid('receipts')}
          type="file"
          multiple
          accept={RECEIPT_ACCEPT}
          onChange={(e) => void add(Array.from(e.currentTarget.files ?? []))}
          className="block w-full text-sm file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border file:border-line file:bg-card file:px-4 file:text-sm file:font-semibold"
        />
        {onPhonePages && <CameraButton onFiles={(files) => void add(files)} disabled={left <= 0} label="Take a photo of the receipt" />}
        <p aria-live="polite" className={`text-xs ${refused.length ? 'text-danger' : 'text-muted'}`}>
          {refused.length
            ? `${refused.join(', ')} ${refused.length === 1 ? 'was' : 'were'} not added: a receipt is a photo (JPG, PNG or WebP) or a PDF.`
            : over
              ? 'Drop the files here to add them.'
              : left > 0
                ? `Choose, drag or paste photos or PDFs; ${left === REIMBURSEMENT_RECEIPTS_MAX ? `up to ${left}` : `${left} more`}.`
                : `That is ${REIMBURSEMENT_RECEIPTS_MAX}, the most a claim takes.`}
        </p>
      </div>
      <p id={fid('receipts-hint')} className="hint">
        A clear photo of each receipt or invoice, or a PDF. On a phone you can take the photo here. Photos are made smaller before they are sent.
      </p>
      {receipts.length > 0 && (
        <ul className="mt-2 divide-y divide-line-soft rounded-lg border border-line bg-card" aria-label="Receipts added">
          {receipts.map(({ key, file }, i) => (
            <li key={key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="min-w-0 break-all">
                {file.name || `Receipt ${i + 1}`} <span className="text-muted tabular-nums">· {sizeText(file.size)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <DocumentViewer title={`Receipt ${i + 1} · ${file.name}`} files={[{ alt: file.name || `Receipt ${i + 1}`, src: file }]}>
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

/**
 * The type's conditions and what is left of its caps for the expense's month and year (`month`, "YYYY-MM"): each cap,
 * what the employee's claims already take of it, and the most that can be claimed now.
 */
function TypePanel({ type, month, checking }: { type: MyReimbursementType; month: string; checking: boolean }) {
  const left = leftText(type, month);
  return (
    <section aria-label={`What ${type.nameEn} allows`} className="space-y-3 rounded-lg border border-line bg-canvas p-4">
      <div>
        <h3 className="text-sm font-semibold">
          {titleCase(type.nameEn)}{' '}
          <span lang="ar" dir="rtl" className="inline-block font-normal text-muted">
            {type.nameAr}
          </span>
        </h3>
        {type.description && <p className="mt-0.5 text-sm whitespace-pre-line text-muted">{type.description}</p>}
        <p className="mt-1 text-sm">{reimbursementRulesText(type)}</p>
      </div>
      <div role="status" aria-live="polite">
        {checking ? (
          <p className="text-sm text-muted">Checking what is left for {monthName(month)}…</p>
        ) : left.rows.length ? (
          <dl className="grid gap-3 sm:grid-cols-3">
            {left.rows.map((r) => (
              <div key={r.label}>
                <dt className="text-xs text-muted">{r.label}</dt>
                <dd className="text-base font-semibold tabular-nums">{r.value}</dd>
                {r.note && <dd className="text-xs text-muted tabular-nums">{r.note}</dd>}
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted">No cap: any amount spent can be claimed.</p>
        )}
        {!checking && left.most !== null && (
          <p className="mt-3 text-sm font-medium">
            You can claim up to <span className="tabular-nums">{left.most}</span> now.
          </p>
        )}
      </div>
    </section>
  );
}

/** What the types were read for: the month whose use of the caps they carry ("YYYY-MM"). */
interface TypesFor {
  month: string;
  types: MyReimbursementType[];
}

/**
 * A new claim (POST /me/reimbursements): the type, among those the employee may claim (`types`, read for `today`'s
 * month), with its conditions and what is left; the expense's date, today to start with; the amount spent; what it was
 * for; and the receipts. The checks show live and Send claim stays off while any is left. A date in another month reads
 * the types again, for what is left in that month and year. Once sent, the claim's page opens; a refusal shows here,
 * with what was typed (the receipts too: they stay in the page).
 */
export function NewClaimForm({ action, types, today, cancelHref }: { action: Action; types: MyReimbursementType[]; today: string; cancelHref: string }) {
  const [state, formAction, sending] = useActionState(action, {});
  const fid = useFieldIds();
  const [typed, setTyped] = useState(() => ({
    typeId: valueOf(state, 'typeId', types.length === 1 ? types[0].id : ''),
    expenseDate: valueOf(state, 'expenseDate', formatDate(today)),
    amount: valueOf(state, 'amount'),
    description: valueOf(state, 'description'),
  }));
  const [loaded, setLoaded] = useState<TypesFor>({ month: capsMonth(today), types });
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [checking, startChecking] = useTransition();
  const asked = useRef(capsMonth(today));
  const [receipts, setReceipts] = useState<Chosen[]>([]);
  const [shrinking, setShrinking] = useState(false);

  const expenseDate = parseDate(typed.expenseDate) || null;
  // the month the checks are for: the expense's (once it is a date, and not after today), else the one read
  const month = expenseDate && expenseDate <= today ? capsMonth(expenseDate) : loaded.month;
  const type = loaded.types.find((t) => t.id === typed.typeId) ?? null;
  const stale = month !== loaded.month;
  // what is left is shown for the month read: the expense's once it is read, the one before while it couldn't be
  const shownMonth = stale && loadProblem ? loaded.month : month;
  const problems = claimProblems(
    typed,
    type,
    receipts.map((r) => r.file),
    today,
  );
  if (checking || (stale && !loadProblem)) problems.push(`Checking what is left of the caps for ${monthName(month)}…`);
  const blocked = problems.length > 0 || shrinking || sending;

  /** The types again, for the month of the date typed: what the employee's claims take of the caps there. */
  function readFor(date: string) {
    const wanted = capsMonth(date);
    if (wanted === asked.current) return;
    asked.current = wanted;
    setLoadProblem(null);
    startChecking(async () => {
      const answer = await typesForDate(date);
      // another date was typed meanwhile: its answer is the one that counts
      if (asked.current !== wanted) return;
      if ('types' in answer) setLoaded({ month: wanted, types: answer.types });
      else setLoadProblem(`What is left for ${monthName(wanted)} couldn't be checked: ${answer.errors.join(' ')} The amount is checked again when you send it.`);
    });
  }

  function set(key: keyof typeof typed, value: string) {
    setTyped((t) => ({ ...t, [key]: value }));
    if (key === 'expenseDate') {
      const date = parseDate(value);
      if (date && date <= today) readFor(date);
    }
  }

  function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (blocked) return;
    const fd = new FormData(e.currentTarget);
    fd.delete('receipts');
    for (const { file } of receipts) fd.append('receipts', file, file.name);
    startTransition(() => formAction(fd));
  }

  return (
    <form
      onSubmit={send}
      onChange={(e) => {
        // the date typed, for the checks (the field stays uncontrolled)
        if (e.target instanceof HTMLInputElement && e.target.name === 'expenseDate') set('expenseDate', e.target.value);
      }}
      aria-label="New reimbursement claim"
      className="card space-y-5 p-5"
    >
      <FormErrors errors={state.errors} />
      <SurfaceField />
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={fid('typeId')} className="label">
            Type of expense
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
            {loaded.types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nameEn}
              </option>
            ))}
          </Select>
          <p id={fid('typeId-hint')} className="hint">
            The types HR set up that you may claim, each with its own conditions.
          </p>
        </div>
        {type && (
          <div className="sm:col-span-2">
            <TypePanel type={type} month={shownMonth} checking={checking || (stale && !loadProblem)} />
          </div>
        )}
        <div>
          <label htmlFor={fid('expenseDate')} className="label">
            Date of the expense
          </label>
          <DateInput id={fid('expenseDate')} name="expenseDate" required defaultValue={typed.expenseDate} aria-describedby={fid('expenseDate-hint')} />
          <p id={fid('expenseDate-hint')} className="hint">
            The day on the receipt; not after today.{type?.claimWithinDays ? ` This type is claimed within ${type.claimWithinDays} days of it.` : ''}
          </p>
        </div>
        <div>
          <label htmlFor={fid('amount')} className="label">
            Amount spent (EGP)
          </label>
          <input
            id={fid('amount')}
            name="amount"
            required
            inputMode="decimal"
            autoComplete="off"
            value={typed.amount}
            onChange={(e) => set('amount', e.target.value)}
            aria-describedby={fid('amount-hint')}
            className="input tabular-nums"
          />
          <p id={fid('amount-hint')} className="hint">
            As on the receipt, e.g. 250 or 250.50.
          </p>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={fid('description')} className="label">
            What it was for
          </label>
          <textarea
            id={fid('description')}
            name="description"
            rows={3}
            required
            maxLength={DESCRIPTION_MAX}
            value={typed.description}
            onChange={(e) => set('description', e.target.value)}
            aria-describedby={fid('description-hint')}
            className="input"
          />
          <p id={fid('description-hint')} className="hint">
            E.g. a taxi to the client&apos;s office for the launch meeting. Your direct manager, HR and Finance read it. Up to {DESCRIPTION_MAX}{' '}
            characters.
          </p>
        </div>
        <div className="sm:col-span-2">
          <ReceiptsField fid={fid} receipts={receipts} onChange={setReceipts} onBusy={setShrinking} required={!!type?.receiptRequired} />
        </div>
      </div>

      {loadProblem && <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">{loadProblem}</p>}
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
            Ready to send: {formatEgp(amountTyped(typed.amount) ?? 0)} for {type?.nameEn}, with {receipts.length === 1 ? 'one receipt' : `${receipts.length} receipts`}.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={blocked} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-60">
          {sending ? 'Sending…' : shrinking ? 'Preparing the photos…' : 'Send claim'}
        </button>
        <Link href={cancelHref} className={`btn btn-secondary ${sending ? 'pointer-events-none opacity-60' : ''}`} aria-disabled={sending || undefined}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

// ---------- deciding a claim ----------

/**
 * An approver's decision on a claim waiting for them: Approve (a comment optional), Approve a lower amount (less than
 * `current`, the amount it is decided on: the claim's, or an earlier approver's), or Reject, each of the last two with
 * a comment saying why. The lower amount is checked as it is typed (lowerAmountProblem). Rejecting asks first. Once
 * decided, the page says so; a refusal shows here.
 */
export function DecisionForm({
  action,
  stage,
  current,
  name,
  confidential = false,
}: {
  action: Action;
  stage: ReimbursementStage;
  current: number;
  name: string;
  /** A C-level person's claim (19 October 2026): it goes on to the CEO, not HR or Finance, who don't read the comment. */
  confidential?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const [decision, setDecision] = useState<ReimbursementDecision | ''>(() => {
    const kept = valueOf(state, 'decision');
    return (REIMBURSEMENT_DECISIONS as readonly string[]).includes(kept) ? (kept as ReimbursementDecision) : '';
  });
  const [amount, setAmount] = useState(() => valueOf(state, 'amount'));
  const [comment, setComment] = useState(() => valueOf(state, 'comment'));
  const lower = decision === 'approve_other';
  const amountProblem = lower && amount.trim() ? lowerAmountProblem(amountTyped(amount) ?? NaN, current) : null;
  const needsComment = decision !== '' && decisionNeedsComment(decision);
  const ready = decision !== '' && (!lower || (amount.trim() !== '' && !amountProblem)) && (!needsComment || comment.trim() !== '');
  const button = decisionButton(decision, stage, confidential);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (decision === 'reject' && !window.confirm(`Reject the claim by ${name}? Your comment shows on it.`)) e.preventDefault();
      }}
      aria-label={`Decide on the claim by ${name}`}
      className="space-y-4"
    >
      <FormErrors errors={state.errors} />
      <SurfaceField />
      <fieldset>
        <legend className="label">Decision</legend>
        <div className="space-y-2">
          {REIMBURSEMENT_DECISIONS.map((d) => (
            <label key={d} className={`${choice} w-full`}>
              <input type="radio" name="decision" value={d} checked={decision === d} onChange={() => setDecision(d)} className="size-4 accent-accent" />
              <span>
                {REIMBURSEMENT_DECISION_LABELS[d]}
                {d === 'approve' && <span className="block text-xs text-muted tabular-nums">{formatEgp(current)}</span>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {lower && (
        <div>
          <label htmlFor={fid('amount')} className="label">
            Amount approved (EGP)
          </label>
          <input
            id={fid('amount')}
            name="amount"
            required
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-describedby={`${fid('amount-hint')}${amountProblem ? ` ${fid('amount-problem')}` : ''}`}
            className="input max-w-48 tabular-nums"
          />
          <p id={fid('amount-hint')} className="hint">
            Less than {formatEgp(current)}, e.g. what the type&apos;s conditions or the receipt allow. Say why in the comment.
          </p>
          <div role="status">
            {amountProblem && (
              <p id={fid('amount-problem')} className="hint text-warn">
                {amountProblem}
              </p>
            )}
          </div>
        </div>
      )}

      <div>
        <label htmlFor={fid('comment')} className="label">
          Comment {decision === 'approve' && optional}
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
          {decision === 'reject' ? 'Why it is rejected. ' : lower ? 'Why a lower amount is approved. ' : ''}
          {commentReaders(confidential)}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={pending || !ready}
          className={`btn ${decision === 'reject' ? 'btn-danger' : 'btn-primary'} disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {pending ? button.busy : button.label}
        </button>
      </div>
    </form>
  );
}

/** The employee's Cancel, while the claim is being decided: asks first; the claim stays on their list, cancelled. */
export function CancelClaimForm({ action, what }: { action: () => Promise<FormState>; what: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`Cancel your ${what}? It stays on your list, cancelled; send a new claim to ask again.`)) e.preventDefault();
      }}
      className="space-y-3"
    >
      <FormErrors errors={state.errors} />
      <SurfaceField />
      <button type="submit" disabled={pending} className="btn btn-secondary">
        {pending ? 'Cancelling…' : 'Cancel this claim'}
      </button>
    </form>
  );
}
