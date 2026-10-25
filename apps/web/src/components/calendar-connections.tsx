'use client';

import type { CalendarConnectionView, CalendarTestView } from '@trendlix/shared';
import { useActionState } from 'react';
import { FormErrors, useFieldIds } from '@/components/form';
import { calendarConnectionText, calendarTestText } from '@/lib/calendars';
import { formatDateTime } from '@/lib/format';
import type { FormState } from '@/lib/types';

// A calendar connection with its buttons (owner, 25 October 2026: "Hours + calendar"; "its zoho mails"): the company's
// Zoho on Organization → Calendars, one's own on Your Interview Hours. Connected as whom and since when, or why it needs
// reconnecting; Connect (the provider's sign-in) or Connect again; Check the busy times (read now, how many said, never
// what they are); and Disconnect. Never a token: the API answers the status only. Read only (`readOnly`, the buttons
// disabled) while a Super Admin views as the person without Act as them (owner, 25 October 2026).

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** What "Check the busy times" answers: its result, or why it couldn't run. */
export interface CalendarTestState extends FormState {
  test?: CalendarTestView;
}

type TestAction = (prev: CalendarTestState, fd: FormData) => Promise<CalendarTestState>;

/** A button doing one thing, with the API's reason if refused; `confirm`: asked first. */
function ActionForm({ action, label, pendingLabel, kind = 'secondary', confirm, disabled = false }: { action: Action; label: string; pendingLabel: string; kind?: 'primary' | 'secondary'; confirm?: string; disabled?: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="space-y-2"
    >
      <FormErrors errors={state.errors} />
      <button type="submit" disabled={pending || disabled} className={`btn btn-${kind}`}>
        {pending ? pendingLabel : label}
      </button>
      {state.message && !pending && (
        <p role="status" className="text-sm text-ok">
          {state.message}
        </p>
      )}
    </form>
  );
}

/** "Check the busy times": read now; `withEmail`, the company's, may check a colleague's by their work email. */
function TestForm({ action, last, withEmail, disabled = false }: { action: TestAction; last: CalendarTestView | null; withEmail: boolean; disabled?: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const shown = state.test ?? last;
  return (
    <form action={formAction} className="space-y-2">
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap items-end gap-2">
        {withEmail && (
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <label htmlFor={fid('email')} className="label">
              A colleague’s work email <span className="font-normal text-muted">(optional)</span>
            </label>
            <input id={fid('email')} name="email" type="email" autoComplete="off" maxLength={254} placeholder="name@trendlix.com" aria-describedby={fid('email-hint')} className="input" />
          </div>
        )}
        <button type="submit" disabled={pending || disabled} className="btn btn-secondary">
          {pending ? 'Checking…' : 'Check the busy times'}
        </button>
      </div>
      {withEmail && (
        <p id={fid('email-hint')} className="hint">
          Left empty, the connected account’s own are checked. Only how many busy times there are is said, never what they are.
        </p>
      )}
      {shown && !pending && (
        <p role="status" className={`text-sm ${shown.ok ? 'text-ok' : 'text-danger'}`}>
          {calendarTestText(shown, formatDateTime)}
        </p>
      )}
    </form>
  );
}

export function CalendarConnection({
  connection,
  connect,
  connectLabel = 'Connect',
  canConnect = true,
  cannotConnect,
  disconnect,
  disconnectConfirm,
  test,
  testWithEmail = false,
  readOnly = false,
}: {
  connection: CalendarConnectionView | null;
  connect: Action;
  connectLabel?: string;
  canConnect?: boolean;
  /** Said under Connect while it can't be used, e.g. the app's credentials not saved yet. */
  cannotConnect?: string;
  disconnect: Action;
  disconnectConfirm: string;
  test: TestAction;
  testWithEmail?: boolean;
  /** Shown, never changed: every button disabled. */
  readOnly?: boolean;
}) {
  const reconnect = connection?.status === 'needs_reconnecting';
  return (
    <div className="space-y-3">
      {connection ? (
        <p role="status" className={`text-sm font-semibold break-words ${reconnect ? 'text-warn' : 'text-ok'}`}>
          {calendarConnectionText(connection, formatDateTime)}
        </p>
      ) : (
        <p className="text-sm text-muted">Not connected.</p>
      )}
      <div className="flex flex-wrap items-start gap-2">
        {(!connection || reconnect) && (
          <ActionForm action={connect} label={reconnect ? 'Connect again' : connectLabel} pendingLabel="Opening the sign-in…" kind="primary" disabled={!canConnect || readOnly} />
        )}
        {connection && <ActionForm action={disconnect} label="Disconnect" pendingLabel="Disconnecting…" confirm={disconnectConfirm} disabled={readOnly} />}
      </div>
      {connection && !reconnect && <TestForm action={test} last={connection.lastTest} withEmail={testWithEmail} disabled={readOnly} />}
      {!canConnect && cannotConnect && (!connection || reconnect) && <p className="text-sm text-muted">{cannotConnect}</p>}
    </div>
  );
}
