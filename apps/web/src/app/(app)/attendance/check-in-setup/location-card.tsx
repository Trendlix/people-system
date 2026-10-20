'use client';

import { useState } from 'react';
import { DeleteForm } from '@/components/form';
import { LocationsMap } from '@/components/map/maps';
import type { CheckInLocationView } from '@/lib/attendance-types';
import { titleCase } from '@/lib/format';
import { mapHref } from '@/lib/map-point';
import type { FormState } from '@/lib/types';
import { LocationForm } from './location-form';
import { locationText } from './setup';

// One check-in location on Attendance → Check-in Setup (owner, 20 October 2026: "Own page, several locations"): its
// name, point and radius, a map to check the point, Edit (HR and Admin) and Remove (a Super Admin, as every deletion).
// The map on the card itself (owner, the same day: "let me view location on map"): the pin and the radius's circle,
// fitted to the circle; while the location is edited, its form's map in its place. "See it on a map" still opens
// OpenStreetMap's own site.

export function LocationCard({
  location: l,
  update,
  remove,
}: {
  location: CheckInLocationView;
  update: (prev: FormState, fd: FormData) => Promise<FormState>;
  /** A Super Admin's; none for anyone else. */
  remove: ((prev: FormState, fd: FormData) => Promise<FormState>) | null;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="space-y-3 rounded-lg border border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">{titleCase(l.name)}</h3>
          <p className="text-sm text-muted tabular-nums">{locationText(l)}</p>
          <p className="text-sm">
            <a href={mapHref(l)} target="_blank" rel="noreferrer">
              See it on a map<span className="sr-only"> ({l.name}, opens in a new tab)</span>
            </a>
          </p>
        </div>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className="btn btn-secondary">
            Edit<span className="sr-only"> {l.name}</span>
          </button>
        )}
      </div>
      {!editing && (
        <LocationsMap
          circles={[{ latitude: l.latitude, longitude: l.longitude, radiusMetres: l.radiusMetres }]}
          label={`Map of ${l.name}: its point and the ${l.radiusMetres.toLocaleString('en-US')} m around it`}
          height="h-[200px]"
        />
      )}
      {editing && <LocationForm action={update} location={l} submitLabel="Save location" onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />}
      {remove && !editing && <DeleteForm action={remove} confirmText={`Remove the check-in location ${l.name}? Check-ins within it will no longer count as at the office.`} label="Remove location" />}
    </li>
  );
}
