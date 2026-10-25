'use client';

import { startTransition, useActionState, useRef, useState } from 'react';
import {
  EMAIL_CONFIRMED_LABEL,
  GENERAL_CV_CONSENT_TEXT,
  GENERAL_CV_LIMITS,
  LINKEDIN_TICKET_FIELD,
  normalEmail,
  OTHER_POSITION,
  RECRUITMENT_LIMITS,
  type CvPositionGroup,
  type CvPrefillResult,
  type LinkedInDetails,
  type PublicGeneralForm,
} from '@trendlix/shared';
import { FormErrors, useFieldIds } from '@/components/form';
import { NoticeInput } from '@/components/notice-input';
import { PhoneInput } from '@/components/phone-input';
import { PositionOptions } from '@/components/position-options';
import { Select } from '@/components/select';
import { generalPortfolioAsk, HONEYPOT, portfolioProblems, POSITION_FIELD } from '../careers';
import { WhatsAppTick } from '../whatsapp-tick';
import { Checked, EmailInput, useFieldChecks, YearsInput } from '../fields';
import { CvStart, FromTag, keepDraft, useFormFill, useLinkedInDetails, useLinkedInDraft, useLinkedInReturn, type LinkedInReturn } from '../form-fill';
import { PortfolioFields, usePortfolioBoxes } from '../portfolio-fields';
import { cvFieldValues, linkedinFieldValues } from '../prefill';
import type { GeneralState } from './actions';

// "Send us your CV" on the careers page (owner, 22 October 2026: "what came out of the posted jobs and what cam on
// randomly", "Both"): the person's details, the position they would like (owner, 25 October 2026: "should it be the
// positions?"; asked, "Position, grouped by team": the job titles with their levels merged, under their teams, or "Other
// (write it)"), the CV (a PDF or a Word file, at most 5 MB) and the consent; once sent, the reference to keep. A field
// hidden from people catches robots. Made for a phone first; in trendlix.com's contact form's look (careers.css, 22
// October 2026: "i need it to match the UI"). The email, mobile, years and notice period as the owner asked on 22
// October 2026 (fields.tsx), as on a job's form; the years optional here.
// Since 25 October 2026 (owner: "can i use linkedin to complete the data? and for creatives, they need to add their
// portfolios"; asked, all three), as on a job's form: the CV first, read to fill in the empty fields; "Fill in with
// LinkedIn" when it is on; and the portfolio the chosen position asks for (the strictest of its job titles'), Other's
// for Other, none before a position is chosen.

type Action = (prev: GeneralState, fd: FormData) => Promise<GeneralState>;

const L = RECRUITMENT_LIMITS;

interface Props {
  action: Action;
  positions: readonly CvPositionGroup[];
  /** The portfolio each position asks for, and Other's (none from an API before them: hidden). */
  portfolios?: Pick<PublicGeneralForm, 'portfolios' | 'otherPortfolio'>;
  /** "Fill in with LinkedIn" (on), this form's key for it ("general"), and the address's ?linkedin=. */
  linkedin: { on: boolean; formKey: string; returned: string | null };
}

/** The form, put up again with the fields kept while the person was at LinkedIn (once read in the browser). */
export function GeneralForm(props: Props) {
  const draft = useLinkedInDraft(props.linkedin.formKey, props.linkedin.returned);
  const link = useLinkedInReturn(props.linkedin.formKey, props.linkedin.returned);
  return <GeneralFormBody key={draft ? 'kept' : 'new'} {...props} kept={draft} link={link} />;
}

function GeneralFormBody({ action, positions, portfolios, linkedin, kept, link }: Props & { kept: { values: Record<string, string>; hadCv: boolean } | null; link: LinkedInReturn }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const form = useRef<HTMLFormElement>(null);
  const v = (name: string) => state.values?.[name] ?? kept?.values[name] ?? '';
  const [position, setPosition] = useState(v(POSITION_FIELD));
  const checks = useFieldChecks(fid, { yearsRequired: false });
  const fill = useFormFill();
  const boxes = usePortfolioBoxes(v);
  const [ticket, setTicket] = useState<string>(() => v(LINKEDIN_TICKET_FIELD));
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [emailNow, setEmailNow] = useState<string>(() => v('email'));
  const [cvLinks, setCvLinks] = useState<CvPrefillResult['portfolioLinks']>([]);
  const ask = generalPortfolioAsk(position, portfolios);
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
    // the CV's links wait for the position: put in the boxes once one asks for them
    setCvLinks(found.portfolioLinks);
    const links = boxes.fillFromCv(found.portfolioLinks, ask);
    return filled.length + (links ? 1 : 0);
  }

  function choose(next: string) {
    setPosition(next);
    // a position asking for a portfolio: the CV's links of a kind it takes in its empty boxes
    if (cvLinks.length) boxes.fillFromCv(cvLinks, generalPortfolioAsk(next, portfolios));
  }

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

  const emailConfirmed = !!confirmed && normalEmail(emailNow) === confirmed;

  return (
    <form ref={form} action={formAction} onSubmit={onSubmit} className="careers-box space-y-8" aria-labelledby={fid('heading')}>
      {/* the page's title and its line are above the form (general/page.tsx) */}
      <h2 id={fid('heading')} className="careers-form-title">
        Your Details
      </h2>
      <FormErrors errors={state.errors} />
      <CvStart
        fid={fid}
        onRead={fromCv}
        linkedin={linkedin.on ? { formKey: linkedin.formKey, src: null, onLeave: () => keepDraft(form.current, linkedin.formKey) } : null}
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
        <div className={position === OTHER_POSITION ? '' : 'sm:col-span-2'}>
          <label htmlFor={fid('position')} className="label">
            The position you would like
          </label>
          <Select id={fid('position')} name={POSITION_FIELD} required value={position} onChange={(e) => choose(e.target.value)} className="input">
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
            Years of experience <span className="font-normal text-muted">(optional)</span> <FromTag origin={fill.marks.yearsExperience} />
          </label>
          <YearsInput key={`years-${fill.keys.yearsExperience}`} id={fid('yearsExperience')} checks={checks} required={false} defaultValue={fv('yearsExperience')} />
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

      <PortfolioFields fid={fid} ask={ask} links={boxes.links} onLinks={boxes.setLinks} fromCv={boxes.fromCv} onTyped={boxes.typed} said={boxes.said} />

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
          // the email, mobile, years and notice period checked first, each said under its field (22 October 2026); then
          // the portfolio as the chosen position asks (25 October 2026)
          const box = e.currentTarget.form;
          if (!checks.passes(box)) return e.preventDefault();
          const said = box ? portfolioProblems(new FormData(box), ask) : [];
          boxes.setSaid(said);
          if (said.length) {
            e.preventDefault();
            box?.querySelector<HTMLElement>('[name^="portfolioLink-"], [name="portfolioFile"]')?.focus();
          }
        }}
        className="btn btn-primary w-full sm:w-auto"
      >
        {pending ? 'Sending…' : 'Send my CV'}
      </button>
    </form>
  );
}
