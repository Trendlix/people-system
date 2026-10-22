'use client';

import { startTransition, useActionState } from 'react';
import { APPLY_CONSENT_TEXT, RECRUITMENT_LIMITS, type PublicQuestion } from '@trendlix/shared';
import { FormErrors, useFieldIds } from '@/components/form';
import { Select } from '@/components/select';
import { answerField, HONEYPOT } from '../careers';
import type { ApplyState } from './actions';

// The application form of a job on the careers page (owner, 22 October 2026: "where will we include the ATS?"): the
// applicant's details, the job's screening questions, the CV (a PDF or a Word file, at most 5 MB) and the consent;
// once sent, the reference to keep. A field hidden from people catches robots. Made for a phone first.

type Action = (prev: ApplyState, fd: FormData) => Promise<ApplyState>;

const L = RECRUITMENT_LIMITS;
const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

export function ApplyForm({ action, questions, title }: { action: Action; questions: PublicQuestion[]; title: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const v = (name: string) => state.values?.[name] ?? '';

  if (state.reference !== undefined) {
    return (
      <section className="card space-y-3 p-6 sm:p-8" aria-live="polite">
        <h2 className="text-xl font-semibold">Thank You for Applying</h2>
        <p className="text-sm leading-relaxed">
          We received your application for {title}
          {state.reference ? (
            <>
              . Its reference is <span className="font-semibold">{state.reference}</span>
            </>
          ) : null}
          . We read every application, and we will contact you if yours fits what we are looking for.
        </p>
      </section>
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="card space-y-5 p-6 sm:p-8" aria-labelledby={fid('heading')}>
      <h2 id={fid('heading')} className="text-xl font-semibold">
        Apply for This Job
      </h2>
      <FormErrors errors={state.errors} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={fid('fullName')} className="label">
            Full name
          </label>
          <input id={fid('fullName')} name="fullName" required maxLength={L.name} autoComplete="name" defaultValue={v('fullName')} className="input" />
        </div>
        <div>
          <label htmlFor={fid('email')} className="label">
            Email
          </label>
          <input id={fid('email')} name="email" type="email" required maxLength={L.email} autoComplete="email" defaultValue={v('email')} className="input" />
        </div>
        <div>
          <label htmlFor={fid('mobile')} className="label">
            Mobile
          </label>
          <input id={fid('mobile')} name="mobile" type="tel" required maxLength={L.mobile} autoComplete="tel" placeholder="+20 100 123 4567" defaultValue={v('mobile')} className="input" />
        </div>
        <div>
          <label htmlFor={fid('linkedin')} className="label">
            LinkedIn <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id={fid('linkedin')} name="linkedin" type="url" maxLength={L.link} placeholder="https://linkedin.com/in/…" defaultValue={v('linkedin')} className="input" />
        </div>
        <div>
          <label htmlFor={fid('portfolio')} className="label">
            Portfolio <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id={fid('portfolio')} name="portfolio" type="url" maxLength={L.link} placeholder="https://…" defaultValue={v('portfolio')} className="input" />
        </div>
        <div>
          <label htmlFor={fid('yearsExperience')} className="label">
            Years of experience
          </label>
          <input id={fid('yearsExperience')} name="yearsExperience" inputMode="decimal" maxLength={4} defaultValue={v('yearsExperience')} className="input" />
        </div>
        <div>
          <label htmlFor={fid('noticePeriod')} className="label">
            Notice period <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id={fid('noticePeriod')} name="noticePeriod" maxLength={L.notice} placeholder="e.g. 1 month" defaultValue={v('noticePeriod')} className="input" />
        </div>
        <div>
          <label htmlFor={fid('expectedSalary')} className="label">
            Expected salary, EGP a month <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id={fid('expectedSalary')} name="expectedSalary" inputMode="numeric" maxLength={12} defaultValue={v('expectedSalary')} className="input" />
        </div>
      </div>

      {questions.length > 0 && (
        <fieldset className="space-y-4 border-t border-line pt-5">
          <legend className="sr-only">Questions</legend>
          {questions.map((q) => {
            const id = fid(answerField(q.key));
            const name = answerField(q.key);
            const label = (
              <>
                {q.text}
                {!q.required && <span className="font-normal text-muted"> (optional)</span>}
              </>
            );
            if (q.kind === 'yes_no' || q.kind === 'choice') {
              const options = q.kind === 'yes_no' ? YES_NO : (q.options ?? []).map((o) => ({ value: o, label: o }));
              return (
                <div key={q.key}>
                  <label htmlFor={id} className="label">
                    {label}
                  </label>
                  <Select id={id} name={name} required={q.required} defaultValue={v(name)} className="input">
                    <option value="">Choose…</option>
                    {options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
              );
            }
            return (
              <div key={q.key}>
                <label htmlFor={id} className="label">
                  {label}
                </label>
                {q.kind === 'number' ? (
                  <input id={id} name={name} inputMode="decimal" required={q.required} maxLength={10} defaultValue={v(name)} className="input" />
                ) : (
                  <textarea id={id} name={name} rows={3} required={q.required} maxLength={L.textAnswer} defaultValue={v(name)} className="input" />
                )}
              </div>
            );
          })}
        </fieldset>
      )}

      <div className="border-t border-line pt-5">
        <label htmlFor={fid('cv')} className="label">
          Your CV
        </label>
        <input
          id={fid('cv')}
          name="cv"
          type="file"
          required
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          aria-describedby={fid('cv-hint')}
          className="input"
        />
        <p id={fid('cv-hint')} className="hint">
          A PDF or a Word file (.docx), at most {L.cvMb} MB.
        </p>
      </div>

      {/* hidden from people: only a robot fills it in */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor={fid(HONEYPOT)}>Leave this empty</label>
        <input id={fid(HONEYPOT)} name={HONEYPOT} tabIndex={-1} autoComplete="off" />
      </div>

      <label className="flex items-start gap-3 text-sm leading-relaxed">
        <input type="checkbox" name="consent" required defaultChecked={v('consent') === 'on'} className="mt-1 size-4 shrink-0" />
        <span>{APPLY_CONSENT_TEXT}</span>
      </label>

      <button type="submit" disabled={pending} className="btn btn-primary w-full sm:w-auto">
        {pending ? 'Sending…' : 'Send my application'}
      </button>
    </form>
  );
}
