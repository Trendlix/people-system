'use client';

import Link from 'next/link';
import { startTransition, useActionState, useEffect, useRef } from 'react';
import { FormErrors, SubmitButton, useFieldIds, valueOf } from '@/components/form';
import type { EmployeeProfile, FormState } from '@/lib/types';
import { fieldTexts } from '../../confirmation';
import { PersonalFields } from '../../personal-fields';

/**
 * The employee's details as HR's Personal Details and Education pages show them (the same fields, phone inputs,
 * university and faculty lists and proposed Arabic qualification), filled in with what is on file, and the employee's
 * note. Only what changed is asked for: the fields as the form first showed them go with it (`start`), and the server
 * action compares. The employee code and the work email are the company's (the work email goes with the sign-in
 * account): shown read-only, never asked for.
 */
export function ChangeForm({
  action,
  employee,
  cancelHref,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  employee: EmployeeProfile;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const formRef = useRef<HTMLFormElement>(null);
  // As the fields first show the saved values (dates as DD/MM/YYYY, mobiles as kept, a proposed qualification…).
  const start = useRef<string | null>(null);
  useEffect(() => {
    if (start.current === null && formRef.current) start.current = JSON.stringify(fieldTexts(new FormData(formRef.current)));
  }, []);

  // Sent by hand, like useKeptForm: React leaves the form as it is when a request is refused (no reset of the selects).
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (start.current) fd.set('start', start.current);
    startTransition(() => formAction(fd));
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} className="card max-w-3xl space-y-8 p-6">
      <fieldset className="space-y-5">
        <legend className="font-semibold">Set by the Company</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          {/* no name: never sent */}
          <div>
            <label htmlFor={fid('code-shown')} className="label">
              Employee code
            </label>
            <input id={fid('code-shown')} value={employee.employeeCode} readOnly className="input bg-canvas text-muted tabular-nums" />
          </div>
          <div>
            <label htmlFor={fid('email-shown')} className="label">
              Work email
            </label>
            <input
              id={fid('email-shown')}
              value={employee.workEmail ?? ''}
              placeholder="Not set"
              readOnly
              aria-describedby={fid('email-shown-hint')}
              className="input bg-canvas text-muted"
            />
            <p id={fid('email-shown-hint')} className="hint">
              Set by the company; ask HR to change it.
            </p>
          </div>
        </div>
      </fieldset>

      {/* The same two as fields to change are hidden: the server action never asks for them (REQUESTABLE_FIELD_KEYS). */}
      <div className="space-y-8 [&_div:has(>input[name=employeeCode])]:hidden [&_div:has(>input[name=workEmail])]:hidden">
        <PersonalFields state={state} fid={fid} employee={employee} />
      </div>

      <div className="space-y-5 border-t border-line pt-6">
        <div>
          <label htmlFor={fid('note')} className="label">
            What should change and why
          </label>
          <textarea
            id={fid('note')}
            name="note"
            rows={3}
            required
            maxLength={1000}
            aria-describedby={fid('note-hint')}
            defaultValue={valueOf(state, 'note')}
            className="input"
          />
          <p id={fid('note-hint')} className="hint">
            You can attach proof by giving it to HR.
          </p>
        </div>
        {/* by the button, where the request is sent from: the form is long */}
        <FormErrors errors={state.errors} />
        <div className="flex flex-wrap gap-3">
          <SubmitButton busy={pending} pendingText="Sending…">
            Send to HR
          </SubmitButton>
          <Link href={cancelHref} className="btn btn-secondary">
            Cancel
          </Link>
        </div>
      </div>
    </form>
  );
}
