'use client';

import { useActionState, useState } from 'react';
import {
  CHECK_IN_LOCATION_ERROR_LABELS,
  HOME_COMMENT_MAX,
  HOME_DECISIONS,
  HOME_LABEL_MAX,
  HOME_RADIUS_DEFAULT,
  HOME_RADIUS_MAX,
  HOME_RADIUS_MIN,
  homeRadiusProblems,
  type HomeDecision,
} from '@trendlix/shared';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { PickPointMap } from '@/components/map/maps';
import { PlaceSearch } from '@/components/map/place-search';
import { SurfaceField } from '@/components/surface';
import type { HomeLocationView } from '@/lib/home-location-types';
import { coordinateText, latin, roundCoordinate, type MapCircle, type Point } from '@/lib/map-point';
import { getPosition } from '@/lib/native';
import type { FormState } from '@/lib/types';
import { choice } from '../employees/[id]/contracts/pay-fields';
import { accuracyText } from '../my-attendance/check-in';
import { homeDecisionButton, radiusText } from './home-locations';
import { HomeMap } from './ui';

// The home locations' forms (owner, 20 October 2026: "allow other users to request to add their home locations when
// working from home"; then "Label Home, flag elsewhere", "then approved by the HR and CEO"): the employee's request (the
// point on the shared map, from a search or their current location with its accuracy, a label, the radius shown as 100
// m, which HR sets), each step's decision (HR's with the radius, its circle following what is typed), withdrawing a
// request and removing an approved home. Each sends its server action; the API checks everything again.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const optional = <span className="font-normal text-muted">(optional)</span>;
const NONE: readonly MapCircle[] = [];

/** A reading this rough may be off by a street or more: worth moving the pin. */
const ROUGH_METRES = 100;

/**
 * The employee's request: their home's point (the map, a search, a link pasted, or their current location, read on the
 * device: the app's own location inside the app, the browser's otherwise), a label, and the radius HR sets. `lockHint`:
 * for Office staff, that the office network's lock still holds at home.
 */
