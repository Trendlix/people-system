'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { LocationsMap } from '@/components/map/maps';
import type { CheckInLocationView } from '@/lib/attendance-types';
import { formatDate, titleCase } from '@/lib/format';
import { googleMapsHref, type MapCircle } from '@/lib/map-point';
import type { FormState } from '@/lib/types';
import { LocationForm } from './location-form';
import { clientEndText, clientShownAsText, endClientConfirm, withinText } from './setup';

// A client location on Organization → Check-in Setup (owner, 24 October 2026: "location to be allowed only to the requested
// employee not all of them if home or remote, all employees if a customer location"): made by the CEO's approval of an
// employee's request, it is everyone's. Its card: a small map, its name and radius, how a check-in there shows ("Client ·
// Acme"), how long it lasts (a date, no end, or ended) and whether it counts today, the request it came from; Edit (its
// name, point and radius, as any location), its end changed (a date or no end), and End now, asked first. Never the main
// office, never linked to people. HR and Admin keep it; the API checks every request.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** Its end changed: no end, or until a date (DD/MM/YYYY). */
function EndForm({ location: l, action, onSaved, onCancel }: { location: CheckInLocationView; action: Action; onSaved: (message: string) => void; onCancel: () => void }) {
  const fid = useFieldIds();
  // once saved, the form closes and the card says so
  const { state, pending, form } = useKeptForm(async (prev, fd) => {
    const result = await action(prev, fd);
    if (result.message && !result.errors?.length) onSaved(result.message);
    return result;
  });
  const [ends, setEnds] = useState<'no_end' | 'until_date'>(l.validUntil ? 'until_date' : 'no_end');
  return (
    <form {...form} className="space-y-3 rounded-lg border border-line-soft bg-canvas p-3">
      <FormErrors errors={state.errors} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">How long it lasts</legend>
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input type="radio" name="ends" value="no_end" checked={ends === 'no_end'} onChange={() => setEnds('no_end')} className="accent-accent" />
          No end, until HR ends it
        </label>
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input type="radio" name="ends" value="until_date" checked={ends === 'until_date'} onChange={() => setEnds('until_date')} className="accent-accent" />
          Until a date
        </label>
      </fieldset>
      {ends === 'until_date' && (
        <div>
          <label htmlFor={fid('validUntil')} className="label">
            Its last day
          </label>
          <DateInput id={fid('validUntil')} name="validUntil" defaultValue={valueOf(state, 'validUntil', formatDate(l.validUntil ?? null))} aria-describedby={fid('until-hint')} />
          <p id={fid('until-hint')} className="hint">
            Check-ins within it count to the end of this day. HR is told 7 days before.
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <SubmitButton busy={pending}>Save</SubmitButton>
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ClientLocationCard({
  location: l,
  others,
  update,
  saveEnd,
  end,
}: {
  location: CheckInLocationView;
  /** The other locations, drawn faintly on its form's map while it is edited. */
  others: readonly MapCircle[];
  update: Action;
  saveEnd: Action;
  end: () => Promise<FormState>;
}) {
  const [editing, setEditing] = useState<'place' | 'end' | null>(null);
  const [said, setSaid] = useState<FormState>({});
  const [pending, start] = useTransition();
  const nameId = `client-location-${l.id}`;
  const ended = !!l.endedAt;
  const counts = l.inForce !== false && !ended;

  if (editing === 'place') {
    return (
      <li aria-labelledby={nameId} className="col-span-full space-y-4 rounded-xl border border-line bg-card p-5 shadow-sm">
        <h4 id={nameId} className="font-semibold">
          Edit {titleCase(l.name)}
        </h4>
        <LocationForm
          action={update}
          location={l}
          around={others}
          namePlaceholder="Acme Cairo office"
          submitLabel="Save location"
          onSaved={(message) => {
            setEditing(null);
            setSaid({ message });
          }}
          onCancel={() => setEditing(null)}
        />
      </li>
    );
  }

  return (
    <li aria-labelledby={nameId} aria-busy={pending || undefined} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-card shadow-sm">
      <div className={`p-2 pb-0 ${counts ? '' : 'opacity-60'}`}>
        <LocationsMap
          circles={[{ latitude: l.latitude, longitude: l.longitude, radiusMetres: l.radiusMetres }]}
          label={`Map of the client location ${l.name}: its point and the ${l.radiusMetres.toLocaleString('en-US')} m around it`}
          height="h-[140px]"
        />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0 space-y-1">
          <h4 id={nameId} className="flex flex-wrap items-center gap-2 text-base font-semibold break-words">
            {titleCase(l.name)}
            <span className={`badge ${counts ? 'bg-ok-soft text-ok' : 'bg-line-soft text-muted'}`}>{counts ? 'Counts today' : 'Ended'}</span>
          </h4>
          <p className="text-sm text-muted">
            <span className="tabular-nums">{withinText(l.radiusMetres)}</span> ·{' '}
            <a href={googleMapsHref(l)} target="_blank" rel="noopener noreferrer">
              See it on a map<span className="sr-only"> ({l.name}, opens in a new tab)</span>
            </a>
          </p>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            Shows as <span className="badge max-w-full truncate">{clientShownAsText(l.name)}</span> for everyone
          </p>
          <p className="text-sm tabular-nums">{clientEndText(l)}</p>
          {l.requestId && (
            <p className="text-sm">
              <Link href={`/home-locations/${encodeURIComponent(l.requestId)}`}>
                Open its request<span className="sr-only"> for {l.name}</span>
              </Link>
            </p>
          )}
        </div>
        {editing === 'end' && (
          <EndForm
            location={l}
            action={saveEnd}
            onSaved={(message) => {
              setEditing(null);
              setSaid({ message });
            }}
            onCancel={() => setEditing(null)}
          />
        )}
        <div aria-live="polite" className="empty:hidden">
          {said.errors?.length ? <FormErrors errors={said.errors} /> : said.message ? <p className="text-sm text-ok">{said.message}</p> : null}
        </div>
        {!ended && editing === null && (
          <div className="mt-auto flex flex-wrap gap-2 border-t border-line-soft pt-3">
            <button
              type="button"
              onClick={() => {
                setSaid({});
                setEditing('place');
              }}
              className="btn btn-secondary"
            >
              Edit<span className="sr-only"> {l.name}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSaid({});
                setEditing('end');
              }}
              className="btn btn-secondary"
            >
              Change its end<span className="sr-only">: {l.name}</span>
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm(endClientConfirm(l.name))) start(async () => setSaid(await end()));
              }}
              className="btn btn-danger"
            >
              {pending ? 'Ending…' : 'End now'}
              <span className="sr-only">: {l.name}</span>
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
