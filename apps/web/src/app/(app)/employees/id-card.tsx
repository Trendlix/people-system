'use client';

import { DateInput } from '@/components/date-time-inputs';
import { valueOf } from '@/components/form';
import { formatDate } from '@/lib/format';
import type { EmployeeIdentity, FormState, IdCardScan, LearnedField } from '@/lib/types';
import { LEARNED_FIELDS, readKey } from './paperwork';

// The national ID card pieces shared by the Add employee page and the National ID edit page: the national ID fields,
// the note on each field filled in from the card, what reading the card found, and the text read from it.

/** What was read from an ID card. Dates are YYYY-MM-DD. */
export type CardSuggestions = IdCardScan['suggestions'];

export const FROM_CARD = 'Read from the card — check before saving.';
/** On a field the reading filled in and a fix learned from HR's earlier corrections changed. */
export const FIXED = 'Fixed from an earlier correction — check before saving.';

/**
 * Marks the fields filled in from the ID card: `read` says whether the card gave a field, `describedBy` gives the ids
 * describing it (its own hint, if any, and the note), `noteText` is what the note says (`corrected`: the fields a learned
 * fix changed), and `note` is the note to show under it.
 */
export function cardMarks(fid: (name: string) => string, suggestions: CardSuggestions = {}, corrected: readonly string[] = []) {
  const read = (key: string) => (suggestions as Record<string, string | undefined>)[key] !== undefined;
  const noteText = (key: string) => (corrected.includes(key) ? FIXED : FROM_CARD);
  return {
    read,
    noteText,
    describedBy: (key: string, hint?: string) => [hint, read(key) ? fid(`${key}-card`) : undefined].filter(Boolean).join(' ') || undefined,
    note: (key: string) =>
      read(key) && (
        <p id={fid(`${key}-card`)} className="hint text-warn">
          {noteText(key)}
        </p>
      ),
  };
}

/**
 * How many details reading the card found, and what to do next; then `notes`: what was left out and why (e.g. a number
 * the edge of the picture cuts through), for HR to type in from the card.
 */
export function CardReadStatus({ suggestions, notes = [] }: { suggestions: CardSuggestions; notes?: string[] }) {
  const found = Object.keys(suggestions).length;
  return (
    <div role="status" className="space-y-2">
      <p className={`rounded-lg px-4 py-3 text-sm ${found ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'}`}>
        {found
          ? `${found} ${found === 1 ? 'detail was' : 'details were'} read from the card and filled in below. Check each one against the card before saving.`
          : 'Nothing could be read from the card with confidence. Fill in the details by hand, or try a sharper photo or scan.'}
      </p>
      {notes.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What the reading suggested for the fields whose corrections are learned, sent with the form (never in a URL): after
 * the save, the server compares them with what was saved (POST /id-card/corrections).
 */
export function ReadValues({ suggestions = {} }: { suggestions?: CardSuggestions }) {
  return LEARNED_FIELDS.map((field: LearnedField) =>
    suggestions[field] ? <input key={field} type="hidden" name={readKey(field)} value={suggestions[field]} /> : null,
  );
}

function CardText({ title, text }: { title: string; text: string | null }) {
  if (!text) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-muted">{title}</p>
      <pre lang="ar" dir="auto" className="mt-1 text-xs whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  );
}

/** The text read from each side of the card, folded away, to check the details against. */
export function CardTextDetails({ front, back }: { front: string | null; back: string | null }) {
  if (!front && !back) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-semibold">Text read from the card</summary>
      <div className="mt-2 space-y-3 rounded-lg bg-canvas p-3">
        <CardText title="Front" text={front} />
        <CardText title="Back" text={back} />
      </div>
    </details>
  );
}

/**
 * The national ID details: number, printed number, issue and expiry dates, issuing office. They start with what the
 * card says (`suggestions`, marked for checking), else the saved `identity`.
 */
export function NationalIdFields({
  state,
  fid,
  identity,
  suggestions = {},
  corrected,
}: {
  state: FormState;
  fid: (name: string) => string;
  identity?: EmployeeIdentity;
  suggestions?: CardSuggestions;
  /** The suggestions a fix learned from HR's earlier corrections changed. */
  corrected?: readonly string[];
}) {
  const s = suggestions;
  const card = cardMarks(fid, s, corrected);

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div>
        <label htmlFor={fid('nationalId')} className="label">
          National ID number{' '}
          <span lang="ar" className="font-normal text-muted">
            (الرقم القومي)
          </span>
        </label>
        <input
          id={fid('nationalId')}
          name="nationalId"
          inputMode="numeric"
          autoComplete="off"
          maxLength={14}
          aria-describedby={card.describedBy('nationalId', fid('nationalId-hint'))}
          defaultValue={valueOf(state, 'nationalId', s.nationalId ?? identity?.nationalId)}
          className="input tabular-nums"
        />
        <p id={fid('nationalId-hint')} className="hint">
          14 digits. It must agree with the date of birth.
        </p>
        {card.note('nationalId')}
      </div>
      <div>
        <label htmlFor={fid('printedNo')} className="label">
          Printed number{' '}
          <span lang="ar" className="font-normal text-muted">
            (الرقم المطبوع)
          </span>
        </label>
        <input
          id={fid('printedNo')}
          name="printedNo"
          autoComplete="off"
          maxLength={20}
          aria-describedby={card.describedBy('printedNo')}
          defaultValue={valueOf(state, 'printedNo', s.printedNo ?? identity?.printedNo)}
          className="input tabular-nums"
        />
        {card.note('printedNo')}
      </div>
      <div>
        <label htmlFor={fid('issueDate')} className="label">
          Issue date
        </label>
        <DateInput
          id={fid('issueDate')}
          name="issueDate"
          aria-describedby={card.describedBy('issueDate')}
          defaultValue={valueOf(state, 'issueDate', formatDate(s.issueDate ?? identity?.issueDate))}
        />
        {card.note('issueDate')}
      </div>
      <div>
        <label htmlFor={fid('expiryDate')} className="label">
          Expiry date
        </label>
        <DateInput
          id={fid('expiryDate')}
          name="expiryDate"
          aria-describedby={card.describedBy('expiryDate')}
          defaultValue={valueOf(state, 'expiryDate', formatDate(s.expiryDate ?? identity?.expiryDate))}
        />
        {card.note('expiryDate')}
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={fid('issuingOffice')} className="label">
          Issuing office{' '}
          <span lang="ar" className="font-normal text-muted">
            (جهة الإصدار)
          </span>
        </label>
        <input
          id={fid('issuingOffice')}
          name="issuingOffice"
          lang="ar"
          dir="rtl"
          maxLength={150}
          aria-describedby={card.describedBy('issuingOffice')}
          defaultValue={valueOf(state, 'issuingOffice', s.issuingOffice ?? identity?.issuingOffice)}
          className="input"
        />
        {card.note('issuingOffice')}
      </div>
    </div>
  );
}
