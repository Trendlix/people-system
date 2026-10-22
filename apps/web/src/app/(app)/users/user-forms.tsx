'use client';

import { ASSETS_ACCESS_HINTS, ASSETS_ACCESS_LABELS, ASSETS_ACCESS_LEVELS, DEVELOPER_CHOOSES_NOTE, type AssetsAccess, type Role } from '@trendlix/shared';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { FormErrors, SubmitButton, useFieldIds, valueOf } from '@/components/form';
import { ROLE_LABELS } from '@/lib/roles';
import type { FormState } from '@/lib/types';
import { ASSETS_VALUES_NOTE } from '../assets/assets';

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** The ticked roles: what was just submitted (after a refusal), else the saved ones. */
function checkedRoles(state: FormState, saved: Role[]): Set<string> {
  if (!state.values) return new Set(saved);
  const typed = state.values.roles;
  return new Set(Array.isArray(typed) ? typed : typed ? [typed] : []);
}

/**
 * A checkbox for each role in `choices`: every role for a Super Admin, all but Super Admin for an Admin (only a Super
 * Admin grants or removes it; the API refuses anyone else with 403).
 */
function RoleFields({ choices, checked, hint }: { choices: readonly Role[]; checked: Set<string>; hint?: string }) {
  return (
    <fieldset>
      <legend className="label">Roles</legend>
      <div className="flex flex-wrap gap-2">
        {choices.map((role) => (
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
      {choices.includes('super_admin') && (
        <p className="hint">Super Admin: everything an Admin can do, and the only role that can delete records.</p>
      )}
      {/* a developer who is also an employee (owner, 22 October 2026: "give hin a switched to use the account as the main
          role assigned to him or as a developer") */}
      {choices.includes('developer') && <p className="hint">Developer + Employee: {DEVELOPER_CHOOSES_NOTE}</p>}
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

export function NewUserForm({ action, choices }: { action: Action; choices: readonly Role[] }) {
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
          They sign in with this email. For someone who isn’t an employee: employees get their account by themselves, on their profile’s Access tab.
        </p>
      </div>
      <TemporaryPassword id={fid('password')} label="Temporary password" />
      <RoleFields
        choices={choices}
        checked={checkedRoles(state, ['employee'])}
        hint="Everyone who works here is an Employee; add the other roles they need."
      />
      <div className="flex flex-wrap gap-3">
        <SubmitButton>Create user</SubmitButton>
        <Link href="/users" className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}

/** `hint`: under the roles, e.g. that it is the user's own account. */
export function RolesForm({ action, roles, choices, hint }: { action: Action; roles: Role[]; choices: readonly Role[]; hint: string }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="card max-w-xl space-y-5 p-6">
      <h3 className="font-semibold">Roles</h3>
      <FormErrors errors={state.errors} />
      <RoleFields choices={choices} checked={checkedRoles(state, roles)} hint={hint} />
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
        <h3 className="font-semibold">Set a New Temporary Password</h3>
        <p className="mt-1 text-sm text-muted">
          For when {email} has forgotten their password. The old one stops working at once, and fingerprint sign-in on their
          phones is turned off too.
        </p>
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

/** Ends every session the user has open (20 October 2026: sessions kept on the server), after asking. */
export function EndSessionsForm({ action, email }: { action: Action; email: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`End every session of ${email}? They are signed out at once, on the website and in the app.`)) e.preventDefault();
      }}
      className="space-y-3"
    >
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-secondary">
          {pending ? 'Ending…' : 'End all sessions'}
        </button>
        <Saved state={state} />
      </div>
    </form>
  );
}

/**
 * Turns off fingerprint sign-in on every phone of the user's (owner, 20 October 2026: chose Face ID / fingerprint sign-in
 * for the app), after asking: each asks for the password next time.
 */
export function SignOutDevicesForm({ action, email }: { action: Action; email: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`Turn off fingerprint sign-in on every phone of ${email}? They sign in with their password there next time.`)) e.preventDefault();
      }}
      className="space-y-3"
    >
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-secondary">
          {pending ? 'Signing out…' : 'Sign out all devices'}
        </button>
        <Saved state={state} />
      </div>
    </form>
  );
}

/**
 * The user's Assets access (owner, 21 October 2026: "i want to add this module with a special permission to the system",
 * "3 levels per user"): one of the four levels, each with what it allows; the level in effect when it differs (a Super
 * Admin is always a manager; the CEO and Finance always at least viewers), and who sees the values ("CEO and Finance").
 */
export function AssetsAccessForm({ action, saved, inEffectNote }: { action: Action; saved: AssetsAccess; inEffectNote: string | null }) {
  const [state, formAction] = useActionState(action, {});
  const typed = state.values?.assetsAccess;
  const checked = typeof typed === 'string' ? typed : saved;
  return (
    <form action={formAction} className="card max-w-xl space-y-5 p-6">
      <div>
        <h3 className="font-semibold">Assets Access</h3>
        <p className="mt-1 text-sm text-muted">What they may do in Assets, the studio&apos;s asset register.</p>
      </div>
      <FormErrors errors={state.errors} />
      <fieldset>
        <legend className="sr-only">Assets access</legend>
        <div className="space-y-2">
          {ASSETS_ACCESS_LEVELS.map((level) => (
            <label
              key={level}
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-line bg-white px-3 py-2.5 text-sm has-checked:border-accent has-checked:bg-accent-soft"
            >
              <input type="radio" name="assetsAccess" value={level} defaultChecked={checked === level} className="mt-0.5 size-4 accent-accent" />
              <span>
                <span className="block font-medium">{ASSETS_ACCESS_LABELS[level]}</span>
                <span className="block text-xs text-muted">{ASSETS_ACCESS_HINTS[level]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {inEffectNote && <p className="rounded-lg bg-canvas px-3 py-2 text-sm">{inEffectNote}</p>}
      <p className="hint">{ASSETS_VALUES_NOTE}</p>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>Save Assets access</SubmitButton>
        <Saved state={state} />
      </div>
    </form>
  );
}

