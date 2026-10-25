'use client';

import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import type { ApplicationDeletion, VacancyDeletion } from '@trendlix/shared';
import { FormErrors } from '@/components/form';
import type { FormState } from '@/lib/types';
import { applicationDeletionOf, deleteApplicant, deleteVacancy, vacancyDeletionOf } from './delete-actions';
import { applicationDeleteText, confirmLabel, vacancyDeletable, vacancyDeleteText, vacancyRefusalLead } from './deletes';

// Deleting an applicant, or a vacancy people applied to (owner, 25 October 2026, on a closed vacancy with one rejected
// applicant: "i want to delete this"; asked, "Vacancy alone - applicant alone - superadmin only"). Shown to a Super Admin
// only (never a developer: the pages decide). Delete applicant, on an applicant's page and as a row action on a vacancy's
// list and board, opens a window that asks the API what goes (their interviews, comments and files, and their candidate
// profile when nothing else is left of them) or why it stays on record (hired, an offer sent, an interview to come: said
// in words, with no Delete). A vacancy's Delete, once people applied, says how many applications go and asks for its
// number to be typed. The API checks everything again.

const UNDONE = 'This can’t be undone.';

/** Closes the window a button is in (Cancel, ×, or once it is deleted). */
const closeWindowOf = (el: Element | null) => el?.closest('dialog')?.close();

/** The confirmation window: a modal <dialog> over the page, closed by Cancel, ×, or Escape; the opener focused again. */
function ConfirmWindow({ title, onClosed, children }: { title: string; onClosed: () => void; children: React.ReactNode }) {
  const titleId = useId();
  const attach = useCallback((el: HTMLDialogElement | null) => {
    if (el && !el.open) el.showModal();
  }, []);
  return createPortal(
    <dialog
      ref={attach}
      aria-labelledby={titleId}
      onClose={onClosed}
      className="m-auto max-h-[calc(100dvh-1rem)] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-xl bg-card p-0 text-ink shadow-xl backdrop:bg-black/60"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line py-2 pr-2 pl-5">
        <h2 id={titleId} className="min-w-0 self-center font-semibold break-words">
          {title}
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={(e) => closeWindowOf(e.currentTarget)}
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </dialog>,
    document.body,
  );
}

const NOT_LOADED = ['It could not be loaded. Please try again.'];

/** Loads a preview once the window opens (`load`: a server action); `errors` when the API refused or it is gone. */
function usePreview<T>(load: (id: string) => Promise<{ value?: T; errors?: string[] }>, id: string): { value: T | null; errors: string[] | null } {
  const [state, setState] = useState<{
    value: T | null;
    errors: string[] | null;
  }>({ value: null, errors: null });
  useEffect(() => {
    let live = true;
    load(id).then(
      (r) =>
        live &&
        setState({
          value: r?.value ?? null,
          errors: r?.errors ?? (r?.value ? null : NOT_LOADED),
        }),
      () => live && setState({ value: null, errors: NOT_LOADED }),
    );
    return () => {
      live = false;
    };
  }, [load, id]);
  return state;
}

/** A refusal as a plain message: why it stays on record. */
function Refusal({ children }: { children: React.ReactNode }) {
  return (
    <div role="note" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
      {children}
    </div>
  );
}

function ApplicantWindow({ id, number, back, onClosed }: { id: string; number: string; back: { vacancyId: string } | null; onClosed: () => void }) {
  const { value: d, errors } = usePreview<ApplicationDeletion>(applicationDeletionOf, id);
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  return (
    <ConfirmWindow title="Delete Applicant" onClosed={onClosed}>
      {errors && <FormErrors errors={errors} />}
      {!d && !errors && <p className="text-sm text-muted">Checking what goes with it…</p>}
      {d &&
        (d.refusal ? (
          <Refusal>{d.refusal}</Refusal>
        ) : (
          <div className="space-y-2 text-sm">
            <p>{applicationDeleteText(d)}</p>
            <p className="text-muted">{UNDONE}</p>
          </div>
        ))}
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap gap-2">
        {d && !d.refusal && (
          <button
            type="button"
            disabled={pending}
            onClick={(e) => {
              const button = e.currentTarget;
              start(async () => {
                // a deletion from its own page goes to its vacancy's page; from a list or board, the page refreshes
                const next = await deleteApplicant(id, d.number || number, back);
                setState(next ?? {});
                if (!next?.errors) closeWindowOf(button);
              });
            }}
            className="btn btn-danger"
          >
            {pending ? 'Deleting…' : 'Delete applicant'}
          </button>
        )}
        <button type="button" onClick={(e) => closeWindowOf(e.currentTarget)} className="btn btn-secondary">
          {d && !d.refusal ? 'Cancel' : 'Close'}
        </button>
      </div>
    </ConfirmWindow>
  );
}

