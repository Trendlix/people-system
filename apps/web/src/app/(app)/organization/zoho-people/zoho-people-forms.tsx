'use client';

import { ZOHO_PEOPLE_MAX_MONTHS, zohoDurationText, zohoEstimateText, type ZohoPeopleConnectionView, type ZohoPeopleTestView, type ZohoRunView } from '@trendlix/shared';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import { formatDate, formatDateTime } from '@/lib/format';
import type { FormState } from '@/lib/types';
import {
  runPercent,
  runProgressText,
  runWaitingText,
  typedDay,
  typedRangeDays,
  zohoConnectionText,
  zohoPersonOptions,
  zohoTestText,
  zohoWithChosen,
  type ZohoChoosable,
} from '@/lib/zoho-people';
import type { ZohoTestState } from './actions';

// Organization → Zoho People's forms (owner, 25 October 2026: "can i fetch checkin and out transactions from zoho people
// through api?"; asked, "Yes, daily + backfill"; then "but can it fetch historical data?"): the connection with its
// buttons (Connect Zoho People, Test, Disconnect: a Super Admin's), Fetch from Zoho (HR's and a Super Admin's: the days,
// everyone or the people chosen, and how long it takes at the rate Zoho is called), and the run going now, its progress
// read again every few seconds until it is done, with Cancel. Never a token: the API answers the status only.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;
type TestAction = (prev: ZohoTestState, fd: FormData) => Promise<ZohoTestState>;

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

/** Test: today's attendance read now for the connected account, and a colleague's when one is written. */
function TestForm({ action, last }: { action: TestAction; last: ZohoPeopleTestView | null }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const shown = state.test ?? last;
  return (
    <form action={formAction} className="space-y-2">
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 sm:max-w-xs">
          <label htmlFor={fid('email')} className="label">
            A colleague’s work email <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id={fid('email')} name="email" type="email" autoComplete="off" maxLength={254} placeholder="name@trendlix.com" aria-describedby={fid('email-hint')} className="input" />
        </div>
        <button type="submit" disabled={pending} className="btn btn-secondary">
          {pending ? 'Testing…' : 'Test'}
        </button>
      </div>
      <p id={fid('email-hint')} className="hint">
        Reads today’s check-ins in Zoho People for the connected account, and for the colleague written here: how many there are, never kept.
      </p>
      {shown && !pending && (
        <p role="status" className={`text-sm ${shown.ok ? 'text-ok' : 'text-danger'}`}>
          {zohoTestText(shown, formatDateTime)}
        </p>
      )}
    </form>
  );
}

/** The Zoho account: connected as whom, or why it needs connecting again; Connect, Test and Disconnect. */
export function ZohoConnection({
  connection,
  canConnect,
  cannotConnect,
  connect,
  disconnect,
  test,
}: {
  connection: ZohoPeopleConnectionView | null;
  canConnect: boolean;
  cannotConnect: string;
  connect: Action;
  disconnect: Action;
  test: TestAction;
}) {
  const reconnect = connection?.status === 'needs_reconnecting';
  return (
    <div className="space-y-3">
      <p role="status" className={`text-sm font-semibold break-words ${!connection ? 'text-muted' : reconnect ? 'text-warn' : 'text-ok'}`}>
        {zohoConnectionText(connection, formatDateTime)}
      </p>
      <div className="flex flex-wrap items-start gap-2">
        {(!connection || reconnect) && <ActionForm action={connect} label={reconnect ? 'Connect again' : 'Connect Zoho People'} pendingLabel="Opening the sign-in…" kind="primary" disabled={!canConnect} />}
        {connection && (
          <ActionForm
            action={disconnect}
            label="Disconnect"
            pendingLabel="Disconnecting…"
            confirm="Disconnect Zoho People? Nothing is fetched from it, nightly or by Fetch from Zoho, until it is connected again. The days fetched so far stay."
          />
        )}
      </div>
      {connection && !reconnect && <TestForm action={test} last={connection.lastTest} />}
      {!canConnect && (!connection || reconnect) && <p className="text-sm text-muted">{cannotConnect}</p>}
    </div>
  );
}

/**
 * Fetch from Zoho: the first and the last day (up to yesterday, 12 months at most), everyone or the people chosen (each
 * a chip, × to take them off), and how long it takes at 60 calls a minute: one call a person and day.
 */
