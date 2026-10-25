'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  CV_PREFILL_FAILED,
  isLinkedInProblem,
  LINKEDIN_PROBLEM_TEXT,
  LINKEDIN_START_PATH,
  RECRUITMENT_LIMITS,
  type CvPrefillResult,
  type LinkedInDetails,
} from '@trendlix/shared';
import { readCv, takeLinkedIn } from './prefill-actions';
import { draftFrom, draftKey, draftOf, emptyFieldsPatch, FILL_FIELDS, FILL_ORIGIN_LABELS, linkedinStartHref, withoutLinkedInParam, type FieldValues, type FillField, type FillOrigin } from './prefill';

// The careers forms filled in for the person to check (owner, 25 October 2026, on "Apply for This Job": "can i use
// linkedin to complete the data?"; asked, "Fill the form from the CV" and "Sign in with LinkedIn"):
// - the CV first, at the top of the form: read as soon as it is chosen (prefill-actions.ts readCv), what it gave put in
//   the fields still empty, each marked "From your CV" until it is changed; the file stays chosen for sending; a file
//   that can't be read says so and never stops the form;
// - "Fill in with LinkedIn" (when it is on): the typed fields kept in the tab while away (the CV can't be: it is asked
//   for again), put back on return, then LinkedIn's name and email in the fields still empty, "From LinkedIn"; a
//   cancelled, failed or switched-off sign-in comes back with a plain note.
// A filled field is mounted again with its new value (the phone and years boxes keep their own state), never one typed
// in. In the careers look (careers.css: .careers-from, .careers-linkedin).

const NO_FILLS: Record<FillField, number> = { fullName: 0, email: 0, mobile: 0, linkedin: 0, yearsExperience: 0 };

/**
 * The fields filled in from the CV or LinkedIn: each field's value and its mount key (bumped to show a new value), and
 * where it came from (the mark by its label). `fill` puts what was found in the fields of `form` still empty, and
 * answers those it filled; `unmark` takes a field's mark away as it is changed.
 */
export function useFormFill() {
  const [values, setValues] = useState<FieldValues<FillField>>({});
  const [keys, setKeys] = useState<Record<FillField, number>>(NO_FILLS);
  const [marks, setMarks] = useState<Partial<Record<FillField, FillOrigin>>>({});

  function fill(form: HTMLFormElement | null, found: FieldValues<FillField>, origin: FillOrigin): FillField[] {
    if (!form) return [];
    const fd = new FormData(form);
    const current = Object.fromEntries(FILL_FIELDS.map((f) => [f, String(fd.get(f) ?? '')])) as FieldValues<FillField>;
    const patch = emptyFieldsPatch(current, found);
    const fields = Object.keys(patch) as FillField[];
    if (!fields.length) return [];
    setValues((v) => ({ ...v, ...patch }));
    setKeys((k) => {
      const next = { ...k };
      for (const f of fields) next[f] += 1;
      return next;
    });
    setMarks((m) => {
      const next = { ...m };
      for (const f of fields) next[f] = origin;
      return next;
    });
    return fields;
  }

  function unmark(field: FillField): void {
    setMarks((m) => {
      if (!m[field]) return m;
      const next = { ...m };
      delete next[field];
      return next;
    });
  }

  return { values, keys, marks, fill, unmark };
}

export type FormFill = ReturnType<typeof useFormFill>;

/** "From your CV" or "From LinkedIn", by a filled field's label. */
export function FromTag({ origin }: { origin: FillOrigin | undefined }) {
  if (!origin) return null;
  return <span className="careers-from">{FILL_ORIGIN_LABELS[origin]}</span>;
}

// ---------- the fields kept while away at LinkedIn ----------

/** Session storage never changes under the page by itself: nothing to subscribe to. */
const noChange = () => () => {};

/** Each form's kept fields, read once (and taken out of the tab), so the page renders them the same each time. */
const taken = new Map<string, string | null>();

function takeDraftText(formKey: string): string | null {
  if (taken.has(formKey)) return taken.get(formKey) ?? null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(draftKey(formKey));
    window.sessionStorage.removeItem(draftKey(formKey));
  } catch {
    raw = null;
  }
  taken.set(formKey, raw);
  return raw;
}

/** Keeps the form's typed fields in the tab while the person signs in with LinkedIn (nothing when storage is blocked). */
export function keepDraft(form: HTMLFormElement | null, formKey: string): void {
  if (!form) return;
  try {
    window.sessionStorage.setItem(draftKey(formKey), JSON.stringify(draftOf(new FormData(form))));
    taken.delete(formKey);
  } catch {
    // storage blocked (a private window): the form comes back empty, LinkedIn's details still fill it
  }
}

/**
 * Back from LinkedIn (`returned`: the address's ?linkedin=): the fields kept before going, read in the browser only (none
 * while rendered on the server, so hydration matches), and whether a CV had been chosen (it must be again).
 */
export function useLinkedInDraft(formKey: string, returned: string | null): { values: Record<string, string>; hadCv: boolean } | null {
  const raw = useSyncExternalStore(
    noChange,
    () => (returned ? takeDraftText(formKey) : null),
    () => null,
  );
  return draftFrom(raw);
}

/**
 * Back from LinkedIn, in the form's wrapper (which stays while the form is put up again with the kept fields): the
 * address loses its ?linkedin= (a reload doesn't take it again); with "done", LinkedIn's details are asked for once
 * (takeLinkedIn: the cookie is read once) and handed to the form (useLinkedInDetails), or kept until it is there. The
 * note to show: the problem's, or LinkedIn's details being gone.
 */