export function HomeAskForm({ action, lockHint }: { action: Action; lockHint: string | null }) {
  const fid = useFieldIds();
  const { state, pending, form } = useKeptForm(action);
  const [point, setPoint] = useState<Point | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [label, setLabel] = useState(() => valueOf(state, 'label'));
  const [recentre, setRecentre] = useState(0);
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  /** A point from the map, the search or the device; `bring`: the map brought to it; `read`: the reading's accuracy (none: put on the map). */
  function put(p: Point, bring: boolean, read: number | null) {
    setPoint(p);
    setAccuracy(read);
    if (bring) setRecentre((n) => n + 1);
    if (read === null) setNote(null);
  }

  async function useCurrentLocation() {
    setReading(true);
    setNote(null);
    const result = await getPosition();
    setReading(false);
    if ('locationError' in result) {
      setNote({ ok: false, text: `${CHECK_IN_LOCATION_ERROR_LABELS[result.locationError]}: put your home on the map instead.` });
      return;
    }
    put({ latitude: roundCoordinate(result.latitude), longitude: roundCoordinate(result.longitude) }, true, result.accuracy);
    const within = accuracyText(result.accuracy);
    const rough = typeof result.accuracy === 'number' && result.accuracy > ROUGH_METRES;
    setNote({
      ok: !rough,
      text: `Your current location${within ? `, read within ${within}` : ''}. ${rough ? 'That isn’t precise: drag the pin onto your home.' : 'Drag the pin if it is off.'}`,
    });
  }

  return (
    <form {...form} className="space-y-5">
      <FormErrors errors={state.errors} />
      <SurfaceField />
      <input type="hidden" name="latitude" value={point ? coordinateText(point.latitude) : ''} />
      <input type="hidden" name="longitude" value={point ? coordinateText(point.longitude) : ''} />
      <input type="hidden" name="accuracy" value={accuracy === null ? '' : String(Math.round(accuracy))} />
      {lockHint && <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">{lockHint}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={useCurrentLocation} disabled={reading} className="btn btn-secondary">
          {reading ? 'Getting your location…' : 'Use my current location'}
        </button>
        <p role="status" className={`text-sm ${note?.ok === false ? 'text-warn' : 'text-muted'}`}>
          {note?.text}
        </p>
      </div>
      <PlaceSearch onPoint={(p) => put(p, true, null)} keepText="Send the request to keep it." />
      <div>
        <PickPointMap
          point={point}
          radiusMetres={HOME_RADIUS_DEFAULT}
          around={NONE}
          recentre={recentre}
          onPick={(p) => put(p, false, null)}
          label="Map for your home: click to put its point there, then drag the pin to adjust it"
        />
        <p id={fid('point-hint')} className="hint max-w-3xl">
          Click the map or drag the pin onto your home; search for your street; or, at home, use your current location. Click the map before zooming it
          with the mouse wheel.
        </p>
        <p className="mt-1 text-sm tabular-nums" aria-live="polite">
          {point ? `Your home: ${coordinateText(point.latitude)}, ${coordinateText(point.longitude)}` : 'No point yet: put your home on the map.'}
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('label')} className="label">
            Label {optional}
          </label>
          <input
            id={fid('label')}
            name="label"
            maxLength={HOME_LABEL_MAX}
            autoComplete="off"
            placeholder="Home, Nasr City"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-describedby={fid('label-hint')}
            className="input"
          />
          <p id={fid('label-hint')} className="hint">
            A name or the address, if you want: up to {HOME_LABEL_MAX} characters.
          </p>
        </div>
        <div>
          <p className="label">Radius</p>
          <p className="min-h-11 py-2.5 text-sm tabular-nums">
            {radiusText(HOME_RADIUS_DEFAULT)} <span className="text-muted">· HR sets it when approving</span>
          </p>
        </div>
      </div>
      <p className="max-w-3xl text-sm text-muted">
        Your home is personal: only you, HR and the CEO see it, never your manager. Sending it is your consent. A check-in within it shows as Home.
        Each check-in keeps the spot where you pressed, read only then; HR can see it. You can remove your home at any time.
      </p>
      <SubmitButton busy={pending} disabled={!point} pendingText="Sending…">
        Send to HR
      </SubmitButton>
    </form>
  );
}

/**
 * The decision of the step the request is at: approve or reject (a comment to reject); at HR's step, approving, the
 * radius (as asked to start with), the circle on the map following it (`map`). `from`: Approvals, to come back there.
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
  const button = homeDecisionButton(decision, stage, request.confidential);
  const name = request.employee.fullNameEn;

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (decision === 'reject' && !window.confirm(`Reject ${name}’s home location? Your comment shows on it, and its point is deleted.`)) e.preventDefault();
      }}
      aria-label={`Decide on ${name}’s home location`}
      className="space-y-4"
    >
      <FormErrors errors={state.errors} />
      <SurfaceField />
      {from && <input type="hidden" name="from" value={from} />}
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
              {HOME_RADIUS_MIN} to {HOME_RADIUS_MAX.toLocaleString('en-US')}; {radiusText(request.radiusMetres)} asked. A check-in within it shows as Home.
            </p>
            {radiusProblems.length > 0 && typed !== '' && (
              <p className="mt-1 text-sm text-danger" aria-live="polite">
                {radiusProblems[0]}
              </p>
            )}
          </div>
          {map && <HomeMap request={request} radiusMetres={radiusProblems.length ? request.radiusMetres : radiusNumber} />}
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

/** The employee's Withdraw, while it is being decided: asks first; its point is deleted. */
export function WithdrawHomeForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm('Withdraw your home location request? Its point is deleted; you can ask again at any time.')) e.preventDefault();
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
 * they want (`own`: the employee's). Its point is deleted.
 */
export function RemoveHomeForm({ action, own, name }: { action: Action; own: boolean; name: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const question = own
          ? 'Remove your home location? Its point is deleted, and your check-ins from there no longer show as Home. You can ask again later.'
          : `Remove ${name}’s home location? Its point is deleted, and their check-ins from there no longer show as Home.`;
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
        {pending ? 'Removing…' : 'Remove the home location'}
      </button>
    </form>
  );
}
