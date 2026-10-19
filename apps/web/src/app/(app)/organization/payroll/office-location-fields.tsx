'use client';

import { useState } from 'react';
import { CHECK_IN_LOCATION_ERROR_LABELS, OFFICE_RADIUS_DEFAULT, OFFICE_RADIUS_MAX, OFFICE_RADIUS_MIN } from '@trendlix/shared';
import { useFieldIds } from '@/components/form';
import { accuracyText, readLocation } from '../../my-attendance/check-in';
import { coordinateText, officeLocationFrom, roundCoordinate } from './settings';

// Payroll Setup → Your Rules → Office Location (owner, 19 October 2026: "Check-in through the system (phone or web with
// the office location check, or a device) to replace Zoho"): the office's point, its latitude and longitude, and the
// radius around it in metres (150 to start with). A check-in on the system within the radius is at the office, outside
// it remote; only that is kept, never the coordinates. Both empty: not set, and every check-in is location unknown. Use
// my current location fills the point from the browser, for HR standing in the office. The shared checks run as it is
// typed, and again on saving (settings.ts rulesBody, then the API).

export function OfficeLocationFields({
  latitude,
  longitude,
  radius,
}: {
  /** What the fields start with: typed before a failed save, else as saved. */
  latitude: string;
  longitude: string;
  radius: string;
}) {
  const fid = useFieldIds();
  const [lat, setLat] = useState(latitude);
  const [lng, setLng] = useState(longitude);
  const [metres, setMetres] = useState(radius);
  const [touched, setTouched] = useState(false);
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const { problems } = officeLocationFrom({ latitude: lat, longitude: lng, radius: metres });

  async function fillFromHere() {
    setReading(true);
    setNote(null);
    const result = await readLocation(typeof navigator === 'undefined' ? null : navigator.geolocation);
    setReading(false);
    if ('locationError' in result) {
      setNote({ ok: false, text: `${CHECK_IN_LOCATION_ERROR_LABELS[result.locationError]}: type the office's latitude and longitude instead.` });
      return;
    }
    setLat(coordinateText(roundCoordinate(result.latitude)));
    setLng(coordinateText(roundCoordinate(result.longitude)));
    setTouched(true);
    const within = accuracyText(result.accuracy);
    setNote({ ok: true, text: `Filled from your current location${within ? `, read within ${within}` : ''}. Save the rules to keep it.` });
  }

  const typed = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
    setTouched(true);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-5 sm:grid-cols-3">
        <div>
          <label htmlFor={fid('officeLatitude')} className="label">
            Latitude
          </label>
          <input
            id={fid('officeLatitude')}
            name="officeLatitude"
            inputMode="decimal"
            autoComplete="off"
            placeholder="30.059600"
            value={lat}
            onChange={typed(setLat)}
            aria-describedby={fid('officeLocation-hint')}
            className="input tabular-nums"
          />
        </div>
        <div>
          <label htmlFor={fid('officeLongitude')} className="label">
            Longitude
          </label>
          <input
            id={fid('officeLongitude')}
            name="officeLongitude"
            inputMode="decimal"
            autoComplete="off"
            placeholder="31.346200"
            value={lng}
            onChange={typed(setLng)}
            aria-describedby={fid('officeLocation-hint')}
            className="input tabular-nums"
          />
        </div>
        <div>
          <label htmlFor={fid('officeRadiusMetres')} className="label">
            Radius (metres)
          </label>
          <input
            id={fid('officeRadiusMetres')}
            name="officeRadiusMetres"
            required
            inputMode="numeric"
            autoComplete="off"
            value={metres}
            onChange={typed(setMetres)}
            aria-describedby={fid('officeRadius-hint')}
            className="input tabular-nums"
          />
          <p id={fid('officeRadius-hint')} className="hint">
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
      <p id={fid('officeLocation-hint')} className="hint max-w-3xl">
        For checking in on the system: a check-in within the radius of this point is at the office, outside it remote, and only office, remote or
        location unknown is kept, never the coordinates. Standing in the office, use your current location; or copy the point from a map (both
        pasted into Latitude are split). Leave both empty for not set: every check-in is then kept as location unknown.
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
    </div>
  );
}
