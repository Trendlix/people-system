'use client';

import { useState } from 'react';
import { CHECK_IN_LOCATION_ERROR_LABELS, OFFICE_RADIUS_DEFAULT, OFFICE_RADIUS_MAX, OFFICE_RADIUS_MIN } from '@trendlix/shared';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm } from '@/components/form';
import type { CheckInLocationView } from '@/lib/attendance-types';
import { getPosition } from '@/lib/native';
import type { FormState } from '@/lib/types';
import { accuracyText } from '../../my-attendance/check-in';
import { coordinateText, locationFrom, roundCoordinate } from './setup';

// A check-in location's form (Attendance → Check-in Setup; owner, 20 October 2026: "Own page, several locations"): its
// name, its point (latitude and longitude) and the radius around it in metres (150 to start with). A check-in on the
// system within the radius of any location is at the office; only that is kept (and the location's name), never the
// coordinates. Use my current location fills the point from this device, for HR standing in the place (the employee
// app's own location when it has it, else the browser's). The shared checks run as it is typed, and again on saving
// (setup.ts locationFrom, then the API). Adding: the fields empty again once added; changing: closed once saved.

export function LocationForm({
  action,
  location,
  submitLabel,
  onSaved,
  onCancel,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  /** The location changed; none for a new one. */
  location?: CheckInLocationView;
  submitLabel: string;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const fid = useFieldIds();
  const [name, setName] = useState(location?.name ?? '');
  const [lat, setLat] = useState(coordinateText(location?.latitude));
  const [lng, setLng] = useState(coordinateText(location?.longitude));
  const [metres, setMetres] = useState(String(location?.radiusMetres ?? OFFICE_RADIUS_DEFAULT));
  const [touched, setTouched] = useState(false);
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const { problems } = locationFrom({ name, latitude: lat, longitude: lng, radius: metres });

  // once saved: a new location's fields empty again, a changed one's form closed
  const { state, pending, form } = useKeptForm(async (prev, fd) => {
    const result = await action(prev, fd);
    if (result.message && !result.errors?.length) {
      if (!location) {
        setName('');
        setLat('');
        setLng('');
        setMetres(String(OFFICE_RADIUS_DEFAULT));
        setTouched(false);
        setNote(null);
      }
      onSaved?.();
    }
    return result;
  });

  async function fillFromHere() {
    setReading(true);
    setNote(null);
    const result = await getPosition();
    setReading(false);
    if ('locationError' in result) {
      setNote({ ok: false, text: `${CHECK_IN_LOCATION_ERROR_LABELS[result.locationError]}: type the latitude and longitude instead.` });
      return;
    }
    setLat(coordinateText(roundCoordinate(result.latitude)));
    setLng(coordinateText(roundCoordinate(result.longitude)));
    setTouched(true);
    const within = accuracyText(result.accuracy);
    setNote({ ok: true, text: `Filled from your current location${within ? `, read within ${within}` : ''}. Save the location to keep it.` });
  }

  const typed = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
    setTouched(true);
  };

  return (
    <form {...form} className="space-y-4">
      <FormErrors errors={state.errors} />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor={fid('name')} className="label">
            Name
          </label>
          <input id={fid('name')} name="name" required autoComplete="off" placeholder="Head office" value={name} onChange={typed(setName)} className="input" />
        </div>
        <div>
          <label htmlFor={fid('latitude')} className="label">
            Latitude
          </label>
          <input
            id={fid('latitude')}
            name="latitude"
            required
            inputMode="decimal"
            autoComplete="off"
            placeholder="30.059600"
            value={lat}
            onChange={typed(setLat)}
            aria-describedby={fid('point-hint')}
            className="input tabular-nums"
          />
        </div>
        <div>
          <label htmlFor={fid('longitude')} className="label">
            Longitude
          </label>
          <input
            id={fid('longitude')}
            name="longitude"
            required
            inputMode="decimal"
            autoComplete="off"
            placeholder="31.346200"
            value={lng}
            onChange={typed(setLng)}
            aria-describedby={fid('point-hint')}
            className="input tabular-nums"
          />
        </div>
        <div>
          <label htmlFor={fid('radiusMetres')} className="label">
            Radius (metres)
          </label>
          <input
            id={fid('radiusMetres')}
            name="radiusMetres"
            required
            inputMode="numeric"
            autoComplete="off"
            value={metres}
            onChange={typed(setMetres)}
            aria-describedby={fid('radius-hint')}
            className="input tabular-nums"
          />
          <p id={fid('radius-hint')} className="hint">
            {OFFICE_RADIUS_MIN} to {OFFICE_RADIUS_MAX.toLocaleString('en-US')}; {OFFICE_RADIUS_DEFAULT} to start with.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={fillFromHere} disabled={reading} className="btn btn-secondary">
          {reading ? 'Getting your location…' : 'Use my current location'}
        </button>
        <p role="status" className={`text-sm ${note?.ok === false ? 'text-danger' : 'text-muted'}`}>
          {note?.text}
        </p>
      </div>
      <p id={fid('point-hint')} className="hint max-w-3xl">
        Standing in the place, use your current location; or copy the point from a map (both pasted into Latitude are split).
      </p>
      <div aria-live="polite">
        {touched && problems.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-danger">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton busy={pending}>{submitLabel}</SubmitButton>
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
        )}
        {state.message && !pending && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