/**
 * Delete applicant: opens the window that says what goes, or why it stays. `back`: on the applicant's own page, its
 * vacancy's page opens once it is deleted; else (a vacancy's list or board) the page refreshes. `compact`: a row's or a
 * card's small button.
 */
export function DeleteApplicantButton({ id, number, back = null, compact = false }: { id: string; number: string; back?: { vacancyId: string } | null; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={opener}
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={compact ? 'inline-flex min-h-8 cursor-pointer items-center text-xs font-semibold text-danger hover:underline' : 'btn btn-danger'}
      >
        Delete applicant
      </button>
      {open && (
        <ApplicantWindow
          id={id}
          number={number}
          back={back}
          onClosed={() => {
            setOpen(false);
            opener.current?.focus();
          }}
        />
      )}
    </>
  );
}

function VacancyWindow({ id, onClosed }: { id: string; onClosed: () => void }) {
  const { value: d, errors } = usePreview<VacancyDeletion>(vacancyDeletionOf, id);
  const [typed, setTyped] = useState('');
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const confirmId = useId();
  const deletable = d !== null && vacancyDeletable(d, typed);
  return (
    <ConfirmWindow title="Delete Vacancy" onClosed={onClosed}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!d || !deletable) return;
          // done: the list of vacancies opens
          start(async () => setState((await deleteVacancy(id, d.confirm ? typed : null)) ?? {}));
        }}
        className="space-y-4"
      >
        {errors && <FormErrors errors={errors} />}
        {!d && !errors && <p className="text-sm text-muted">Checking what goes with it…</p>}
        {d &&
          (d.refusals.length > 0 ? (
            <Refusal>
              <p>{vacancyRefusalLead(d.refusals.length)}</p>
              <ul className="mt-1 list-disc pl-4">
                {d.refusals.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </Refusal>
          ) : (
            <div className="space-y-2 text-sm">
              <p>{vacancyDeleteText(d)}</p>
              <p className="text-muted">{UNDONE}</p>
            </div>
          ))}
        {d && d.refusals.length === 0 && d.confirm && (
          <div>
            <label htmlFor={confirmId} className="label">
              {confirmLabel(d.number)}
            </label>
            <input
              id={confirmId}
              name="confirm"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.currentTarget.value)}
              className="input"
            />
          </div>
        )}
        <FormErrors errors={state.errors} />
        <div className="flex flex-wrap gap-2">
          {d && d.refusals.length === 0 && (
            <button type="submit" disabled={pending || !deletable} className="btn btn-danger">
              {pending ? 'Deleting…' : 'Delete vacancy'}
            </button>
          )}
          <button type="button" onClick={(e) => closeWindowOf(e.currentTarget)} className="btn btn-secondary">
            {d && d.refusals.length === 0 ? 'Cancel' : 'Close'}
          </button>
        </div>
      </form>
    </ConfirmWindow>
  );
}

/** A vacancy's Delete: nobody applied, a plain confirmation; people applied, the window with its number to type. */
export function DeleteVacancyButton({ id, number, applicants }: { id: string; number: string; applicants: number }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <div className="space-y-2">
      <FormErrors errors={state.errors} />
      <button
        ref={opener}
        type="button"
        aria-haspopup={applicants > 0 ? 'dialog' : undefined}
        disabled={pending}
        onClick={() => {
          if (applicants > 0) return setOpen(true);
          if (!window.confirm(`Delete ${number}? Nobody has applied; this can’t be undone.`)) return;
          start(async () => setState((await deleteVacancy(id, null)) ?? {}));
        }}
        className="btn btn-danger"
      >
        {pending ? 'Deleting…' : 'Delete'}
      </button>
      {open && (
        <VacancyWindow
          id={id}
          onClosed={() => {
            setOpen(false);
            opener.current?.focus();
          }}
        />
      )}
    </div>
  );
}
