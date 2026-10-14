'use client';

import { startTransition, useActionState, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { flushSync } from 'react-dom';
import { FormErrors, SubmitButton, useFieldIds } from '@/components/form';
import type { FormState, IdCardReading } from '@/lib/types';
import { createEmployee } from '../actions';
import { EmploymentFields, type EmploymentPickers } from '../employment-fields';
import { CardReadStatus, CardTextDetails, NationalIdFields } from '../id-card';
import { FILE_INPUT, limitFileSize, PHOTO_ACCEPT } from '../paperwork';
import { readIdCard } from '../paperwork-actions';
import { PersonalFields } from '../personal-fields';
import { withSmallerPhotos } from '../shrink-photo';

// The Add employee page, in three steps shown one at a time: 1 the national ID card is read, 2 the profile (filled in
// from the card, for HR to check), 3 the employment details. Steps 2 and 3 are one form, sent once at the end, and
// hidden steps stay in the page, so going back and forth loses nothing. What the card says and its photos stay in
// this page, never in a URL; the photos go to the employee file once the employee is added.

type Step = 1 | 2 | 3;

const STEPS: { step: Step; name: string }[] = [
  { step: 1, name: 'ID Card' },
  { step: 2, name: 'Profile' },
  { step: 3, name: 'Employment' },
];

/** A card that was read: what it says, and its photos (made smaller) for the employee file. */
type Card = { reading: IdCardReading; front: File; back: File | null };

/**
 * The form is never reset (see `create`), so its fields keep what was typed through a refused save without the
 * action's copy of the values: they start from the card, or empty.
 */
const FRESH: FormState = {};

// Which step holds the field a message is about, by the words the API and the form use for it.
const EMPLOYMENT_WORDS = /employment type|choose a status|department|team|job title|manager|join date|probation|work arrangement|hybrid|office days|shift/i;
const PROFILE_WORDS =
  /name|code|birth|gender|male|nationality|marital|military|email|mobile|governorate|address|emergency|university|faculty|degree|major|graduation|grade|qualification|national id|printed|issu|expir/i;

/** The step to show a refused save on: the profile when any message is about it, else employment. */
function stepFor(errors: string[]): Step {
  return errors.some((e) => !EMPLOYMENT_WORDS.test(e) && PROFILE_WORDS.test(e)) ? 2 : 3;
}

/** The photo chosen in a form field, or null when none was. */
function photo(fd: FormData, key: string): File | null {
  const value = fd.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

const viewLink = 'inline-flex min-h-9 items-center text-sm font-semibold';

/** Opens a photo kept in this page. Its address is made when the link is shown and let go when it is not. */
function PhotoLink({ file, children }: { file: File; children: React.ReactNode }) {
  const attach = useCallback(
    (link: HTMLAnchorElement) => {
      const address = URL.createObjectURL(file);
      link.href = address;
      return () => URL.revokeObjectURL(address);
    },
    [file],
  );
  return (
    <a ref={attach} target="_blank" rel="noopener" className={viewLink}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export function NewEmployeeForm({ pickers }: { pickers: EmploymentPickers }) {
  const fid = useFieldIds();
  const [step, setStep] = useState<Step>(1);
  const profile = useRef<HTMLElement>(null);
  /** Each step's heading, focused when the step is shown. */
  const headingId = (n: Step) => fid(`step-${n}`);
  const focusHeading = (n: Step) => document.getElementById(headingId(n))?.focus();

  // ---------- step 1: the ID card ----------
  const [card, setCard] = useState<Card | null>(null);
  /** Counts the cards read: a new one fills in the profile again. */
  const [cardsRead, setCardsRead] = useState(0);
  const [readErrors, setReadErrors] = useState<string[]>();
  const [reading, startReading] = useTransition();

  // ---------- steps 2 and 3: the employee ----------
  const [state, formAction, saving] = useActionState(createEmployee, {} as FormState);
  // A refused save opens the step holding the field the message is about.
  const [answered, setAnswered] = useState(state);
  if (state !== answered) {
    setAnswered(state);
    if (state.errors) setStep(stepFor(state.errors));
  }
  const refusedAt = state.errors ? headingId(stepFor(state.errors)) : null;
  useEffect(() => {
    if (refusedAt) document.getElementById(refusedAt)?.focus();
  }, [state, refusedAt]);

  function go(to: Step) {
    flushSync(() => setStep(to));
    focusHeading(to);
  }

  function read(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startReading(async () => {
      // The photos are made smaller first (see shrink-photo.ts), then sent; the smaller ones are kept for the file.
      const ready = await withSmallerPhotos(fd, ['front', 'back']);
      const front = photo(ready, 'front');
      const result = await readIdCard(ready);
      if (!result.reading || !front) {
        startTransition(() => setReadErrors(result.errors));
        return;
      }
      const reading = result.reading;
      flushSync(() => {
        setReadErrors(undefined);
        setCard({ reading, front, back: photo(ready, 'back') });
        setCardsRead((n) => n + 1);
        setStep(2);
      });
      focusHeading(2);
    });
  }

  function byHand() {
    setReadErrors(undefined);
    go(2);
  }

  /** Next from the profile: the names (and any email) must be right first. */
  function next() {
    const wrong = profile.current?.querySelector<HTMLInputElement>(':is(input, select, textarea):invalid');
    if (wrong) wrong.reportValidity();
    else go(3);
  }

  // Sent by hand rather than as a form action, which would reset the form afterwards (selects to how they started)
  // and so lose what was typed when the save is refused.
  function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step === 2) return next(); // Enter on the profile step goes on to the next step
    const fd = new FormData(e.currentTarget);
    if (card) {
      fd.set('idFront', card.front);
      if (card.back) fd.set('idBack', card.back);
    }
    startTransition(() => formAction(fd));
  }

  const heading = (n: Step) => ({ id: headingId(n), tabIndex: -1, className: 'font-semibold outline-none' });

  return (
    <div className="max-w-3xl space-y-4">
      <ol aria-label="Steps" className="flex flex-wrap gap-x-6 gap-y-2">
        {STEPS.map(({ step: n, name }) => (
          <li
            key={n}
            aria-current={n === step ? 'step' : undefined}
            className={`flex items-center gap-2 text-sm ${n === step ? 'font-semibold text-ink' : 'text-muted'}`}
          >
            <span
              aria-hidden="true"
              className={`flex size-7 items-center justify-center rounded-full text-xs font-bold ${
                n === step ? 'bg-accent text-white' : n < step ? 'bg-accent-soft text-accent' : 'bg-line-soft text-muted'
              }`}
            >
              {n}
            </span>
            <span>
              <span className="sr-only">Step {n}: </span>
              {name}
            </span>
          </li>
        ))}
      </ol>

      <section hidden={step !== 1} className="card p-6">
        <h2 {...heading(1)}>Start with the National ID Card</h2>
        <p className="mt-1 text-sm text-muted">
          The photos are read and the details on the card are filled in for you to check. The photos are kept in the employee file once the
          employee is added. No card at hand, or it cannot be read? Fill in the details by hand.
        </p>

        <form onSubmit={read} className="mt-4 space-y-4">
          <FormErrors errors={readErrors} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={fid('front')} className="label">
                Front of the card
              </label>
              <input id={fid('front')} name="front" type="file" accept={PHOTO_ACCEPT} required onChange={limitFileSize} className={FILE_INPUT} />
            </div>
            <div>
              <label htmlFor={fid('back')} className="label">
                Back of the card <span className="font-normal text-muted">(optional)</span>
              </label>
              <input id={fid('back')} name="back" type="file" accept={PHOTO_ACCEPT} onChange={limitFileSize} className={FILE_INPUT} />
            </div>
          </div>
          <p className="hint">JPEG, PNG or WebP, up to 10 MB each. A sharp, straight photo in good light reads best. The back gives the dates and the issuing office.</p>
          {card && <p className="text-sm text-muted">The card has been read. Reading other photos fills in the profile again from them.</p>}
          <div className="flex flex-wrap gap-3">
            <SubmitButton pendingText="Reading the card…" busy={reading}>
              Read the card
            </SubmitButton>
            {card ? (
              <button type="button" onClick={() => go(2)} disabled={reading} className="btn btn-secondary">
                Next
              </button>
            ) : (
              <button type="button" onClick={byHand} disabled={reading} className="btn btn-secondary">
                Fill in by hand instead
              </button>
            )}
          </div>
        </form>
      </section>

      <form onSubmit={create} hidden={step === 1}>
        <section ref={profile} hidden={step !== 2} className="card space-y-8 p-6">
          <div>
            <h2 {...heading(2)}>Profile</h2>
            <p className="mt-1 text-sm text-muted">Only the names are needed now. Anything left empty can be added on the profile later.</p>
          </div>
          <FormErrors errors={state.errors} />

          {card && (
            <div className="space-y-3 rounded-lg border border-line p-4">
              <CardReadStatus suggestions={card.reading.suggestions} />
              <div className="flex flex-wrap gap-x-4">
                <PhotoLink file={card.front}>View the front photo</PhotoLink>
                {card.back && <PhotoLink file={card.back}>View the back photo</PhotoLink>}
              </div>
              <CardTextDetails front={card.reading.front.text} back={card.reading.back?.text ?? null} />
            </div>
          )}

          {/* A newly read card fills the profile in again from what it says. */}
          <div key={cardsRead} className="space-y-8">
            <PersonalFields state={FRESH} fid={fid} suggestions={card?.reading.suggestions} />
            <fieldset className="space-y-5">
              <legend className="font-semibold">
                National ID <span className="badge ml-2 bg-line-soft align-middle text-muted">Restricted</span>
              </legend>
              <NationalIdFields state={FRESH} fid={fid} suggestions={card?.reading.suggestions} />
            </fieldset>
          </div>

          {/* Shown only on this step, so pressing Enter in a field here goes on (Next is the form's first submit button). */}
          {step === 2 && (
            <div className="flex flex-wrap gap-3 border-t border-line pt-6">
              <button type="submit" formNoValidate className="btn btn-primary">
                Next
              </button>
              <button type="button" onClick={() => go(1)} className="btn btn-secondary">
                Back
              </button>
            </div>
          )}
        </section>

        <section hidden={step !== 3} className="card space-y-8 p-6">
          <h2 {...heading(3)}>Employment</h2>
          <FormErrors errors={state.errors} />
          <EmploymentFields state={FRESH} fid={fid} pickers={pickers} />
          <p className="text-sm text-muted">Bank details can be added on the profile once it is created.</p>

          {step === 3 && (
            <div className="flex flex-wrap gap-3 border-t border-line pt-6">
              <SubmitButton pendingText="Creating the employee…" busy={saving}>
                Create employee
              </SubmitButton>
              <button type="button" onClick={() => go(2)} disabled={saving} className="btn btn-secondary">
                Back
              </button>
            </div>
          )}
        </section>
      </form>
    </div>
  );
}
