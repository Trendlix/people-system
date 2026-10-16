'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  lawRatesFor,
  RAISE_REASON_LABELS,
  RAISE_WAY_HINTS,
  RAISE_WAY_LABELS,
  RAISE_WAYS,
  raiseEffectiveProblem,
  raiseReasonOptions,
  type LawRates,
  type RaiseReason,
  type RaiseRequester,
  type RaiseWay,
} from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import { formatDate, parseDate } from '@/lib/format';
import type { AllowanceType, FormState, Grade, GradeRef, JobTitleSummary } from '@/lib/types';
import { gradeLabel, gradeRangeSentence, inGradeRange } from '../../../organization/grades/label';
import { contractEnd } from './dates';
import { choice, PayFields, typedPayOf, usePay, type PayDefaults } from './pay-fields';
import { commentReaders } from '../../../raise-requests/list';
import { fromToText, insuredWageText, jobTitleGroups } from './raise';

// The form of the Raise and Edit raise pages (owner's decisions, 16 October 2026): a raise on the signed contract in
// force, one of two ways, HR choosing per case: an amendment (the new pay on the same contract from the effective date;
// its term and end stay, no probation, a salary amendment letter is printed to sign) or a new contract (its own term from
// the effective date, the whole contract printed, replacing the contract in force once signed). It takes effect on the
// 1st of a month, after the contract in force started and not after it ends (raiseEffectiveProblem, shown as HR types).
// Then the new pay (pay-fields.tsx, starting from the pay in force), why, a note, and a promotion if any (a new job title
// and grade, the grade within the job title's range), applied to the employment when the raise is signed. A summary
// shows the pay before and after, and what happens to the insured wage: it stays as before until the next January,
// unless Form 2 is filed. HR then sends it to the CEO with the contract on the Employment tab.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** What the form starts with: the raise being changed, or the defaults. Dates are YYYY-MM-DD. */
export type RaiseDefaults = {
  way: RaiseWay;
  effectiveDate: string;
  /** A new contract's length. */
  durationMonths: number;
  reason: RaiseReason | '';
  note: string;
  /** '' for no change. */
  newJobTitleId: string;
  newGradeId: string;
  /** Recorded once approved, kept while it is changed. */
  form2From: string | null;
  pay: PayDefaults;
};

const optional = <span className="font-normal text-muted">(optional)</span>;
const wayOf = (value: string): RaiseWay => (value === 'contract' ? 'contract' : 'amendment');

