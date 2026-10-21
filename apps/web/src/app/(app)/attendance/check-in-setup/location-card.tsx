'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { DeleteForm, FormErrors } from '@/components/form';
import { LocationsMap } from '@/components/map/maps';
import type { CheckInLocationView, LinkedPersonView } from '@/lib/attendance-types';
import { titleCase } from '@/lib/format';
import { mapHref, type MapCircle } from '@/lib/map-point';
import type { FormState } from '@/lib/types';
import { profileHref } from '../../employees/tab-list';
import { LinkPeople } from './link-people';
import { LocationForm } from './location-form';
import { chipsOf, makeMainConfirm, moreText, radiusHint, removeConfirm, shownAsText, withinText, type LinkCandidate } from './setup';

// The check-in locations on Attendance → Check-in Setup (owner, 20 October 2026: "Own page, several locations", then of
// the section: "for this part, it looks unarranged to me, it needs to be more handsome. main office location is the hero
// and other locations are like sub locations. shown with their name and linked users"):
// - The main office, the hero: a large map with its pin and radius (the sub-locations drawn faintly round it), its name
//   in large type, "Within 20 m · See it on a map", a gentle hint under 50 m (phones are often 10–30 m off), and Edit.
// - A sub-location's card: a small map, its name and radius, how a check-in there shows ("Remote - Studio"), its linked
//   people as name chips (the first five, then "+N more"; each unlinked with its ×), Link people, Edit, Make main, and
//   Remove for a Super Admin.
// While a location is edited, its form's map (click, drag, search, paste a link, use my current location) takes its
// card's place. "See it on a map" opens OpenStreetMap's own site. HR and Admin keep them; the API checks every request.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** "See it on a map", opening OpenStreetMap's own site in a new tab. */
function SeeOnMap({ location: l }: { location: CheckInLocationView }) {
  return (
    <a href={mapHref(l)} target="_blank" rel="noopener noreferrer">
      See it on a map<span className="sr-only"> ({l.name}, opens in a new tab)</span>
    </a>
  );
}

/** What a save or a step said, under a card, polite for screen readers. */
function Said({ message, errors }: { message: string | null; errors?: string[] }) {
  return (
    <div aria-live="polite" className="empty:hidden">
      {errors?.length ? <FormErrors errors={errors} /> : message ? <p className="text-sm text-ok">{message}</p> : null}
    </div>
  );
}

