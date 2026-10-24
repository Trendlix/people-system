'use client';

import type { MeetingConnectionView, MeetingTestView } from '@trendlix/shared';
import { useActionState } from 'react';
import { FormErrors } from '@/components/form';
import { formatDateTime } from '@/lib/format';
import { connectionText, meetingTestText } from '@/lib/meetings';
import type { FormState } from '@/lib/types';

// A meetings connection with its buttons (owner, 24 October 2026: "make it both"): the company's on Organization →
// Meetings, one's own on Your Meetings. Connected as whom and since when, or why it needs reconnecting; Connect (the
// provider's sign-in) or Connect again; Create a test meeting (made and deleted at once, the result in plain words); and
// Disconnect. Never a token: the API answers the status only.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** What "Create a test meeting" answers: its result, or why it couldn't run. */
export interface MeetingTestState extends FormState {
  test?: MeetingTestView;
}

type TestAction = (prev: MeetingTestState, fd: FormData) => Promise<MeetingTestState>;

/** A button doing one thing, with the API's reason if refused; `confirm`: asked first. */
function ActionForm({ action, label, pendingLabel, kind = 'secondary', confirm, disabled = false }: { action: Action; label: string; pendingLabel: string; kind?: 'primary' | 'secondary' | 'danger'; confirm?: string; disabled?: boolean }) {
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

function TestButton({ action, last }: { action: TestAction; last: MeetingTestView | null }) {
  const [state, formAction, pending] = useActionState(action, {});
  const shown = state.test ?? last;
  return (
    <form action={formAction} className="space-y-2">
      <FormErrors errors={state.errors} />
      <button type="submit" disabled={pending} className="btn btn-secondary">
        {pending ? 'Creating a test meeting…' : 'Create a test meeting'}
      </button>
      {shown && !pending && (
        <p role="status" className={`text-sm ${shown.ok ? 'text-ok' : 'text-danger'}`}>
          {meetingTestText(shown, formatDateTime)}
        </p>
      )}
    </form>
  );
}

export function MeetingConnection({
  connection,
  connect,
  connectLabel,
  canConnect = true,
  cannotConnect,
  disconnect,
  disconnectConfirm,
  test,
}: {
  connection: MeetingConnectionView | null;
  /** The provider's sign-in (left out where the company's account is the host named, Microsoft's and Zoom's). */
  connect?: Action;
  connectLabel?: string;
  canConnect?: boolean;
  /** Said under Connect while it can't be used, e.g. the app's credentials not saved yet. */
  cannotConnect?: string;
  disconnect: Action;
  disconnectConfirm: string;
  test: TestAction;
}) {
  const reconnect = connection?.status === 'needs_reconnecting';
  return (
    <div className="space-y-3">
      {connection ? (
        <p role="status" className={`text-sm font-semibold break-words ${reconnect ? 'text-warn' : 'text-ok'}`}>
          {connectionText(connection, formatDateTime)}
        </p>
      ) : (
        <p className="text-sm text-muted">Not connected.</p>
      )}
      <div className="flex flex-wrap items-start gap-2">
        {connect && (!connection || reconnect) && (
          <ActionForm action={connect} label={reconnect ? 'Connect again' : (connectLabel ?? 'Connect')} pendingLabel="Opening the sign-in…" kind="primary" disabled={!canConnect} />
        )}
        {connection && !reconnect && <TestButton action={test} last={connection.lastTest} />}
        {connection && <ActionForm action={disconnect} label="Disconnect" pendingLabel="Disconnecting…" confirm={disconnectConfirm} />}
      </div>
      {connect && !canConnect && cannotConnect && <p className="text-sm text-muted">{cannotConnect}</p>}
    </div>
  );
}
