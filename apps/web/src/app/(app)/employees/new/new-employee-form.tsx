'use client';

import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { DocumentViewer } from '@/components/document-viewer';
import { FormErrors, SubmitButton, useFieldIds } from '@/components/form';
import type { FormState, IdCardReading } from '@/lib/types';
import { createEmployee } from '../actions';
import { CardReadStatus, CardTextDetails, LearnedFixesNote, NationalIdFields, ReadValues } from '../id-card';
import { idScanTitle } from '../paperwork';
import { readIdCard } from '../paperwork-actions';
import { PersonalFields } from '../personal-fields';
import { IdScan } from '../scan/id-scan';

// The Add employee page, in three steps shown one at a time: 1 the national ID card is scanned and read, 2 the profile
// (filled in from the card, for HR to check, with the national ID), 3 education; then Save profile. Every new employee
// starts from a clean scan of their card, front and back (owner's rule): there is no filling in by hand instead. Steps 2
// and 3 are one form, sent once at the end, and hidden steps stay in the page, so going back and forth loses nothing.
// What the card says and the cut-out cards stay in this page, never in a URL; the cards go to the employee file once
// the profile is saved. Employment is added next, on the new profile's Employment tab (owner's decision: the profile
// and the employment are separate, so a profile exists before the hire and stays after the employment ends).

type Step = 1 | 2 | 3;

const STEPS: { step: Step; name: string }[] = [
  { step: 1, name: 'ID Card' },
  { step: 2, name: 'Profile' },
  { step: 3, name: 'Education' },
];

/** A card that was read: what it says, and its two sides cut out of the scan (JPEG) for the employee file. */
type Card = { reading: IdCardReading; front: File; back: File };

/**
 * The form is never reset (see `create`), so its fields keep what was typed through a refused save without the
 * action's copy of the values: they start from the card, or empty.
 */
const FRESH: FormState = {};

// Which step holds the field a message is about, by the words the API and the form use for it.
// (a student's too, 25 October 2026: "still studying", "the study year", "the expected graduation")
const EDUCATION_WORDS = /university|faculty|degree|major|graduation|grade from the list|qualification|studying|study year/i;

/** The step to show a refused save on: education when every message is about it, else the profile. */
function stepFor(errors: string[]): Step {
  return errors.length > 0 && errors.every((e) => EDUCATION_WORDS.test(e)) ? 3 : 2;
}

/** `emailDomain`: the company's work email domain, which the work email must end in (null when there is none). */
export function NewEmployeeForm({ emailDomain }: { emailDomain: string | null }) {
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

  // ---------- steps 2 and 3: the profile ----------
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

  /** Reads the two sides cut out of the scan; the profile opens once they are read (else the step says why not). */
  async function read(cards: { front: File; back: File }): Promise<string[] | undefined> {
    const fd = new FormData();
    fd.append('front', cards.front, cards.front.name);
    fd.append('back', cards.back, cards.back.name);
    const result = await readIdCard(fd);
    if (!result.reading) return result.errors ?? ['The card could not be read. Please try again.'];
    const reading = result.reading;
    flushSync(() => {
      setCard({ reading, ...cards });
      setCardsRead((n) => n + 1);
      setStep(2);
    });
    focusHeading(2);
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
      fd.set('idBack', card.back);
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
          Every new employee starts from a scan of their national ID card, front and back. The card is found on the scan, cut out and set
          straight; check both sides, then read them, and the details are filled in for you to check. The cut-out card is kept in the employee
          file once the profile is saved.
        </p>
        <LearnedFixesNote />

        <div className="mt-4 space-y-4">
          <IdScan onRead={read} />
          {card && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted">The card has been read. Reading the scan again fills in the profile again from it.</p>
              <button type="button" onClick={() => go(2)} className="btn btn-secondary">
                Next
              </button>
            </div>
          )}
        </div>
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
              <CardReadStatus suggestions={card.reading.suggestions} notes={card.reading.notes} />
              <DocumentViewer
                title={idScanTitle({ front: true, back: true })}
                files={[
                  { label: 'Front', alt: 'Front of the national ID card', src: card.front },
                  { label: 'Back', alt: 'Back of the national ID card', src: card.back },
                ]}
              >
                View the front and back
              </DocumentViewer>
              <CardTextDetails front={card.reading.front.text} back={card.reading.back?.text ?? null} />
            </div>
          )}

          {/* A newly read card fills the profile in again from what it says. */}
          <div key={cardsRead} className="space-y-8">
            {/* what the reading suggested, to learn from what HR corrects (see learnCorrections) */}
            <ReadValues suggestions={card?.reading.suggestions} />
            <PersonalFields
              state={FRESH}
              fid={fid}
              part="profile"
              suggestions={card?.reading.suggestions}
              corrected={card?.reading.corrected}
              emailDomain={emailDomain}
            />
            <fieldset className="space-y-5">
              <legend className="font-semibold">
                National ID <span className="badge ml-2 bg-line-soft align-middle text-muted">Restricted</span>
              </legend>
              <NationalIdFields state={FRESH} fid={fid} suggestions={card?.reading.suggestions} corrected={card?.reading.corrected} />
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
          <div>
            <h2 {...heading(3)}>Education</h2>
            <p className="mt-1 text-sm text-muted">
              Anything left empty can be added on the profile later. After saving, add the employment (team, job title, join date) on the profile,
              and the bank details.
            </p>
          </div>
          <FormErrors errors={state.errors} />
          <PersonalFields state={FRESH} fid={fid} part="education" />

          {step === 3 && (
            <div className="flex flex-wrap gap-3 border-t border-line pt-6">
              <SubmitButton pendingText="Saving the profile…" busy={saving}>
                Save profile
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
