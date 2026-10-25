'use client';

import { startTransition, useActionState, useState } from 'react';
import { GENERAL_CV_CONSENT_TEXT, GENERAL_CV_LIMITS, OTHER_POSITION, RECRUITMENT_LIMITS, type CvPositionGroup } from '@trendlix/shared';
import { FormErrors, useFieldIds } from '@/components/form';
import { NoticeInput } from '@/components/notice-input';
import { PhoneInput } from '@/components/phone-input';
import { PositionOptions } from '@/components/position-options';
import { Select } from '@/components/select';
import { HONEYPOT, POSITION_FIELD } from '../careers';
import { WhatsAppTick } from '../whatsapp-tick';
import { Checked, EmailInput, useFieldChecks, YearsInput } from '../fields';
import type { GeneralState } from './actions';

// "Send us your CV" on the careers page (owner, 22 October 2026: "what came out of the posted jobs and what cam on
// randomly", "Both"): the person's details, the position they would like (owner, 25 October 2026: "should it be the
// positions?"; asked, "Position, grouped by team": the job titles with their levels merged, under their teams, or "Other
// (write it)"), the CV (a PDF or a Word file, at most 5 MB) and the consent; once sent, the reference to keep. A field
// hidden from people catches robots. Made for a phone first; in trendlix.com's contact form's look (careers.css, 22
// October 2026: "i need it to match the UI"). The email, mobile, years and notice period as the owner asked on 22
// October 2026 (fields.tsx), as on a job's form; the years optional here.

type Action = (prev: GeneralState, fd: FormData) => Promise<GeneralState>;

const L = RECRUITMENT_LIMITS;

export function GeneralForm({ action, positions }: { action: Action; positions: readonly CvPositionGroup[] }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const v = (name: string) => state.values?.[name] ?? '';
  const [position, setPosition] = useState(v(POSITION_FIELD));
  const checks = useFieldChecks(fid, { yearsRequired: false });

  if (state.reference !== undefined) {
    return (
      <section className="careers-box space-y-4" aria-live="polite">
        <h2 className="careers-display text-[clamp(36px,5vw,56px)] leading-[0.95] tracking-[-0.035em]">Thank You for Sending Your CV</h2>
        <p className="text-base leading-7 text-white/85">
          We received it
          {state.reference ? (
            <>
              . Its reference is <span className="font-semibold">{state.reference}</span>
            </>
          ) : null}
          . When a job opens that fits what you do, we will contact you.
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
    <form action={formAction} onSubmit={onSubmit} className="careers-box space-y-8" aria-labelledby={fid('heading')}>
      {/* the page's title and its line are above the form (general/page.tsx) */}
      <h2 id={fid('heading')} className="careers-form-title">
        Your Details
      </h2>
      <FormErrors errors={state.errors} />
      <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2">
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
          <EmailInput id={fid('email')} checks={checks} defaultValue={v('email')} />
        </div>
        <div>
          <label htmlFor={fid('mobile')} className="label">
            Mobile
          </label>
          <Checked checks={checks} field="mobile" id={fid('mobile')}>
            <PhoneInput id={fid('mobile')} name="mobile" label="Mobile" required autoComplete="tel" variant="careers" defaultValue={v('mobile')} {...checks.ids('mobile')} />
          </Checked>
        </div>
        <div className={position === OTHER_POSITION ? '' : 'sm:col-span-2'}>
          <label htmlFor={fid('position')} className="label">
            The position you would like
          </label>
          <Select id={fid('position')} name={POSITION_FIELD} required value={position} onChange={(e) => setPosition(e.target.value)} className="input">
            <option value="">Choose…</option>
            <PositionOptions groups={positions} />
            <option value={OTHER_POSITION}>Other (write it)</option>
          </Select>
        </div>
        {position === OTHER_POSITION && (
          <div>
            <label htmlFor={fid('positionOther')} className="label">
              Which position
            </label>
            <input id={fid('positionOther')} name="positionOther" required maxLength={GENERAL_CV_LIMITS.positionOther} defaultValue={v('positionOther')} className="input" />
          </div>
        )}
        <div>
          <label htmlFor={fid('linkedin')} className="label">
            LinkedIn <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id={fid('linkedin')} name="linkedin" type="text" inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={L.link} placeholder="linkedin.com/in/your-name" defaultValue={v('linkedin')} className="input" />
        </div>
        <div>
          <label htmlFor={fid('portfolio')} className="label">
            Portfolio <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id={fid('portfolio')} name="portfolio" type="text" inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={L.link} placeholder="behance.net/your-name" defaultValue={v('portfolio')} className="input" />
        </div>
        <div>
          <label htmlFor={fid('yearsExperience')} className="label">
            Years of experience <span className="font-normal text-muted">(optional)</span>
          </label>
          <YearsInput id={fid('yearsExperience')} checks={checks} required={false} defaultValue={v('yearsExperience')} />
        </div>
        <div>
          <label htmlFor={fid('noticePeriod')} className="label">
            Notice period <span className="font-normal text-muted">(optional)</span>
          </label>
          <Checked checks={checks} field="noticePeriod" id={fid('noticePeriod')}>
            <NoticeInput id={fid('noticePeriod')} variant="careers" defaultNumber={v('noticeNumber')} defaultUnit={v('noticeUnit')} {...checks.ids('noticePeriod')} />
          </Checked>
        </div>
        <div>
          <label htmlFor={fid('expectedSalary')} className="label">
            Expected salary, EGP a month <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id={fid('expectedSalary')} name="expectedSalary" inputMode="numeric" maxLength={12} defaultValue={v('expectedSalary')} className="input" />
        </div>
      </div>

      <div className="border-t border-line pt-8">
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

      <label className="flex items-start gap-3 text-sm leading-relaxed text-white/85">
        <input type="checkbox" name="consent" required defaultChecked={v('consent') === 'on'} className="mt-1 size-4 shrink-0" />
        <span>{GENERAL_CV_CONSENT_TEXT}</span>
      </label>

      <WhatsAppTick defaultChecked={v('whatsapp') === 'on'} />

      <button
        type="submit"
        disabled={pending}
        onClick={(e) => {
          // the email, mobile, years and notice period checked first, each said under its field (22 October 2026)
          if (!checks.passes(e.currentTarget.form)) e.preventDefault();
        }}
        className="btn btn-primary w-full sm:w-auto"
      >
        {pending ? 'Sending…' : 'Send my CV'}
      </button>
    </form>
  );
}
