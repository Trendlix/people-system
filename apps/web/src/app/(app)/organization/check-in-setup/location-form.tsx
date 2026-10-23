'use client';

import { useState } from 'react';
import { CHECK_IN_LOCATION_ERROR_LABELS, OFFICE_RADIUS_DEFAULT, OFFICE_RADIUS_MAX, OFFICE_RADIUS_MIN } from '@trendlix/shared';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm } from '@/components/form';
import { PickPointMap } from '@/components/map/maps';
import { PlaceSearch } from '@/components/map/place-search';
import type { CheckInLocationView } from '@/lib/attendance-types';
import { coordinateText, isLink, pointFromText, pointOf, roundCoordinate, type MapCircle, type Point } from '@/lib/map-point';
import { getPosition } from '@/lib/native';
import type { FormState } from '@/lib/types';
import { accuracyText } from '../../my-attendance/check-in';
import { locationFrom } from './setup';

// A check-in location's form (Attendance → Check-in Setup; owner, 20 October 2026: "Own page, several locations"): its
// name, its point (latitude and longitude) and the radius around it in metres (150 to start with). A check-in on the
// system within the main office's radius is Office, within a sub-location's remote with its name ("Remote - Studio";
// owner, 20 October 2026: "main office location is the hero and other locations are like sub locations"); the punch
// keeps the place and the location's name, and the spot where it was pressed (the same day: "Yes, keep the spot"). Use
// my current location fills the point from this device, for HR standing in the place (the employee
// app's own location when it has it, else the browser's). The shared checks run as it is typed, and again on saving
// (setup.ts locationFrom, then the API). Adding: the fields empty again once added; changing: closed once saved.
// The point from a map too (owner, the same day: "let me view location on map and add location from map"): a click on
// the form's map puts the pin there and the pin can be dragged, filling Latitude and Longitude; the pin follows what is
// typed in them, and its circle the radius. A place searched for, a Google Maps link or a point pasted (into the search
// or into Latitude) and the current location put the pin and bring the map to it. The fields stay the way to type it,
// and they are what is saved.

/** No other location to draw. */
const NONE: readonly MapCircle[] = [];

export function LocationForm({
  action,
  location,
  around = NONE,
  submitLabel,
  namePlaceholder = 'Head office',
  onSaved,
  onCancel,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  /** The location changed; none for a new one. */
  location?: CheckInLocationView;
  /** The locations there are, drawn faintly on the map, which starts on them while there is no point. */
  around?: readonly MapCircle[];
  submitLabel: string;
  /** The name's example: "Head office" for the main office, "Studio" for a sub-location. */
  namePlaceholder?: string;
  /** Once saved, with what the save said. */
  onSaved?: (message: string) => void;
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
  /** Counted up each time the map is to be brought to the point (a place found, a link pasted, the current location). */
  const [recentre, setRecentre] = useState(0);
  /** Counted up each time a new location is added: the search starts empty again with the fields. */
  const [added, setAdded] = useState(0);
  const { body, problems } = locationFrom({ name, latitude: lat, longitude: lng, radius: metres });
  // the map's pin and circle, from the fields as typed
  const point = pointOf(body.latitude, body.longitude);
  const radius = Number.isFinite(body.radiusMetres) && body.radiusMetres > 0 ? body.radiusMetres : null;

  /** A point from the map, the search or a paste, into the fields; `bring`: the map brought to it too. */
  function putPoint(p: Point, bring: boolean) {
    setLat(coordinateText(p.latitude));
    setLng(coordinateText(p.longitude));
    setTouched(true);
    if (bring) setRecentre((n) => n + 1);
  }

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
        setAdded((n) => n + 1);
      }
      onSaved?.(result.message);
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
    putPoint({ latitude: roundCoordinate(result.latitude), longitude: roundCoordinate(result.longitude) }, true);
    const within = accuracyText(result.accuracy);
    setNote({ ok: true, text: `Filled from your current location${within ? `, read within ${within}` : ''}. Save the location to keep it.` });
  }

  const typed = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
    setTouched(true);
  };

  // Latitude takes both from a point or a link pasted into it ("30.0457, 31.1923", a Google Maps link), and from a link
  // however it gets in; a point typed into it by hand is split on saving (setup.ts locationFrom)
  const latitudeTyped = (e: React.ChangeEvent<HTMLInputElement>) => {
    const p = isLink(e.target.value) ? pointFromText(e.target.value) : null;
    if (p) putPoint(p, true);
    else typed(setLat)(e);
  };
  const latitudePasted = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const p = pointFromText(e.clipboardData.getData('text'));
    if (!p) return;
    e.preventDefault();
    putPoint(p, true);
  };

  return (
    <form {...form} className="space-y-4">
      <FormErrors errors={state.errors} />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor={fid('name')} className="label">
            Name
          </label>
          <input id={fid('name')} name="name" required autoComplete="off" placeholder={namePlaceholder} value={name} onChange={typed(setName)} className="input" />
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
            onChange={latitudeTyped}
            onPaste={latitudePasted}
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
      <PlaceSearch key={added} onPoint={(p) => putPoint(p, true)} />
      <div>
        <PickPointMap
          point={point}
          radiusMetres={radius}
          around={around}
          recentre={recentre}
          onPick={(p) => putPoint(p, false)}
          label={
            location
              ? `Map of ${location.name}: click to move its point there, or drag the pin`
              : 'Map for the new location: click to put its point there, then drag the pin to adjust it'
          }
        />
        <p id={fid('point-hint')} className="hint max-w-3xl">
          Click the map or drag the pin to put the point there; search for the place; paste a Google Maps link or the point (30.0457, 31.1923) into
          the search or into Latitude; or, standing in the place, use your current location. Click the map before zooming it with the mouse wheel.
        </p>
      </div>
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
