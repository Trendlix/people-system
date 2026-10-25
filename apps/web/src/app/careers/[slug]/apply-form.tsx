'use client';

import { startTransition, useActionState, useRef, useState } from 'react';
import {
  APPLY_CONSENT_TEXT,
  EMAIL_CONFIRMED_LABEL,
  HIDDEN_PORTFOLIO,
  LINKEDIN_TICKET_FIELD,
  normalEmail,
  RECRUITMENT_LIMITS,
  type CvPrefillResult,
  type LinkedInDetails,
  type PortfolioAsk,
  type PublicQuestion,
} from '@trendlix/shared';
import { FormErrors, useFieldIds } from '@/components/form';
import { NoticeInput } from '@/components/notice-input';
import { PhoneInput } from '@/components/phone-input';
import { Select } from '@/components/select';
import { answerField, HONEYPOT, portfolioProblems } from '../careers';
import { WhatsAppTick } from '../whatsapp-tick';
import { Checked, EmailInput, useFieldChecks, YearsInput } from '../fields';
import { CvStart, FromTag, keepDraft, useFormFill, useLinkedInDetails, useLinkedInDraft, useLinkedInReturn, type LinkedInReturn } from '../form-fill';
import { PortfolioFields, usePortfolioBoxes } from '../portfolio-fields';
import { cvFieldValues, linkedinFieldValues } from '../prefill';
import type { ApplyState } from './actions';

// The application form of a job on the careers page (owner, 22 October 2026: "where will we include the ATS?"): the
// applicant's details, the job's screening questions, the CV (a PDF or a Word file, at most 5 MB) and the consent;
// once sent, the reference to keep. A field hidden from people catches robots. Made for a phone first; in trendlix.com's
// contact form's look (careers.css, 22 October 2026: "i need it to match the UI"). The email, mobile, years and notice
// period as the owner asked on 22 October 2026 (fields.tsx): the email checked as it is left, the mobile as the system
// takes one (the country code and the number without its 0), the years in numbers with "years" after them, the notice
// period a number of days or months; each said under its field before sending.
// Since 25 October 2026 (owner: "can i use linkedin to complete the data? and for creatives, they need to add their
// portfolios"; asked, all three): the CV first, read to fill in the empty fields ("From your CV"); "Fill in with
// LinkedIn" when it is on (the name and the email, "Confirmed by LinkedIn" when LinkedIn says so); and the portfolio as
// the vacancy asks (portfolio-fields.tsx) in place of the one portfolio box.

type Action = (prev: ApplyState, fd: FormData) => Promise<ApplyState>;

const L = RECRUITMENT_LIMITS;
const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

interface Props {
  action: Action;
  questions: PublicQuestion[];
  title: string;
  /** What the vacancy asks for as a portfolio (hidden from an API before it). */
  portfolio?: PortfolioAsk;
  /** "Fill in with LinkedIn" (on), this form's key for it ("job:<slug>"), the link's ?src=, and the address's ?linkedin=. */
  linkedin: { on: boolean; formKey: string; src: string | null; returned: string | null };
}

/** The form, put up again with the fields kept while the person was at LinkedIn (once read in the browser). */
export function ApplyForm(props: Props) {
  const draft = useLinkedInDraft(props.linkedin.formKey, props.linkedin.returned);
  const link = useLinkedInReturn(props.linkedin.formKey, props.linkedin.returned);
  return <ApplyFormBody key={draft ? 'kept' : 'new'} {...props} kept={draft} link={link} />;
}