export function FetchForm({
  action,
  people,
  everyone,
  yesterday,
  blocked,
}: {
  action: Action;
  people: readonly ZohoChoosable[] | null;
  /** Those with a current employment now: everyone, before the former employees of the days chosen. */
  everyone: number;
  yesterday: string;
  /** Why it can't be started now (another fetch going, not connected), or null. */
  blocked: string | null;
}) {
  const fid = useFieldIds();
  const { state, pending, form } = useKeptForm(action);
  const [who, setWho] = useState<'everyone' | 'chosen'>('everyone');
  const [chosen, setChosen] = useState<string[]>([]);
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: yesterday });
  const names = new Map((people ?? []).map((p) => [p.id, p.name]));
  const options = zohoPersonOptions(people ?? [], chosen);
  const days = typedRangeDays(range.from, range.to);
  const count = who === 'everyone' ? everyone : chosen.length;
  return (
    <form
      {...form}
      onChange={(e) => {
        const f = e.currentTarget;
        const read = (name: string) => typedDay((f.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '');
        setRange({ from: read('from'), to: read('to') });
      }}
      className="space-y-4"
    >
      <FormErrors errors={state.errors} />
      <div className="grid gap-4 sm:max-w-xl sm:grid-cols-2">
        <div>
          <label htmlFor={fid('from')} className="label">
            First day
          </label>
          <DateInput id={fid('from')} name="from" defaultValue={valueOf(state, 'from', '')} aria-describedby={fid('range-hint')} />
        </div>
        <div>
          <label htmlFor={fid('to')} className="label">
            Last day
          </label>
          <DateInput id={fid('to')} name="to" defaultValue={valueOf(state, 'to', formatDate(yesterday))} aria-describedby={fid('range-hint')} />
        </div>
      </div>
      <p id={fid('range-hint')} className="hint -mt-2">
        Up to yesterday ({formatDate(yesterday)}): today’s check-ins are fetched tonight. {ZOHO_PEOPLE_MAX_MONTHS} months at most at a time.
      </p>
      <fieldset className="space-y-2">
        <legend className="label">Whose</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <label className="inline-flex min-h-11 items-center gap-2">
            <input type="radio" name="who" value="everyone" checked={who === 'everyone'} onChange={() => setWho('everyone')} />
            Everyone employed in those days, former employees too
          </label>
          <label className="inline-flex min-h-11 items-center gap-2">
            <input type="radio" name="who" value="chosen" checked={who === 'chosen'} onChange={() => setWho('chosen')} />
            Chosen people
          </label>
        </div>
      </fieldset>
      {who === 'chosen' && (
        <div className="space-y-2">
          {people === null ? (
            <p className="text-sm text-muted">The people couldn’t be loaded. Reload the page, or fetch everyone.</p>
          ) : (
            <div className="sm:max-w-xl">
              <label htmlFor={fid('person')} className="label">
                Person
              </label>
              <Select id={fid('person')} value="" onChange={(e) => setChosen((c) => zohoWithChosen(c, e.target.value))} aria-describedby={fid('person-hint')} className="input">
                <option value="">{options.length ? 'Choose a person…' : 'No one else to choose'}</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <p id={fid('person-hint')} className="hint">
                Type a name or a code to search. Choose several; former employees are marked.
              </p>
            </div>
          )}
          {chosen.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Chosen to fetch">
              {chosen.map((id) => (
                <li key={id} className="inline-flex items-center gap-0.5 rounded-full border border-accent/40 bg-accent-soft py-0.5 ps-2.5 pe-0.5 text-xs font-medium text-accent">
                  {names.get(id) ?? id}
                  <input type="hidden" name="employeeId" value={id} />
                  <button
                    type="button"
                    onClick={() => setChosen((c) => c.filter((x) => x !== id))}
                    aria-label={`Take ${names.get(id) ?? 'this person'} off the list`}
                    className="inline-flex size-6 items-center justify-center rounded-full hover:bg-white"
                  >
                    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-3">
                      <path d="M5 5l10 10M15 5L5 15" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p aria-live="polite" className="text-sm text-muted">
        {days !== null && count > 0
          ? `${zohoEstimateText(count, days)}.${who === 'everyone' ? ' Former employees employed in those days add to it.' : ''} It goes on in the background: this page can be closed.`
          : 'Choose the days to see how long it takes: Zoho is called 60 times a minute, once for each person and day.'}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton busy={pending} disabled={!!blocked || (who === 'chosen' && !chosen.length)} pendingText="Starting…">
          Fetch from Zoho
        </SubmitButton>
        {blocked && <p className="text-sm text-muted">{blocked}</p>}
        {state.message && !state.errors && !pending && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

/** How often the page reads the run going again, in milliseconds. */
const POLL_MS = 8000;

const clock = (iso: string) => formatDateTime(iso).split(', ')[1] ?? formatDateTime(iso);

/**
 * The run going now: its progress (calls made of those it makes, people done), about how long is left, Zoho asking to
 * wait, and Cancel. The page is read again every few seconds while it runs (only while the tab is in sight), so the
 * counts move and, once done, it shows under Last Runs.
 */
export function RunProgress({ run, cancel }: { run: ZohoRunView; cancel: Action | null }) {
  const router = useRouter();
  const running = run.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, router]);
  const percent = runPercent(run);
  const waiting = runWaitingText(run, clock);
  return (
    <div className="space-y-3">
      <div
        role="progressbar"
        aria-label="Fetched so far"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2.5 w-full max-w-xl overflow-hidden rounded-full bg-line-soft"
      >
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-sm tabular-nums">{runProgressText(run)}</p>
      <p className="text-sm text-muted">
        {run.cancelRequested
          ? 'Cancelling: it stops after the call it is making.'
          : run.minutesLeft !== null
            ? `${titleFirst(zohoDurationText(run.minutesLeft))} left at 60 calls a minute.`
            : 'Working out how long is left…'}
      </p>
      {waiting && (
        <p role="status" className="text-sm text-warn">
          {waiting}
        </p>
      )}
      {cancel && !run.cancelRequested && (
        <ActionForm action={cancel} label="Cancel" pendingLabel="Cancelling…" confirm="Cancel this fetch? The days fetched so far stay; the rest isn’t fetched." />
      )}
    </div>
  );
}

const titleFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