export function RaiseForm({
  action,
  defaults,
  current,
  allowanceTypes,
  fullTime,
  today,
  lawYears,
  promotion,
  request,
  approved = false,
  cancelHref,
  submitLabel,
}: {
  action: Action;
  defaults: RaiseDefaults;
  /** The signed contract in force the raise changes (its pay, as HR, Finance and the CEO see it). */
  current: { version: number; startDate: string; endDate: string | null; grossSalary: number | null; allowancesTotal: number | null };
  allowanceTypes: readonly AllowanceType[];
  fullTime: boolean;
  /** YYYY-MM-DD, for the salary's year while there is no effective date. */
  today: string;
  lawYears: readonly LawRates[];
  /** The job titles (each with its grades) and grades to choose from, and the employment's own as they are. */
  promotion: { jobTitles: readonly JobTitleSummary[]; grades: readonly Grade[]; jobTitle: { id: string; titleEn: string } | null; grade: GradeRef | null };
  /**
   * The raise request it is prepared from, sent along with a new raise: saving it is HR's approval of the request, with
   * HR's comment, and sends it to the CEO (owner, 17 October 2026). `requester`: who asked, to say who reads the comment.
   */
  request?: { id: string; requester?: RaiseRequester };
  /** Changing a raise the CEO approved: a change of its terms sends it back to HR, to send again. */
  approved?: boolean;
  cancelHref: string;
  submitLabel: string;
}) {
  // Kept form: a refused save leaves everything as typed and chosen.
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();

  // What is typed, for the previews (the fields themselves stay uncontrolled); the pay fields keep their own (usePay).
  const [typed, setTyped] = useState<Record<string, string>>(() => ({
    way: valueOf(state, 'way', defaults.way),
    effectiveDate: valueOf(state, 'effectiveDate', formatDate(defaults.effectiveDate)),
    durationMonths: valueOf(state, 'durationMonths', String(defaults.durationMonths)),
  }));
  // the promotion: the grades offered follow the job title chosen
  const [jobTitleId, setJobTitleId] = useState(() => valueOf(state, 'newJobTitleId', defaults.newJobTitleId));
  const [gradeId, setGradeId] = useState(() => valueOf(state, 'newGradeId', defaults.newGradeId));
  const [clearedGrade, setClearedGrade] = useState<{ grade: Grade; title: string } | null>(null);

  const way = wayOf(typed.way);
  const effective = parseDate(typed.effectiveDate);
  const problem =
    effective === null ? 'Enter the date it takes effect as DD/MM/YYYY, e.g. 01/12/2026.' : effective ? raiseEffectiveProblem(effective, current) : null;
  const starts = effective && !problem ? effective : null;
  const months = Number(typed.durationMonths);
  const end = way === 'contract' && starts && Number.isInteger(months) && months >= 1 ? contractEnd(starts, months) : null;
  // the salary, with the rates set by law of the year the raise takes effect (this year while there is no date)
  const year = Number((starts ?? today).slice(0, 4));
  const pay = usePay(state, defaults.pay, allowanceTypes, lawRatesFor(year, lawYears));

  // the pay before and after
  const next = typedPayOf(pay);
  const nextAllowances = next ? next.allowances.reduce((sum, a) => sum + a.amount, 0) : null;
  const nowAllowances = current.allowancesTotal ?? 0;
  const anyAllowances = nowAllowances > 0 || (nextAllowances ?? 0) > 0;
  const total = (gross: number | null, allowances: number | null) => (gross === null || allowances === null ? null : Math.round((gross + allowances) * 100) / 100);

  // the promotion: a job title or grade the same as now is no change, so they aren't offered
  const titleInEffect = promotion.jobTitles.find((j) => j.id === (jobTitleId || promotion.jobTitle?.id));
  const gradeInEffect = promotion.grades.find((g) => g.id === (gradeId || promotion.grade?.id)) ?? (gradeId ? undefined : promotion.grade);
  const allowed = (g: { rank: number }) => !titleInEffect || inGradeRange(g, titleInEffect);
  const titles = jobTitleGroups(promotion.jobTitles.filter((j) => j.id !== promotion.jobTitle?.id));
  const grades = promotion.grades.filter((g) => g.id !== promotion.grade?.id && (allowed(g) || g.id === gradeId));
  const range = titleInEffect && gradeRangeSentence(titleInEffect.titleEn, titleInEffect);
  // checked only with a promotion, as the API does: a grade set before a job title's range was narrowed can stay
  const outOfRange = (jobTitleId || gradeId) && gradeInEffect && !allowed(gradeInEffect) ? `${range} Choose a new grade in that range.` : null;

  function track(e: React.FormEvent<HTMLFormElement>) {
    const t = e.target;
    if (!((t instanceof HTMLInputElement || t instanceof HTMLSelectElement) && t.name)) return;
    const { name, value } = t;
    // the allowance rows report their changes through onChange; the promotion's pickers keep their own
    if (name === 'allowanceTypeId' || name === 'allowanceAmount' || name === 'newJobTitleId' || name === 'newGradeId') return;
    if (pay.track(name, value)) return;
    setTyped((v) => ({ ...v, [name]: value }));
  }

  /** A grade the newly chosen job title doesn't take is cleared, and the form says so. */
  function pickJobTitle(id: string) {
    setJobTitleId(id);
    const title = promotion.jobTitles.find((j) => j.id === (id || promotion.jobTitle?.id));
    const chosen = promotion.grades.find((g) => g.id === gradeId);
    if (title && chosen && !inGradeRange(chosen, title)) {
      setGradeId('');
      setClearedGrade({ grade: chosen, title: title.titleEn });
    } else {
      setClearedGrade(null);
    }
  }

  return (
    <form {...form} onChange={track} className="card max-w-3xl space-y-6 p-6">
      <FormErrors errors={state.errors} />
      {approved && (
        <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          The CEO approved this raise. Changing its terms sends it back to HR as a draft, to send to the CEO again; changing the note alone keeps the
          approval.
        </p>
      )}
      {request && <input type="hidden" name="requestId" value={request.id} />}

      <fieldset aria-describedby={fid('way-hint')}>
        <legend className="label">How the raise is made</legend>
        <div className="flex flex-wrap gap-2">
          {RAISE_WAYS.map((w) => (
            <label key={w} className={choice}>
              <input type="radio" name="way" value={w} defaultChecked={way === w} className="size-4 accent-accent" />
              {RAISE_WAY_LABELS[w]}
            </label>
          ))}
        </div>
        <p id={fid('way-hint')} className="hint">
          {RAISE_WAY_HINTS[way]}
        </p>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('effectiveDate')} className="label">
            Takes effect on
          </label>
          <DateInput
            id={fid('effectiveDate')}
            name="effectiveDate"
            required
            aria-describedby={`${fid('effectiveDate-hint')}${problem ? ` ${fid('effectiveDate-problem')}` : ''}`}
            defaultValue={typed.effectiveDate}
          />
          <p id={fid('effectiveDate-hint')} className="hint">
            The 1st of a month, after {formatDate(current.startDate)}, when version {current.version} started
            {current.endDate ? `, and up to its end on ${formatDate(current.endDate)}` : ''}: each payroll month has one salary.
          </p>
          <div role="status">
            {problem && (
              <p id={fid('effectiveDate-problem')} className="hint text-warn">
                {problem}
              </p>
            )}
          </div>
        </div>

        {way === 'contract' ? (
          <div key="durationMonths">
            <label htmlFor={fid('durationMonths')} className="label">
              Length in months
            </label>
            <input
              id={fid('durationMonths')}
              name="durationMonths"
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              step={1}
              required
              aria-describedby={fid('durationMonths-hint')}
              defaultValue={typed.durationMonths}
              className="input tabular-nums"
            />
            <p id={fid('durationMonths-hint')} className="hint">
              {end ? `Ends on ${formatDate(end)}. ` : ''}A new contract has its own fixed term from the date it takes effect, without probation, and replaces
              version {current.version} once signed.
            </p>
          </div>
        ) : (
          <div key="endDate">
            <label htmlFor={fid('endDate')} className="label">
              Contract ends on
            </label>
            {/* not sent: an amendment keeps the contract's term */}
            <input
              id={fid('endDate')}
              value={current.endDate ? formatDate(current.endDate) : 'No end date'}
              readOnly
              aria-describedby={fid('endDate-hint')}
              className="input bg-canvas text-muted"
            />
            <p id={fid('endDate-hint')} className="hint">
              An amendment keeps the contract&apos;s term and end, without probation; it is renewed as before.
            </p>
          </div>
        )}
      </div>

      <PayFields pay={pay} state={state} fid={fid} allowanceTypes={allowanceTypes} fullTime={fullTime} year={year} yearIs="the year the raise takes effect" />

      <div className="space-y-2 rounded-lg border border-line bg-canvas px-4 py-3">
        <p id={fid('summary')} className="label">
          From → to, a month
        </p>
        <dl aria-labelledby={fid('summary')} className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">Gross</dt>
          <dd className="tabular-nums">{fromToText(current.grossSalary, next?.grossSalary ?? null) ?? 'Enter the new pay to see the change.'}</dd>
          {anyAllowances && (
            <>
              <dt className="text-muted">Allowances</dt>
              <dd className="tabular-nums">{fromToText(nowAllowances, nextAllowances) ?? '—'}</dd>
              <dt className="text-muted">Gross and allowances</dt>
              <dd className="tabular-nums">{fromToText(total(current.grossSalary, nowAllowances), total(next?.grossSalary ?? null, nextAllowances)) ?? '—'}</dd>
            </>
          )}
        </dl>
        <p className="hint">
          {starts
            ? `${insuredWageText(starts, defaults.form2From)} The salary tax follows the new pay from ${formatDate(starts)}.`
            : 'Insured wage stays as before until the next January unless Form 2 is filed; the salary tax follows the new pay at once.'}
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('reason')} className="label">
            Why the pay changes
          </label>
          <Select
            id={fid('reason')}
            name="reason"
            required
            aria-describedby={fid('reason-hint')}
            defaultValue={valueOf(state, 'reason', defaults.reason)}
            className="input"
          >
            <option value="">Choose a reason</option>
            {raiseReasonOptions(defaults.reason).map((r) => (
              <option key={r} value={r}>
                {RAISE_REASON_LABELS[r]}
              </option>
            ))}
          </Select>
          <p id={fid('reason-hint')} className="hint">
            The CEO sees it with the raise.
          </p>
        </div>
      </div>

      <fieldset className="space-y-3" aria-describedby={fid('promotion-hint')}>
        <legend className="label">Promotion {optional}</legend>
        <p id={fid('promotion-hint')} className="hint">
          A new job title or grade with the raise, applied to the employment when the raise is signed; the department follows the job title.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor={fid('newJobTitleId')} className="label">
              New job title
            </label>
            <Select id={fid('newJobTitleId')} name="newJobTitleId" value={jobTitleId} onChange={(e) => pickJobTitle(e.target.value)} className="input">
              <option value="">No change ({promotion.jobTitle?.titleEn ?? 'no job title'})</option>
              {titles.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor={fid('newGradeId')} className="label">
              New grade
            </label>
            <Select
              id={fid('newGradeId')}
              name="newGradeId"
              value={gradeId}
              onChange={(e) => {
                setGradeId(e.target.value);
                setClearedGrade(null);
              }}
              ref={(el) => el?.setCustomValidity(outOfRange ?? '')}
              aria-describedby={range || outOfRange ? fid('newGradeId-hint') : undefined}
              aria-invalid={outOfRange ? true : undefined}
              className="input"
            >
              <option value="">No change ({promotion.grade ? gradeLabel(promotion.grade) : 'no grade'})</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {gradeLabel(g)}
                </option>
              ))}
            </Select>
            {(range || outOfRange) && (
              <p id={fid('newGradeId-hint')} className={`hint ${outOfRange ? 'text-warn' : ''}`}>
                {outOfRange ?? range}
              </p>
            )}
            <div role="status">
              {clearedGrade && (
                <p className="hint text-warn">
                  {gradeLabel(clearedGrade.grade)} was cleared: {clearedGrade.title} doesn&apos;t take it. Choose a grade again.
                </p>
              )}
            </div>
          </div>
        </div>
      </fieldset>

      <div>
        <label htmlFor={fid('note')} className="label">
          Note {optional}
        </label>
        <textarea
          id={fid('note')}
          name="note"
          rows={3}
          maxLength={500}
          aria-describedby={fid('note-hint')}
          defaultValue={valueOf(state, 'note', defaults.note)}
          className="input"
        />
        <p id={fid('note-hint')} className="hint">
          E.g. the review it follows. The CEO sees it with the raise. Up to 500 characters.
        </p>
      </div>

      {request && (
        <div>
          <label htmlFor={fid('comment')} className="label">
            Your comment on the request
          </label>
          <textarea
            id={fid('comment')}
            name="comment"
            rows={3}
            required
            maxLength={1000}
            aria-describedby={fid('comment-hint')}
            defaultValue={valueOf(state, 'comment')}
            className="input"
          />
          <p id={fid('comment-hint')} className="hint">
            Saving approves the request, as suggested when the gross is the one suggested, else with another raise, and sends the raise to the CEO.{' '}
            {commentReaders('decision', request.requester ?? 'self')}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton busy={pending}>{submitLabel}</SubmitButton>
        <Link href={cancelHref} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