export function useLinkedInReturn(formKey: string, returned: string | null) {
  const [lost, setLost] = useState(false);
  const asked = useRef(false);
  const handler = useRef<((d: LinkedInDetails) => void) | null>(null);
  const pending = useRef<LinkedInDetails | null>(null);
  useEffect(() => {
    if (!returned || asked.current) return;
    asked.current = true;
    const { pathname, search, hash } = window.location;
    window.history.replaceState(window.history.state, '', `${pathname}${withoutLinkedInParam(search)}${hash}`);
    if (returned !== 'done') return;
    takeLinkedIn(formKey)
      .then((d) => {
        if (!d) return setLost(true);
        if (handler.current) handler.current(d);
        else pending.current = d;
      })
      .catch(() => setLost(true));
  }, [formKey, returned]);
  const note = isLinkedInProblem(returned) ? LINKEDIN_PROBLEM_TEXT[returned] : lost ? LINKEDIN_PROBLEM_TEXT.failed : null;
  /** The form listening from now on: the details that came before it (if any), and its stop. */
  const listen = useCallback((fn: (d: LinkedInDetails) => void) => {
    handler.current = fn;
    const waiting = pending.current;
    pending.current = null;
    return {
      waiting,
      stop: () => {
        if (handler.current === fn) handler.current = null;
      },
    };
  }, []);
  return { note, listen };
}

export type LinkedInReturn = ReturnType<typeof useLinkedInReturn>;

/** The form takes LinkedIn's details when they come (`onDetails`, its latest), or those that came before it was up. */
export function useLinkedInDetails(link: LinkedInReturn, onDetails: (d: LinkedInDetails) => void): void {
  const { listen } = link;
  useEffect(() => {
    const { waiting, stop } = listen(onDetails);
    if (waiting) queueMicrotask(() => onDetails(waiting));
    return stop;
  });
}

// ---------- the CV, at the top of the form ----------

const CV_ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const CV_BYTES = RECRUITMENT_LIMITS.cvMb * 1024 * 1024;

type Reading = { kind: 'idle' } | { kind: 'reading' } | { kind: 'filled'; count: number } | { kind: 'failed'; text: string };

/**
 * "Your CV", first on the form: chosen, it is read (readCv) and `onRead` fills the empty fields (answering how many it
 * filled). Under it, "Fill in with LinkedIn" when `linkedin` is given: its link opens in the whole window (the careers
 * pages may be in trendlix.com's frame, and LinkedIn's sign-in is never shown in one), keeping the typed fields first.
 * `note`: LinkedIn's return, in plain words; `hadCv`: back from LinkedIn after choosing a CV, which must be chosen again.
 */
export function CvStart({
  fid,
  onRead,
  linkedin,
  note,
  hadCv,
}: {
  fid: (name: string) => string;
  onRead: (found: CvPrefillResult) => number;
  linkedin: { formKey: string; src: string | null; onLeave: () => void } | null;
  note: string | null;
  hadCv: boolean;
}) {
  const [reading, setReading] = useState<Reading>({ kind: 'idle' });
  const turn = useRef(0);

  async function chosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const mine = ++turn.current;
    if (!file) return setReading({ kind: 'idle' });
    if (file.size > CV_BYTES) return setReading({ kind: 'failed', text: `Your CV must be ${RECRUITMENT_LIMITS.cvMb} MB or smaller.` });
    if (!/\.(pdf|docx)$/i.test(file.name)) return setReading({ kind: 'failed', text: CV_PREFILL_FAILED });
    setReading({ kind: 'reading' });
    const fd = new FormData();
    fd.set('cv', file, file.name);
    let said: Awaited<ReturnType<typeof readCv>>;
    try {
      said = await readCv(fd);
    } catch {
      said = { failed: true };
    }
    // another file chosen meanwhile: that one's answer counts
    if (mine !== turn.current) return;
    if ('failed' in said) return setReading({ kind: 'failed', text: CV_PREFILL_FAILED });
    setReading({ kind: 'filled', count: onRead(said) });
  }

  const statusId = fid('cv-status');
  return (
    <div className="space-y-6 border-b border-line pb-8">
      <div>
        <label htmlFor={fid('cv')} className="label">
          Your CV
        </label>
        <input
          id={fid('cv')}
          name="cv"
          type="file"
          required
          accept={CV_ACCEPT}
          aria-describedby={`${fid('cv-hint')} ${statusId}`}
          onChange={chosen}
          className="input"
        />
        <p id={fid('cv-hint')} className="hint">
          Start with your CV: we&apos;ll fill in what we can for you to check. Your LinkedIn profile saved as a PDF works too (on LinkedIn: your profile → More → Save
          to PDF). A PDF or a Word file (.docx), at most {RECRUITMENT_LIMITS.cvMb} MB.
        </p>
        <div id={statusId} aria-live="polite">
          {reading.kind === 'reading' && <p className="careers-hint">Reading your CV…</p>}
          {reading.kind === 'filled' && reading.count > 0 && <p className="careers-hint">We filled in what we found in your CV: check each field before sending.</p>}
          {reading.kind === 'failed' && <p className="careers-problem">{reading.text}</p>}
          {hadCv && reading.kind === 'idle' && <p className="careers-hint">Choose your CV again: a file can’t be kept while you sign in with LinkedIn.</p>}
        </div>
      </div>
      {linkedin && (
        <div className="space-y-2">
          <a href={linkedinStartHref(LINKEDIN_START_PATH, linkedin.formKey, linkedin.src)} target="_top" onClick={linkedin.onLeave} className="careers-linkedin">
            <LinkedInMark />
            <span>Fill in with LinkedIn</span>
          </a>
          <p className="hint">Your name and email from LinkedIn, for you to check. Nothing else is taken, and no account is made.</p>
        </div>
      )}
      {note && (
        <p role="status" className="careers-note">
          {note}
        </p>
      )}
    </div>
  );
}

function LinkedInMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0" fill="currentColor">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}