function ApplyFormBody({ action, questions, title, portfolio = HIDDEN_PORTFOLIO, linkedin, kept, link }: Props & { kept: { values: Record<string, string>; hadCv: boolean } | null; link: LinkedInReturn }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const form = useRef<HTMLFormElement>(null);
  const v = (name: string) => state.values?.[name] ?? kept?.values[name] ?? '';
  const checks = useFieldChecks(fid, { yearsRequired: true });
  const fill = useFormFill();
  const boxes = usePortfolioBoxes(v);
  const [ticket, setTicket] = useState<string>(() => v(LINKEDIN_TICKET_FIELD));
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [emailNow, setEmailNow] = useState<string>(() => v('email'));
  const fv = (name: 'fullName' | 'email' | 'mobile' | 'linkedin' | 'yearsExperience') => fill.values[name] ?? v(name);

  function fromLinkedIn(d: LinkedInDetails) {
    setTicket(d.ticket);
    const filled = fill.fill(form.current, linkedinFieldValues(d), 'linkedin');
    if (filled.includes('email') && d.email) setEmailNow(d.email);
    // "Confirmed by LinkedIn" while the email is the one LinkedIn gave (the API checks it again with the ticket)
    setConfirmed(d.emailConfirmed && d.email ? normalEmail(d.email) : null);
  }
  useLinkedInDetails(link, fromLinkedIn);

  function fromCv(found: CvPrefillResult): number {
    const filled = fill.fill(form.current, cvFieldValues(found), 'cv');
    if (filled.includes('email') && found.email) setEmailNow(found.email);
    const links = boxes.fillFromCv(found.portfolioLinks, portfolio);
    return filled.length + (links ? 1 : 0);
  }

  if (state.reference !== undefined) {
    return (
      <section className="careers-box space-y-4" aria-live="polite">
        <h2 className="careers-display text-[clamp(36px,5vw,56px)] leading-[0.95] tracking-[-0.035em]">Thank You for Applying</h2>
        <p className="text-base leading-7 text-white/85">
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

  const emailConfirmed = !!confirmed && normalEmail(emailNow) === confirmed;

  return (
    <form ref={form} action={formAction} onSubmit={onSubmit} className="careers-box space-y-8" aria-labelledby={fid('heading')}>
      <h2 id={fid('heading')} className="careers-form-title">
        Apply for This Job
      </h2>
      <FormErrors errors={state.errors} />
      <CvStart
        fid={fid}
        onRead={fromCv}
        linkedin={linkedin.on ? { formKey: linkedin.formKey, src: linkedin.src, onLeave: () => keepDraft(form.current, linkedin.formKey) } : null}
        note={link.note}
        hadCv={kept?.hadCv === true}
      />
      {ticket && <input type="hidden" name={LINKEDIN_TICKET_FIELD} value={ticket} />}
      <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2">
        <div className="sm:col-span-2" onChange={() => fill.unmark('fullName')}>
          <label htmlFor={fid('fullName')} className="label">
            Full name <FromTag origin={fill.marks.fullName} />
          </label>
          <input
            key={`fullName-${fill.keys.fullName}`}
            id={fid('fullName')}
            name="fullName"
            required
            maxLength={L.name}
            autoComplete="name"
            defaultValue={fv('fullName')}
            className="input"
          />
        </div>
        <div
          onChange={(e) => {
            fill.unmark('email');
            if (e.target instanceof HTMLInputElement && e.target.name === 'email') setEmailNow(e.target.value);
          }}
        >
          <label htmlFor={fid('email')} className="label">
            Email <FromTag origin={fill.marks.email} />
          </label>
          <EmailInput key={`email-${fill.keys.email}`} id={fid('email')} checks={checks} defaultValue={fv('email')} />
          {emailConfirmed && <p className="careers-confirmed">{EMAIL_CONFIRMED_LABEL}</p>}
        </div>
        <div onChange={() => fill.unmark('mobile')}>
          <label htmlFor={fid('mobile')} className="label">
            Mobile <FromTag origin={fill.marks.mobile} />
          </label>
          <Checked checks={checks} field="mobile" id={fid('mobile')}>
            <PhoneInput
              key={`mobile-${fill.keys.mobile}`}
              id={fid('mobile')}
              name="mobile"
              label="Mobile"
              required
              autoComplete="tel"
              variant="careers"
              defaultValue={fv('mobile')}
              {...checks.ids('mobile')}
            />
          </Checked>
        </div>
        <div onChange={() => fill.unmark('linkedin')}>
          <label htmlFor={fid('linkedin')} className="label">
            LinkedIn <span className="font-normal text-muted">(optional)</span> <FromTag origin={fill.marks.linkedin} />
          </label>
          <input
            key={`linkedin-${fill.keys.linkedin}`}
            id={fid('linkedin')}
            name="linkedin"
            type="text"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={L.link}
            placeholder="linkedin.com/in/your-name"
            defaultValue={fv('linkedin')}
            className="input"
          />
        </div>
        <div onChange={() => fill.unmark('yearsExperience')}>
          <label htmlFor={fid('yearsExperience')} className="label">
            Years of experience <FromTag origin={fill.marks.yearsExperience} />
          </label>
          <YearsInput key={`years-${fill.keys.yearsExperience}`} id={fid('yearsExperience')} checks={checks} required defaultValue={fv('yearsExperience')} />
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

      <PortfolioFields fid={fid} ask={portfolio} links={boxes.links} onLinks={boxes.setLinks} fromCv={boxes.fromCv} onTyped={boxes.typed} said={boxes.said} />

      {questions.length > 0 && (
        <fieldset className="space-y-8 border-t border-line pt-8">
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

      {/* hidden from people: only a robot fills it in */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor={fid(HONEYPOT)}>Leave this empty</label>
        <input id={fid(HONEYPOT)} name={HONEYPOT} tabIndex={-1} autoComplete="off" />
      </div>

      <label className="flex items-start gap-3 text-sm leading-relaxed text-white/85">
        <input type="checkbox" name="consent" required defaultChecked={v('consent') === 'on'} className="mt-1 size-4 shrink-0" />
        <span>{APPLY_CONSENT_TEXT}</span>
      </label>

      <WhatsAppTick defaultChecked={v('whatsapp') === 'on'} />

      <button
        type="submit"
        disabled={pending}
        onClick={(e) => {
          // the email, mobile, years and notice period checked first, each said under its field (22 October 2026); then
          // the portfolio as the vacancy asks (25 October 2026)
          const box = e.currentTarget.form;
          if (!checks.passes(box)) return e.preventDefault();
          const said = box ? portfolioProblems(new FormData(box), portfolio) : [];
          boxes.setSaid(said);
          if (said.length) {
            e.preventDefault();
            box?.querySelector<HTMLElement>('[name^="portfolioLink-"], [name="portfolioFile"]')?.focus();
          }
        }}
        className="btn btn-primary w-full sm:w-auto"
      >
        {pending ? 'Sending…' : 'Send my application'}
      </button>
    </form>
  );
}
