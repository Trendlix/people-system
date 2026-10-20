'use client';

import { useEffect, useState, useTransition } from 'react';
import { dismissPushOffer, PUSH_TEXT, pushOfferDismissed, type PushTurnOnOutcome } from '@/lib/notifications';
import { pushStatus } from '@/lib/native';
import { turnOnPush } from '@/lib/push-client';
import { DoneLine } from './ui';

// Home's offer of notifications on the phone (owner, 20 October 2026: "Push notifications: yes (decisions, things
// waiting for someone, a check-in reminder)"; apps/mobile/README.md, Phase 4): in the app, signed in on an app session
// and not viewing as someone (Home decides that), when the phone hasn't been asked yet (Android 13 and later ask for the
// permission; before, it is given and the app registers by itself), unless Not now was pressed on this phone. Turn on
// asks the phone, registers its token with the API and keeps it on the phone for signing out; refused on the phone, it
// says where to allow them.

/** The page's storage, null when the browser refuses it (a private window, storage blocked). */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function PushOffer() {
  const [shown, setShown] = useState(false);
  const [outcome, setOutcome] = useState<PushTurnOnOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    void pushStatus().then((status) => {
      if (live && status === 'prompt' && !pushOfferDismissed(storage())) setShown(true);
    });
    return () => {
      live = false;
    };
  }, []);

  if (outcome?.kind === 'on') return <DoneLine text={PUSH_TEXT.on} />;
  if (outcome?.kind === 'denied') return <DoneLine tone="warn" text={PUSH_TEXT.denied} />;
  if (!shown || outcome?.kind === 'unavailable') return null;

  return (
    <section aria-label="Notifications on this phone" className="card space-y-3 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-accent">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5z" />
            <path d="M10 20.5a2 2 0 0 0 4 0" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="font-semibold">{PUSH_TEXT.offer}</p>
          <p className="hint">{PUSH_TEXT.offerHint}</p>
        </div>
      </div>
      {outcome?.kind === 'error' && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {outcome.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setOutcome(null);
            startTransition(async () => {
              const result = await turnOnPush(true);
              setOutcome(result);
            });
          }}
          disabled={pending}
          className="btn btn-primary min-h-12"
        >
          {pending ? 'Turning on…' : 'Turn on'}
        </button>
        <button
          type="button"
          onClick={() => {
            dismissPushOffer(storage());
            setShown(false);
          }}
          disabled={pending}
          className="btn btn-secondary min-h-12"
        >
          Not now
        </button>
      </div>
    </section>
  );
}
