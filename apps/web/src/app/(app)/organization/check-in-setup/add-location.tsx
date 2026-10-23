'use client';

import { useRef, useState } from 'react';
import type { MapCircle } from '@/lib/map-point';
import type { FormState } from '@/lib/types';
import { LocationForm } from './location-form';

// "Add a sub-location" on Attendance → Check-in Setup (owner, 20 October 2026: "main office location is the hero and
// other locations are like sub locations"): a button opening the location's form (its map to click or drag, the place
// search, a Google Maps link pasted, or the current location), not a form always open. With no main office yet, the
// first location added is the main office: the button says so. Closed once added, what the save said shown in its place.

export function AddLocation({ action, around, first }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; around: readonly MapCircle[]; first: boolean }) {
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    // back where the keyboard was
    requestAnimationFrame(() => button.current?.focus());
  };
  const title = first ? 'Add the Main Office' : 'Add a Sub-Location';

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          ref={button}
          type="button"
          onClick={() => {
            setAdded(null);
            setOpen(true);
          }}
          aria-expanded="false"
          className={first ? 'btn btn-primary' : 'btn btn-secondary'}
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4">
            <path d="M10 4v12M4 10h12" />
          </svg>
          {first ? 'Add the main office' : 'Add a sub-location'}
        </button>
        {added && (
          <p role="status" className="text-sm text-ok">
            {added}
          </p>
        )}
      </div>
    );
  }

  return (
    <section aria-label={title} className="w-full space-y-4 rounded-xl border border-accent/30 bg-white p-5 shadow-sm">
      <div>
        <h4 className="font-semibold">{title}</h4>
        <p className="mt-0.5 text-sm text-muted">
          {first
            ? 'Check-ins within it are Office, for everyone.'
            : 'A place people work from, such as a studio or a client’s site: check-ins within it are remote, shown with its name. Link its people once it is added.'}
        </p>
      </div>
      <LocationForm
        action={action}
        around={around}
        namePlaceholder={first ? 'Head office' : 'Studio'}
        submitLabel={first ? 'Add the main office' : 'Add sub-location'}
        onSaved={(message) => {
          setAdded(message);
          close();
        }}
        onCancel={close}
      />
    </section>
  );
}
