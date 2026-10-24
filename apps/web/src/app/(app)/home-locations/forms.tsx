'use client';

import { useActionState, useMemo, useState, useSyncExternalStore } from 'react';
import {
  CHECK_IN_LOCATION_ERROR_LABELS,
  CLIENT_FOR_EVERYONE_TEXT,
  HOME_COMMENT_MAX,
  HOME_DECISIONS,
  HOME_LABEL_MAX,
  HOME_RADIUS_DEFAULT,
  HOME_RADIUS_MAX,
  HOME_RADIUS_MIN,
  HOME_TYPES,
  homeRadiusProblems,
  isHomeType,
  LOCATION_ASK_RADIUS_MAX,
  LOCATION_ASK_RADIUS_MIN,
  LOCATION_REASON_MAX,
  LOCATION_VALIDITY_LABELS,
  type HomeDecision,
  type HomeType,
  type LocationValidity,
} from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { PickPointMap } from '@/components/map/maps';
import { PlaceSearch } from '@/components/map/place-search';
import { SurfaceField } from '@/components/surface';
import { formatDate } from '@/lib/format';
import type { HomeLocationView } from '@/lib/home-location-types';
import { coordinateText, latin, roundCoordinate, type MapCircle, type Point } from '@/lib/map-point';
import { getPosition } from '@/lib/native';
import { REQUESTED_PLACE_KEY, takeRequestedPlace, type RequestedPlace } from '@/lib/requested-place';
import type { FormState } from '@/lib/types';
import { choice } from '../employees/[id]/contracts/pay-fields';
import { accuracyText } from '../my-attendance/check-in';
import { HOME_TYPE_HINTS, HOME_TYPE_LINES, homeDecisionButton, homeShownAs, homeTypeOf, radiusText, startingValidity, validityChoices } from './home-locations';
import { HomeMap } from './ui';

// The home locations' forms (owner, 20 October 2026: "allow other users to request to add their home locations when
// working from home"; then "Label Home, flag elsewhere", "then approved by the HR and CEO"): the employee's request (the
// point on the shared map, from a search or their current location with its accuracy, a label, the radius shown as 100
// m, which HR sets), each step's decision (HR's with the radius, its circle following what is typed), withdrawing a
// request and removing an approved home. Each sends its server action; the API checks everything again. Requested
// check-in locations (owner, 24 October 2026: "(Home Location - Remote Site - Client Location) with a comment reason";
// "allow the HR to add an end date or lik it to the contract date"): the request's type, name, radius (25 to 500 m),
// reason and the end date wished, the point filled in from a refused check-in ("Request this place"); HR's step with how
// long it lasts; changing it later; a client location's approval saying first that it counts for everyone.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const optional = <span className="font-normal text-muted">(optional)</span>;
const NONE: readonly MapCircle[] = [];

/** A reading this rough may be off by a street or more: worth moving the pin. */
const ROUGH_METRES = 100;

/** Session storage never changes under the page by itself: nothing to subscribe to. */
const noChange = () => () => {};

/**
 * The reading a refused check-in handed over (lib/requested-place.ts), as its stored text while it is fresh: read in the
 * browser only (none while rendered on the server, so hydration matches), left in place (it expires in 15 minutes).
 */