/** The main office: the hero. */
export function MainOfficeCard({
  location: l,
  around,
  others,
  update,
  remove,
}: {
  location: CheckInLocationView;
  /** The sub-locations, drawn faintly on its map. */
  around: readonly MapCircle[];
  /** The other locations, drawn faintly on its form's map while it is edited. */
  others: readonly MapCircle[];
  update: Action;
  /** A Super Admin's, once it is the last location; none otherwise. */
  remove: Action | null;
}) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const hint = radiusHint(l.radiusMetres);
  return (
    <article aria-labelledby={`main-office-${l.id}`} className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
      {editing ? (
        <div className="space-y-4 p-5 sm:p-6">
          <h3 id={`main-office-${l.id}`} className="font-semibold">
            Edit the Main Office
          </h3>
          <LocationForm
            action={update}
            location={l}
            around={others}
            submitLabel="Save location"
            onSaved={(message) => {
              setEditing(false);
              setSaved(message);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <>
          <div className="p-2 pb-0">
            <LocationsMap
              circles={[{ latitude: l.latitude, longitude: l.longitude, radiusMetres: l.radiusMetres, name: titleCase(l.name) }]}
              around={around}
              label={`Map of the main office, ${l.name}: its point and the ${l.radiusMetres.toLocaleString('en-US')} m around it, with the sub-locations near it drawn faintly`}
              height="h-[240px] sm:h-[320px]"
            />
          </div>
          <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
            <div className="min-w-0 space-y-1.5">
              <h3 id={`main-office-${l.id}`} className="flex flex-wrap items-center gap-2 text-xs font-semibold tracking-wide text-ok uppercase">
                <span className="badge bg-ok-soft text-ok normal-case">Office</span>
                Main Office
              </h3>
              <p className="text-2xl font-semibold break-words sm:text-3xl">{titleCase(l.name)}</p>
              <p className="text-sm text-muted">
                <span className="tabular-nums">{withinText(l.radiusMetres)}</span> · <SeeOnMap location={l} />
              </p>
              <p className="text-xs text-muted tabular-nums">
                {l.latitude.toFixed(6)}, {l.longitude.toFixed(6)}
              </p>
              <p className="text-sm">A check-in within it is Office, for everyone.</p>
              {hint && (
                <p className="mt-2 max-w-md rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
                  <span className="font-semibold">A small radius.</span> {hint}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <button
                type="button"
                onClick={() => {
                  setSaved(null);
                  setEditing(true);
                }}
                className="btn btn-secondary"
              >
                Edit<span className="sr-only"> the main office, {l.name}</span>
              </button>
              {remove && <DeleteForm action={remove} confirmText={removeConfirm(l.name, true)} label="Remove location" />}
            </div>
          </div>
          {saved && (
            <div className="px-5 pb-5 sm:px-6">
              <Said message={saved} />
            </div>
          )}
        </>
      )}
    </article>
  );
}

/** A sub-location's linked people as name chips: the first five, then "+N more"; each with its × to unlink them. */
function PeopleChips({ people, place, unlink }: { people: readonly LinkedPersonView[]; place: string; unlink: (p: LinkedPersonView) => void }) {
  const [all, setAll] = useState(false);
  const { shown, more } = chipsOf(people);
  const listed = all ? people : shown;
  if (!people.length) return <p className="text-sm text-muted">No one linked yet: anyone checking in here is flagged &ldquo;Not their location&rdquo;.</p>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={`People linked to ${place}`}>
      {listed.map((p) => (
        <li key={p.id} className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-line bg-canvas py-0.5 ps-2.5 pe-0.5 text-xs font-medium">
          <Link href={profileHref(p.id, 'employment')} className="truncate text-ink no-underline hover:underline" title={`${p.fullNameEn} · ${p.employeeCode}`}>
            {p.fullNameEn}
          </Link>
          <button
            type="button"
            onClick={() => unlink(p)}
            aria-label={`Unlink ${p.fullNameEn} from ${place}`}
            title="Unlink"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted hover:bg-danger-soft hover:text-danger"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-3">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </li>
      ))}
      {more > 0 && (
        <li>
          <button type="button" onClick={() => setAll((a) => !a)} aria-expanded={all} className="min-h-7 rounded-full px-2.5 text-xs font-semibold text-accent hover:bg-accent-soft">
            {all ? 'Show fewer' : moreText(more)}
          </button>
        </li>
      )}
    </ul>
  );
}

/** A sub-location: remote with its name, its people, and what HR and Admin do with it. */
export function SubLocationCard({
  location: l,
  others,
  candidates,
  update,
  link,
  unlink,
  makeMain,
  mainName,
  remove,
}: {
  location: CheckInLocationView;
  /** The other locations, drawn faintly on its form's map while it is edited. */
  others: readonly MapCircle[];
  /** Whom Link people offers; none: the server can't tell yet, so linking waits. */
  candidates: readonly LinkCandidate[] | null;
  update: Action;
  link: Action;
  unlink: (employeeId: string, name: string, place: string) => Promise<FormState>;
  makeMain: () => Promise<FormState>;
  mainName: string | null;
  /** A Super Admin's; none for anyone else. */
  remove: Action | null;
}) {
  const [editing, setEditing] = useState(false);
  const [said, setSaid] = useState<FormState>({});
  const [pending, start] = useTransition();
  const people = l.people ?? [];
  const nameId = `sub-location-${l.id}`;

  const run = (step: () => Promise<FormState>) =>
    start(async () => {
      setSaid(await step());
    });

  if (editing) {
    return (
      <li aria-labelledby={nameId} className="col-span-full space-y-4 rounded-xl border border-line bg-white p-5 shadow-sm">
        <h4 id={nameId} className="font-semibold">
          Edit {titleCase(l.name)}
        </h4>
        <LocationForm
          action={update}
          location={l}
          around={others}
          namePlaceholder="Studio"
          submitLabel="Save location"
          onSaved={(message) => {
            setEditing(false);
            setSaid({ message });
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li aria-labelledby={nameId} aria-busy={pending || undefined} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-white shadow-sm">
      <div className="p-2 pb-0">
        <LocationsMap
          circles={[{ latitude: l.latitude, longitude: l.longitude, radiusMetres: l.radiusMetres }]}
          label={`Map of ${l.name}: its point and the ${l.radiusMetres.toLocaleString('en-US')} m around it`}
          height="h-[140px]"
        />
      </div>
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="min-w-0 space-y-1">
          <h4 id={nameId} className="text-base font-semibold break-words">
            {titleCase(l.name)}
          </h4>
          <p className="text-sm text-muted">
            <span className="tabular-nums">{withinText(l.radiusMetres)}</span> · <SeeOnMap location={l} />
          </p>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            Shows as <span className="badge max-w-full truncate">{shownAsText(l.name)}</span>
          </p>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">
            Linked people{people.length > 0 && <span className="tabular-nums"> · {people.length}</span>}
          </p>
          <PeopleChips
            people={people}
            place={l.name}
            unlink={(p) => {
              if (window.confirm(`Unlink ${p.fullNameEn} from ${l.name}? Their check-ins there will be flagged as not their location.`)) run(() => unlink(p.id, p.fullNameEn, l.name));
            }}
          />
          {candidates && <LinkPeople action={link} candidates={candidates} linked={people.map((p) => p.id)} place={l.name} />}
        </div>
        <Said message={said.message ?? null} errors={said.errors} />
        <div className="mt-auto flex flex-wrap gap-2 border-t border-line-soft pt-3">
          <button
            type="button"
            onClick={() => {
              setSaid({});
              setEditing(true);
            }}
            className="btn btn-secondary"
          >
            Edit<span className="sr-only"> {l.name}</span>
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm(makeMainConfirm(l.name, mainName))) run(makeMain);
            }}
            className="btn btn-secondary"
          >
            {pending ? 'Working…' : 'Make main'}
            <span className="sr-only"> office: {l.name}</span>
          </button>
          {remove && <DeleteForm action={remove} confirmText={removeConfirm(l.name, false)} label="Remove" />}
        </div>
      </div>
    </li>
  );
}
