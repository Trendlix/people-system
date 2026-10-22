'use client';

import { useRef, useState } from 'react';
import { emailHint, EMAIL_PROBLEM, RECRUITMENT_LIMITS } from '@trendlix/shared';
import { yearsSuffix, yearsTyped } from '@/lib/number-typing';
import { fieldProblems, type CheckedField } from './careers';

// The careers forms' checked fields (owner, 22 October 2026, trying the form on an iPhone: "make the years of experience
// field only numbers, and you add years."; "validate email field"): the email, checked as it is left, with "Did you
// mean …@gmail.com?" for a common misspelling (a hint, never a block); the years with "years" after them inside the
// line; and the checks of the email, mobile, years and notice period before the form is sent, each said under its field
// and the first one wrong given the focus. In the careers look (careers.css: .careers-problem, .careers-suffixed).

type Said = Partial<Record<CheckedField, string>>;

/**
 * The checks of a form's email, mobile, years and notice period. `passes(form)` checks them all before sending (false:
 * they are said and the first gets the focus); `left` checks one as its box is left (not while it is empty); `typed`
 * takes a field's message away as it is changed. `ids(field)` are its box's aria props.
 */
export function useFieldChecks(fid: (name: string) => string, { yearsRequired }: { yearsRequired: boolean }) {
  const [said, setSaid] = useState<Said>({});
  const problemId = (field: CheckedField) => fid(`${field}-problem`);

  function passes(form: HTMLFormElement | null): boolean {
    if (!form) return true;
    const problems = fieldProblems(new FormData(form), { yearsRequired });
    setSaid(Object.fromEntries(problems.map((p) => [p.field, p.message])));
    if (!problems.length) return true;
    document.getElementById(fid(problems[0].field))?.focus();
    return false;
  }

  function left(field: CheckedField, box: HTMLElement): void {
    const form = box.closest('form');
    if (!form || !(box instanceof HTMLInputElement) || !box.value.trim()) return;
    const problem = fieldProblems(new FormData(form), { yearsRequired }).find((p) => p.field === field);
    setSaid((s) => ({ ...s, [field]: problem?.message }));
  }

  function typed(field: CheckedField): void {
    if (said[field]) setSaid((s) => ({ ...s, [field]: undefined }));
  }

  /** The email refused by the browser's own check (type="email"): said under it, as ours, in place of the browser's bubble. */
  function invalid(field: CheckedField, message: string, box: HTMLElement): void {
    setSaid((s) => ({ ...s, [field]: message }));
    box.focus();
  }

  const ids = (field: CheckedField) => ({ 'aria-invalid': said[field] ? true : undefined, 'aria-describedby': said[field] ? problemId(field) : undefined });

  return { said, passes, left, typed, invalid, ids, problemId };
}

export type FieldChecks = ReturnType<typeof useFieldChecks>;

/** A field's problem, under it. */
export function FieldProblem({ checks, field }: { checks: FieldChecks; field: CheckedField }) {
  const message = checks.said[field];
  if (!message) return null;
  return (
    <p id={checks.problemId(field)} className="careers-problem">
      {message}
    </p>
  );
}

/**
 * Around a checked field's boxes: checks it as its own box (`id`) is left, and takes its message away as it changes;
 * the message under them, then `below` (the email's hint).
 */
export function Checked({ checks, field, id, children, below }: { checks: FieldChecks; field: CheckedField; id: string; children: React.ReactNode; below?: React.ReactNode }) {
  return (
    <div
      onBlur={(e) => {
        if (e.target.id === id) checks.left(field, e.target);
      }}
      onChange={() => checks.typed(field)}
    >
      {children}
      <FieldProblem checks={checks} field={field} />
      {below}
    </div>
  );
}

/** The email: type="email" (the phone's keyboard with @), trimmed, checked as it is left, with the misspelling hint. */
export function EmailInput({ id, checks, defaultValue }: { id: string; checks: FieldChecks; defaultValue: string }) {
  const box = useRef<HTMLInputElement>(null);
  const [hint, setHint] = useState<string | null>(() => emailHint(defaultValue));
  const hintId = `${id}-hint`;
  const problem = checks.ids('email');
  const describedBy = [problem['aria-describedby'], hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  function use(address: string) {
    if (!box.current) return;
    box.current.value = address;
    setHint(null);
    checks.typed('email');
    box.current.focus();
  }

  return (
    <Checked
      checks={checks}
      field="email"
      id={id}
      below={
        hint && (
          <p id={hintId} className="careers-hint">
            Did you mean{' '}
            <button type="button" onClick={() => use(hint)} className="careers-hint-use">
              {hint}
            </button>
            ?
          </p>
        )
      }
    >
      <input
        ref={box}
        id={id}
        name="email"
        type="email"
        required
        maxLength={RECRUITMENT_LIMITS.email}
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        defaultValue={defaultValue}
        aria-invalid={problem['aria-invalid']}
        aria-describedby={describedBy}
        onChange={() => hint && setHint(null)}
        onBlur={(e) => {
          const trimmed = e.target.value.trim();
          if (trimmed !== e.target.value) e.target.value = trimmed;
          setHint(emailHint(trimmed));
        }}
        onInvalid={(e) => {
          e.preventDefault();
          checks.invalid('email', EMAIL_PROBLEM, e.currentTarget);
        }}
        className="input"
      />
    </Checked>
  );
}

/** The years of experience: digits and a point for a half, with "years" after them inside the line (not typed, not sent). */
export function YearsInput({ id, checks, required, defaultValue }: { id: string; checks: FieldChecks; required: boolean; defaultValue: string }) {
  const [v, setV] = useState(() => yearsTyped(defaultValue));
  const problem = checks.ids('yearsExperience');
  return (
    <Checked checks={checks} field="yearsExperience" id={id}>
      <div className="careers-suffixed" data-invalid={problem['aria-invalid']}>
        <input
          id={id}
          name="yearsExperience"
          inputMode="decimal"
          autoComplete="off"
          maxLength={4}
          required={required}
          {...problem}
          value={v}
          onChange={(e) => setV(yearsTyped(e.target.value))}
          className="input tabular-nums"
        />
        <span aria-hidden="true" className="careers-suffix">
          {yearsSuffix(v)}
        </span>
      </div>
    </Checked>
  );
}