function handedOverText(): string | null {
  try {
    const raw = window.sessionStorage.getItem(REQUESTED_PLACE_KEY);
    if (!raw) return null;
    const keep = { getItem: () => raw, setItem: () => {}, removeItem: () => {} };
    return takeRequestedPlace(Date.now(), keep) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * The employee's request: its type, the point (the map, a search, a link pasted, or their current location, read on the
 * device: the app's own location inside the app, the browser's otherwise), its name, the radius (25 to 500 m), the reason
 * and, for a remote site or a client location, the end date wished. `lockHint`: for Office staff asking for a home, how
 * the office network's lock holds at home. `prefill`: opened from a refused check-in, the point it was refused at.
 * `open`: the types being decided now (one at a time of each), which can't be chosen.
 */
export function HomeAskForm({ action, lockHint, prefill = false, open = [] }: { action: Action; lockHint: string | null; prefill?: boolean; open?: readonly HomeType[] }) {
  const fid = useFieldIds();
  const { state, pending, form } = useKeptForm(action);
  const handedRaw = useSyncExternalStore(noChange, () => (prefill ? handedOverText() : null), () => null);
  const handed = useMemo<RequestedPlace | null>(() => (handedRaw ? (JSON.parse(handedRaw) as RequestedPlace) : null), [handedRaw]);
  const [picked, setPicked] = useState<{ point: Point; accuracy: number | null } | null>(null);
  const point = picked?.point ?? (handed ? { latitude: roundCoordinate(handed.latitude), longitude: roundCoordinate(handed.longitude) } : null);
  const accuracy = picked ? picked.accuracy : (handed?.accuracy ?? null);
  const firstFree = HOME_TYPES.find((t) => !open.includes(t)) ?? 'home';
  const [type, setType] = useState<HomeType>(() => {
    const kept = valueOf(state, 'type');
    return isHomeType(kept) && !open.includes(kept) ? kept : firstFree;
  });
  const [label, setLabel] = useState(() => valueOf(state, 'label'));
  const [recentre, setRecentre] = useState(0);
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const shownNote = note ?? (handed && !picked ? { ok: true, text: `Filled in with where your check-in was refused${accuracyText(handed.accuracy) ? `, read within ${accuracyText(handed.accuracy)}` : ''}. Drag the pin if it is off.` } : null);
  const place = type === 'home' ? 'your home' : 'the place';

  /** A point from the map, the search or the device; `bring`: the map brought to it; `read`: the reading's accuracy (none: put on the map). */
  function put(p: Point, bring: boolean, read: number | null) {
    setPicked({ point: p, accuracy: read });
    if (bring) setRecentre((n) => n + 1);
    if (read === null) setNote(null);
  }

  async function useCurrentLocation() {
    setReading(true);
    setNote(null);
    const result = await getPosition();
    setReading(false);
    if ('locationError' in result) {
      setNote({ ok: false, text: `${CHECK_IN_LOCATION_ERROR_LABELS[result.locationError]}: put ${place} on the map instead.` });
      return;
    }
    put({ latitude: roundCoordinate(result.latitude), longitude: roundCoordinate(result.longitude) }, true, result.accuracy);
    const within = accuracyText(result.accuracy);
    const rough = typeof result.accuracy === 'number' && result.accuracy > ROUGH_METRES;
    setNote({
      ok: !rough,
      text: `Your current location${within ? `, read within ${within}` : ''}. ${rough ? `That isn’t precise: drag the pin onto ${place}.` : 'Drag the pin if it is off.'}`,
    });
  }

  return (
    <form {...form} className="space-y-5">
      <FormErrors errors={state.errors} />
      <SurfaceField />
      <input type="hidden" name="latitude" value={point ? coordinateText(point.latitude) : ''} />
      <input type="hidden" name="longitude" value={point ? coordinateText(point.longitude) : ''} />
      <input type="hidden" name="accuracy" value={accuracy === null ? '' : String(Math.round(accuracy))} />

      <fieldset>
        <legend className="label">Type</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {HOME_TYPES.map((t) => {
            const busy = open.includes(t);
            return (
              <label
                key={t}
                className={`flex cursor-pointer gap-3 rounded-lg border border-line p-3 text-sm has-checked:border-accent has-checked:bg-accent-soft ${busy ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <input type="radio" name="type" value={t} checked={type === t} disabled={busy} onChange={() => setType(t)} className="mt-0.5 size-4 accent-accent" />
                <span>
                  <span className="block font-semibold">{HOME_TYPE_LINES[t]}</span>
                  <span className="block text-muted">{busy ? 'One is being decided already: wait for it, or withdraw it.' : HOME_TYPE_HINTS[t]}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {type === 'home' && lockHint && <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">{lockHint}</p>}
      {type === 'client' && <p className="rounded-lg bg-accent-soft px-4 py-3 text-sm">Once approved, a client location is the company’s: every employee checking in within it counts as there, shown as Client · its name.</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={useCurrentLocation} disabled={reading} className="btn btn-secondary">
          {reading ? 'Getting your location…' : 'Use my current location'}
        </button>
        <p role="status" className={`text-sm ${shownNote?.ok === false ? 'text-warn' : 'text-muted'}`}>
          {shownNote?.text}
        </p>
      </div>
      <PlaceSearch onPoint={(p) => put(p, true, null)} keepText="Send the request to keep it." />
      <div>
        <PickPointMap
          point={point}
          radiusMetres={HOME_RADIUS_DEFAULT}
          around={NONE}
          recentre={recentre + (handed ? 1 : 0)}
          onPick={(p) => put(p, false, null)}
          label={`Map for ${place}: click to put its point there, then drag the pin to adjust it`}
        />
        <p id={fid('point-hint')} className="hint max-w-3xl">
          Click the map or drag the pin onto {place}; search for its street; or, while there, use your current location. Click the map before zooming it
          with the mouse wheel.
        </p>
        <p className="mt-1 text-sm tabular-nums" aria-live="polite">
          {point ? `The point: ${coordinateText(point.latitude)}, ${coordinateText(point.longitude)}` : `No point yet: put ${place} on the map.`}
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('label')} className="label">
            {type === 'home' ? <>Label {optional}</> : 'Name'}
          </label>
          <input
            id={fid('label')}
            name="label"
            maxLength={HOME_LABEL_MAX}
            autoComplete="off"
            required={type !== 'home'}
            placeholder={type === 'home' ? 'Home, Nasr City' : type === 'client' ? 'Acme Cairo office' : 'Studio in Zamalek'}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-describedby={fid('label-hint')}
            className="input"
          />
          <p id={fid('label-hint')} className="hint">
            {type === 'home'
              ? `A name or the address, if you want: up to ${HOME_LABEL_MAX} characters.`
              : type === 'client'
                ? 'The client’s name, as staff will see it: “Client · Acme”.'
                : 'What you call it, as your check-ins there will show: “Remote site · Studio”.'}
          </p>
        </div>
        <div>
          <label htmlFor={fid('radiusMetres')} className="label">
            Radius (metres)
          </label>
          <input
            id={fid('radiusMetres')}
            name="radiusMetres"
            inputMode="numeric"
            autoComplete="off"
            defaultValue={valueOf(state, 'radiusMetres', String(HOME_RADIUS_DEFAULT))}
            aria-describedby={fid('radius-hint')}
            className="input tabular-nums"
          />
          <p id={fid('radius-hint')} className="hint">
            {LOCATION_ASK_RADIUS_MIN} to {LOCATION_ASK_RADIUS_MAX}; {radiusText(HOME_RADIUS_DEFAULT)} to start with. HR may change it when approving.
          </p>
        </div>
        {type !== 'home' && (
          <div>
            <label htmlFor={fid('wishedEndDate')} className="label">
              Needed until {optional}
            </label>
            <DateInput id={fid('wishedEndDate')} name="wishedEndDate" defaultValue={valueOf(state, 'wishedEndDate')} aria-describedby={fid('wished-hint')} />
            <p id={fid('wished-hint')} className="hint">
              DD/MM/YYYY. HR sets how long it lasts: until a date{type === 'client' ? ', or with no end' : ', or until your contract ends'}.
            </p>
          </div>
        )}
        <div className="sm:col-span-2">
          <label htmlFor={fid('reason')} className="label">
            Reason
          </label>
          <textarea
            id={fid('reason')}
            name="reason"
            rows={3}
            required
            maxLength={LOCATION_REASON_MAX}
            defaultValue={valueOf(state, 'reason')}
            aria-describedby={fid('reason-hint')}
            className="input"
          />
          <p id={fid('reason-hint')} className="hint">
            Why you need to check in from {place}: HR and the CEO read it. Up to {LOCATION_REASON_MAX.toLocaleString('en-US')} characters.
          </p>
        </div>
      </div>
      <p className="max-w-3xl text-sm text-muted">
        {type === 'client'
          ? 'A client location is the company’s once approved: HR keeps it on Check-in Setup. Each check-in keeps the spot where you pressed, read only then; HR can see it.'
          : `${type === 'home' ? 'Your home is personal' : 'Your remote site is yours'}: only you, HR and the CEO see it, never your manager. Sending it is your consent. A check-in within it shows as ${type === 'home' ? 'Home' : 'Remote site · its name'}. Each check-in keeps the spot where you pressed, read only then; HR can see it. You can remove it at any time.`}
      </p>
      <SubmitButton busy={pending} disabled={!point || open.includes(type)} pendingText="Sending…">
        Send to HR
      </SubmitButton>
    </form>
  );
}

/** How long it lasts: the type's choices and, for "until a date", the date (DD/MM/YYYY). `name`s: validity, validUntil. */
function ValidityFields({ request, state, start }: { request: HomeLocationView; state: FormState; start: { validity: LocationValidity; validUntil: string } }) {
  const fid = useFieldIds();
  const [validity, setValidity] = useState<LocationValidity>(() => {
    const kept = valueOf(state, 'validity');
    return (validityChoices(request) as readonly string[]).includes(kept) ? (kept as LocationValidity) : start.validity;
  });
  return (
    <fieldset className="space-y-2">
      <legend className="label">How long it lasts</legend>
      <div className="flex flex-wrap gap-2">
        {validityChoices(request).map((v) => (
          <label key={v} className={choice}>
            <input type="radio" name="validity" value={v} checked={validity === v} onChange={() => setValidity(v)} className="size-4 accent-accent" />
            {LOCATION_VALIDITY_LABELS[v]}
          </label>
        ))}
      </div>
      {validity === 'until_date' && (
        <div className="max-w-xs">
          <label htmlFor={fid('validUntil')} className="label">
            Its last day
          </label>
          <DateInput id={fid('validUntil')} name="validUntil" required defaultValue={valueOf(state, 'validUntil', start.validUntil)} aria-describedby={fid('until-hint')} />
          <p id={fid('until-hint')} className="hint">
            DD/MM/YYYY, today or later.{request.wishedEndDate ? ` The employee asked until ${formatDate(request.wishedEndDate)}.` : ''} {homeTypeOf(request) === 'client' ? 'HR is told 7 days before.' : 'The employee and HR are told 7 days before.'}
          </p>
        </div>
      )}
      {validity === 'contract' && <p className="hint">It follows their signed contract’s end, and moves when the contract is renewed; it ends with the employment.</p>}
      {validity === 'no_end' && <p className="hint">Until HR ends it on Check-in Setup.</p>}
    </fieldset>
  );
}

/**
 * The decision of the step the request is at: approve or reject (a comment to reject); at HR's step, approving, the
 * radius (as asked to start with), the circle on the map following it (`map`), and how long it lasts (24 October 2026:
 * the type's default to start with). A client location says first that approving makes it count for everyone. `from`:
 * Approvals, to come back there.
 */
export function HomeDecisionForm({ action, request, map = false, from }: { action: Action; request: HomeLocationView; map?: boolean; from?: 'approvals' }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const stage = request.stage ?? 'hr';
  const hrStep = stage === 'hr';
  const [decision, setDecision] = useState<HomeDecision | ''>(() => {
    const kept = valueOf(state, 'decision');
    return (HOME_DECISIONS as readonly string[]).includes(kept) ? (kept as HomeDecision) : '';
  });
  const [comment, setComment] = useState(() => valueOf(state, 'comment'));
  const [radius, setRadius] = useState(() => valueOf(state, 'radiusMetres', String(request.radiusMetres)));
  const typed = latin(radius).trim();
  const radiusNumber = /^\d+$/.test(typed) ? Number(typed) : Number.NaN;
  const radiusProblems = hrStep && decision !== 'reject' ? homeRadiusProblems(radiusNumber) : [];
  const ready = decision !== '' && (decision !== 'reject' || comment.trim() !== '') && (decision === 'reject' || !radiusProblems.length);
  const type = homeTypeOf(request);
  const button = homeDecisionButton(decision, stage, request.confidential, type);
  const name = request.employee.fullNameEn;
  const what = HOME_TYPE_LINES[type].toLowerCase();
  const start = startingValidity(request);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (decision === 'reject' && !window.confirm(`Reject ${name}’s ${what}? Your comment shows on it, and its point is deleted.`)) e.preventDefault();
        else if (decision === 'approve' && type === 'client' && stage === 'ceo' && !window.confirm(`${CLIENT_FOR_EVERYONE_TEXT} Approve the client location ${request.label ?? ''}?`)) e.preventDefault();
      }}
      aria-label={`Decide on ${name}’s ${what}`}
      className="space-y-4"
    >
      <FormErrors errors={state.errors} />
      <SurfaceField />
      {from && <input type="hidden" name="from" value={from} />}
      <input type="hidden" name="type" value={type} />
      {type === 'client' && <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">{CLIENT_FOR_EVERYONE_TEXT}</p>}
      <fieldset>
        <legend className="label">Decision</legend>
        <div className="flex flex-wrap gap-2">
          {HOME_DECISIONS.map((d) => (
            <label key={d} className={choice}>
              <input type="radio" name="decision" value={d} checked={decision === d} onChange={() => setDecision(d)} className="size-4 accent-accent" />
              {d === 'approve' ? 'Approve' : 'Reject'}
            </label>
          ))}
        </div>
      </fieldset>
      {hrStep && decision !== 'reject' && (
        <div className="space-y-3">
          <div className="max-w-xs">
            <label htmlFor={fid('radiusMetres')} className="label">
              Radius (metres)
            </label>
            <input
              id={fid('radiusMetres')}
              name="radiusMetres"
              inputMode="numeric"
              autoComplete="off"
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              aria-describedby={fid('radius-hint')}
              className="input tabular-nums"
            />
            <p id={fid('radius-hint')} className="hint">
              {HOME_RADIUS_MIN} to {HOME_RADIUS_MAX.toLocaleString('en-US')}; {radiusText(request.radiusMetres)} asked. A check-in within it shows as {homeShownAs(request)}.
            </p>
            {radiusProblems.length > 0 && typed !== '' && (
              <p className="mt-1 text-sm text-danger" aria-live="polite">
                {radiusProblems[0]}
              </p>
            )}
          </div>
          {map && <HomeMap request={request} radiusMetres={radiusProblems.length ? request.radiusMetres : radiusNumber} />}
          <ValidityFields request={request} state={state} start={start} />
        </div>
      )}
      <div>
        <label htmlFor={fid('comment')} className="label">
          Comment {decision !== 'reject' && optional}
        </label>
        <textarea
          id={fid('comment')}
          name="comment"
          rows={3}
          maxLength={HOME_COMMENT_MAX}
          required={decision === 'reject'}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          aria-describedby={fid('comment-hint')}
          className="input"
        />
        <p id={fid('comment-hint')} className="hint">
          {decision === 'reject' ? 'Why it is rejected. ' : ''}The employee sees your comment, and so do {request.confidential ? 'the CEO and the Super Admin' : 'HR and the CEO'}.
        </p>
      </div>
      <button
        type="submit"
        disabled={pending || !ready}
        className={`btn ${decision === 'reject' ? 'btn-danger' : 'btn-primary'} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {pending ? button.busy : button.label}
      </button>
    </form>
  );
}

/**
 * How long an approved home or remote site lasts, changed by HR (owner, 24 October 2026: "allow the HR to add an end date or
 * lik it to the contract date"): until a date or until the contract ends, with a comment if they want.
 */
export function HomeValidityForm({ action, request }: { action: Action; request: HomeLocationView }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const start = { validity: (request.validity && (validityChoices(request) as readonly string[]).includes(request.validity) ? request.validity : 'contract') as LocationValidity, validUntil: request.validUntil ? formatDate(request.validUntil) : '' };
  return (
    <form action={formAction} className="space-y-4" aria-label={`Change how long ${request.employee.fullNameEn}’s ${HOME_TYPE_LINES[homeTypeOf(request)].toLowerCase()} lasts`}>
      <FormErrors errors={state.errors} />
      <SurfaceField />
      <ValidityFields request={request} state={state} start={start} />
      <div>
        <label htmlFor={fid('comment')} className="label">
          Comment {optional}
        </label>
        <textarea id={fid('comment')} name="comment" rows={2} maxLength={HOME_COMMENT_MAX} defaultValue={valueOf(state, 'comment')} className="input" />
        <p className="hint">Shown on the request’s steps, to the employee too.</p>
      </div>
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

/** The employee's Withdraw, while it is being decided: asks first; its point is deleted. */
export function WithdrawHomeForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm('Withdraw your request? Its point is deleted; you can ask again at any time.')) e.preventDefault();
      }}
      className="space-y-3"
    >
      <FormErrors errors={state.errors} />
      <SurfaceField />
      <button type="submit" disabled={pending} className="btn btn-secondary">
        {pending ? 'Withdrawing…' : 'Withdraw the request'}
      </button>
    </form>
  );
}

/**
 * Removing an approved home: the employee's own (asks first), or HR's, the CEO's or the Super Admin's with a comment if
 * they want (`own`: the employee's). Its point is deleted. A remote site the same (`type`, 24 October 2026).
 */
export function RemoveHomeForm({ action, own, name, type = 'home' }: { action: Action; own: boolean; name: string; type?: HomeType }) {
  const what = HOME_TYPE_LINES[type].toLowerCase();
  const shown = type === 'home' ? 'Home' : 'Remote site';
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const question = own
          ? `Remove your ${what}? Its point is deleted, and your check-ins from there no longer show as ${shown}. You can ask again later.`
          : `Remove ${name}’s ${what}? Its point is deleted, and their check-ins from there no longer show as ${shown}.`;
        if (!window.confirm(question)) e.preventDefault();
      }}
      className="space-y-3"
    >
      <FormErrors errors={state.errors} />
      <SurfaceField />
      {!own && (
        <div>
          <label htmlFor={fid('comment')} className="label">
            Why it is removed {optional}
          </label>
          <textarea id={fid('comment')} name="comment" rows={2} maxLength={HOME_COMMENT_MAX} defaultValue={valueOf(state, 'comment')} className="input" />
          <p className="hint">{name} sees your comment on the request.</p>
        </div>
      )}
      <button type="submit" disabled={pending} className="btn btn-danger">
        {pending ? 'Removing…' : `Remove the ${what}`}
      </button>
    </form>
  );
}
