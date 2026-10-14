'use client';

import { ROLES, type Role } from '@trendlix/shared';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { FormErrors, SubmitButton, useFieldIds, valueOf } from '@/components/form';
import { ROLE_LABELS } from '@/lib/roles';
import type { FormState } from '@/lib/types';

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** The ticked roles: what was just submitted (after a refusal), else the saved ones. */
function checkedRoles(state: FormState, saved: Role[]): Set<string> {
  if (!state.values) return new Set(saved);
  const typed = state.values.roles;
  return new Set(Array.isArray(typed) ? typed : typed ? [typed] : []);
}

function RoleFields({ checked, hint }: { checked: Set<string>; hint?: string }) {
  return (
    <fieldset>
      <legend className="label">Roles</legend>
      <div className="flex flex-wrap gap-2">
        {ROLES.map((role) => (
          <label
            key={role}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft"
          >
            <input type="checkbox" name="roles" value={role} defaultChecked={checked.has(role)} className="size-4 accent-accent" />
            {ROLE_LABELS[role]}
          </label>
        ))}
      </div>
      {hint && <p className="hint">{hint}</p>}
    </fieldset>
  );
}

// No look-alike characters (0/O, 1/l/I), so the password can be read out or typed from a message.
const PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A random password such as "Kp7m-Qx4z-Rt9w": 12 characters (about 70 bits) in groups of four, from the browser's secure random source. */
function generatePassword(): string {
  const chars = Array.from(crypto.getRandomValues(new Uint32Array(12)), (n) => PASSWORD_ALPHABET[n % PASSWORD_ALPHABET.length]);
  return [0, 4, 8].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

/** A temporary password the admin types or generates and passes on, so it is shown as typed. */
function TemporaryPassword({ id, label }: { id: string; label: string }) {
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false); // the clipboard can be blocked; the password is still on screen to copy by hand
    }
  }

  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={id}
          name="password"
          type="text"
          required
          minLength={10}
          maxLength={200}
          autoComplete="off"
          spellCheck={false}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setCopied(false);
          }}
          aria-describedby={`${id}-hint`}
          className="input min-w-0 flex-1 font-mono"
        />
        <button
          type="button"
          onClick={() => {
            setPassword(generatePassword());
            setCopied(false);
          }}
          className="btn btn-secondary"
        >
          Generate
        </button>
        <button type="button" onClick={copy} disabled={!password} className="btn btn-secondary">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p id={`${id}-hint`} className="hint">
        At least 10 characters, or press Generate. Pass it on to the person yourself; they should change it after signing in
        (Change password, at the top of every page).
      </p>
      <p aria-live="polite" className="sr-only">
        {copied ? 'Password copied.' : ''}
      </p>
    </div>
  );
}

function Saved({ state }: { state: FormState }) {
  if (!state.message) return null;
  return (
    <p role="status" className="text-sm text-ok">
      {state.message}
    </p>
  );
}

export function NewUserForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, {});
  const fid = useFieldIds();
  return (
    <form action={formAction} className="card max-w-xl space-y-5 p-6">
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('email')} className="label">
          Email
        </label>
        <input
          id={fid('email')}
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="off"
          aria-describedby={fid('email-hint')}
          defaultValue={valueOf(state, 'email')}
          className="input"
        />
        <p id={fid('email-hint')} className="hint">
          They sign in with this email. Use their work email, so the account is linked to their employee record.
        </p>
      </div>
      <TemporaryPassword id={fid('password')} label="Temporary password" />
      <RoleFields checked={checkedRoles(state, ['employee'])} hint="Everyone who works here is an Employee; add the other roles they need." />
      <div className="flex flex-wrap gap-3">
        <SubmitButton>Create user</SubmitButton>
        <Link href="/users" className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}

export function RolesForm({ action, roles, self }: { action: Action; roles: Role[]; self: boolean }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="card max-w-xl space-y-5 p-6">
      <h3 className="font-semibold">Roles</h3>
      <FormErrors errors={state.errors} />
      <RoleFields
        checked={checkedRoles(state, roles)}
        hint={self ? 'This is your own account: you cannot remove your own Admin role.' : 'Changes apply straight away, even if they are signed in.'}
      />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>Save roles</SubmitButton>
        <Saved state={state} />
      </div>
    </form>
  );
}

export function StatusForm({ action, active, email }: { action: Action; active: boolean; email: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const question = `Deactivate ${email}? They are signed out at once and cannot sign in until an admin reactivates the account.`;
        if (active && !window.confirm(question)) e.preventDefault();
      }}
      className="space-y-3"
    >
      <FormErrors errors={state.errors} />
      <input type="hidden" name="isActive" value={active ? 'false' : 'true'} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={`btn ${active ? 'btn-danger' : 'btn-primary'}`}>
          {pending ? 'Saving…' : active ? 'Deactivate user' : 'Reactivate user'}
        </button>
        <Saved state={state} />
      </div>
    </form>
  );
}

export function PasswordForm({ action, email }: { action: Action; email: string }) {
  const [state, formAction] = useActionState(action, {});
  const fid = useFieldIds();
  return (
    <form action={formAction} className="card max-w-xl space-y-5 p-6">
      <div>
        <h3 className="font-semibold">Set a new temporary password</h3>
        <p className="mt-1 text-sm text-muted">For when {email} has forgotten their password. The old one stops working at once.</p>
      </div>
      <FormErrors errors={state.errors} />
      <TemporaryPassword id={fid('password')} label="New temporary password" />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>Set password</SubmitButton>
        <Saved state={state} />
      </div>
    </form>
  );
}
