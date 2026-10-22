'use client';

import { useCallback, useEffect, useId, useOptimistic, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { rolesText, filterChoices, type ViewAsChoice } from '@/lib/view-as';
import { backToMyAccount, loadViewAsChoices, setActing, setViewMode, viewAs } from '@/lib/view-as-actions';

// The view-as switcher on screen (owner's decisions, 17 October 2026: "a super admin can view any other user profile
// from a switcher, only the super admin"; "view only with a button to act but by default not checked"). View as… in
// the user menu opens a pop-up window listing the users, searched by typing; the banner on every page while switched
// has Act as them and Back to my account. The API decides everything; this only asks it.

/** View as… in the user menu, for a Super Admin in their own session. */
export function ViewAsButton() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);

  function closed() {
    setOpen(false);
    opener.current?.focus();
  }

  return (
    <>
      <button ref={opener} type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className="cursor-pointer text-sm whitespace-nowrap">
        View as…
      </button>
      {open && <ViewAsWindow onClosed={closed} />}
    </>
  );
}

/** The pop-up window: a search box over the users; choosing one switches to them. */
function ViewAsWindow({ onClosed }: { onClosed: () => void }) {
  const titleId = useId();
  const hintId = useId();
  const searchId = useId();
  const dialog = useRef<HTMLDialogElement | null>(null);
  const attach = useCallback((el: HTMLDialogElement | null) => {
    dialog.current = el;
    if (el && !el.open) el.showModal();
  }, []);

  const [choices, setChoices] = useState<ViewAsChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [switching, setSwitching] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    loadViewAsChoices().then(
      (r) => {
        if (!live) return;
        if (r?.error) setError(r.error);
        else setChoices(r.choices ?? []);
      },
      () => live && setError('Cannot load the users. Please try again.'),
    );
    return () => {
      live = false;
    };
  }, []);

  function choose(c: ViewAsChoice) {
    setSwitching(c.id);
    setError(null);
    startTransition(async () => {
      // on success the API's new session is kept and the home page opens, as the user chosen sees it
      const r = await viewAs(c.id);
      if (r?.error) {
        setError(r.error);
        setSwitching(null);
      }
    });
  }

  const shown = choices ? filterChoices(choices, query) : [];

  return createPortal(
    <dialog
      ref={attach}
      aria-labelledby={titleId}
      aria-describedby={hintId}
      onClose={onClosed}
      className="m-auto max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-lg overflow-hidden rounded-xl bg-card p-0 text-ink shadow-xl backdrop:bg-black/70 open:flex open:flex-col sm:max-h-[calc(100dvh-4rem)]"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line py-2 pr-2 pl-5">
        <h2 id={titleId} className="min-w-0 self-center font-semibold break-words">
          View As Another User
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={() => dialog.current?.close()}
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>

      <div className="space-y-3 border-b border-line-soft px-5 py-4">
        <p id={hintId} className="text-sm text-muted">
          You see the system as they do: their menus, pages and data. View only: to make changes in their name, switch on Act as them in the banner.
        </p>
        <div>
          <label htmlFor={searchId} className="label">
            Search users
          </label>
          <input
            id={searchId}
            type="search"
            autoFocus
            autoComplete="off"
            placeholder="Name, email or role"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            className="input"
          />
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-auto overflow-y-auto">
        {!choices ? (
          !error && <p className="px-5 py-4 text-sm text-muted">Loading users…</p>
        ) : shown.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">{choices.length ? 'No matches' : 'There is no one else to view as.'}</p>
        ) : (
          <ul aria-label="Users" className="divide-y divide-line-soft">
            {shown.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => choose(c)}
                  className="flex min-h-11 w-full cursor-pointer flex-col items-start gap-0.5 px-5 py-2.5 text-left hover:bg-canvas disabled:cursor-wait disabled:opacity-60"
                >
                  <span dir="auto" className="text-sm font-medium break-words">
                    {c.name ?? c.email}
                    {switching === c.id && <span className="font-normal text-muted"> · Switching…</span>}
                  </span>
                  <span className="text-xs break-all text-muted">
                    {c.name ? `${c.email} · ` : ''}
                    {rolesText(c.roles)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </dialog>,
    document.body,
  );
}

/**
 * The banner's controls: Act as them (off until switched on) and Back to my account; for a developer who is also an
 * employee (`developerView` not null; owner, 22 October 2026: "give hin a switched to use the account as the main role
 * assigned to him or as a developer"), See as a developer too (off: as themselves, the default).
 */
export function ViewAsControls({ acting: saved, developerView = null }: { acting: boolean; developerView?: boolean | null }) {
  const switchId = useId();
  const hintId = useId();
  const devSwitchId = useId();
  const devHintId = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // shown turned at once; back as it was if the API refuses
  const [acting, setShown] = useOptimistic(saved);
  const [going, setGoing] = useState(false);

  function turn(act: boolean) {
    setError(null);
    startTransition(async () => {
      setShown(act);
      const r = await setActing(act);
      if (r?.error) setError(r.error);
    });
  }

  function seeAsDeveloper(on: boolean) {
    setError(null);
    startTransition(async () => {
      // on success the home page opens, as that mode shows it
      const r = await setViewMode(on ? 'developer' : 'self');
      if (r?.error) setError(r.error);
    });
  }

  function back() {
    setError(null);
    setGoing(true);
    startTransition(async () => {
      const r = await backToMyAccount();
      if (r?.error) {
        setError(r.error);
        setGoing(false);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <label htmlFor={switchId} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold">
        <input
          id={switchId}
          type="checkbox"
          role="switch"
          checked={acting}
          disabled={pending}
          onChange={(e) => turn(e.currentTarget.checked)}
          aria-describedby={hintId}
          className="size-5 accent-warn"
        />
        Act as them
      </label>
      <span id={hintId} className="sr-only">
        {acting ? 'On: changes are made in their name and recorded as done by you.' : 'Off: view only, every change is refused.'}
      </span>
      {developerView !== null && (
        <>
          <label htmlFor={devSwitchId} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold">
            <input
              id={devSwitchId}
              type="checkbox"
              role="switch"
              checked={developerView}
              disabled={pending}
              onChange={(e) => seeAsDeveloper(e.currentTarget.checked)}
              aria-describedby={devHintId}
              className="size-5 accent-accent"
            />
            See as a developer
          </label>
          <span id={devHintId} className="sr-only">
            {developerView ? 'On: you see what they see as a developer: read only, names are pseudonyms.' : 'Off: you see them as themselves.'}
          </span>
        </>
      )}
      <button type="button" onClick={back} disabled={pending} className="btn btn-secondary">
        {going ? 'Going back…' : 'Back to my account'}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
