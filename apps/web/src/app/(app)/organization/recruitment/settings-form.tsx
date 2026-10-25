'use client';

import { useActionState } from 'react';
import {
  CAREERS_SITE_LIMITS,
  CAREERS_SITE_STANDARD,
  CV_POSITION_LIMITS,
  INVITE_LIMITS,
  REJECTION_LIMITS,
  SUGGESTION_LIMITS,
  type CvPosition,
  type RecruitmentSettingsView,
} from '@trendlix/shared';
import { FormErrors, useFieldIds } from '@/components/form';
import { titleCase } from '@/lib/format';
import type { FormState } from '@/lib/types';
import { positionField, positionsByTeam } from '../../recruitment/general';

// The rejection email's words (Phase 2, owner, 22 October 2026; the brief: "a polite standard text that an HR-editable
// Recruitment Settings section can change (English and Arabic)"): left empty, the standard words go.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function RejectionWordsForm({ action, settings }: { action: Action; settings: RecruitmentSettingsView }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const v = state.values ?? {};
  return (
    <form action={formAction} className="space-y-4">
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('subject')} className="label">
          Subject
        </label>
        <input
          id={fid('subject')}
          name="rejectionSubject"
          maxLength={REJECTION_LIMITS.subject}
          defaultValue={str(v.rejectionSubject) ?? settings.rejection.subject ?? ''}
          placeholder={settings.standard.subject}
          className="input"
        />
      </div>
      <div>
        <label htmlFor={fid('en')} className="label">
          In English
        </label>
        <textarea id={fid('en')} name="rejectionEn" rows={9} maxLength={REJECTION_LIMITS.text} defaultValue={str(v.rejectionEn) ?? settings.rejection.en ?? ''} placeholder={settings.standard.en} className="input" />
      </div>
      <div>
        <label htmlFor={fid('ar')} className="label">
          In Arabic
        </label>
        <textarea id={fid('ar')} name="rejectionAr" dir="rtl" rows={9} maxLength={REJECTION_LIMITS.text} defaultValue={str(v.rejectionAr) ?? settings.rejection.ar ?? ''} placeholder={settings.standard.ar} className="input" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save the words'}
        </button>
        {state.message && !state.errors && (
          <span role="status" className="text-sm text-ok">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}

/**
 * The careers site's address (owner, 25 October 2026: the careers pages moved to www.trendlix.com/en/careers, and the
 * links should stop relying on people.trendlix.com/careers' redirect): every public careers link is built on it. Shown
 * as in use (the standard when unset); left empty, the standard. The API checks it again.
 */
export function CareersSiteForm({ action, address }: { action: Action; address: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const v = state.values ?? {};
  return (
    <form action={formAction} className="space-y-4">
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('site')} className="label">
          Careers site address
        </label>
        <input
          id={fid('site')}
          name="careersSite"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          maxLength={CAREERS_SITE_LIMITS.address}
          defaultValue={str(v.careersSite) ?? address}
          placeholder={CAREERS_SITE_STANDARD}
          className="input"
        />
        <p className="mt-1 text-xs text-muted">
          The job list’s page, starting with https://, with no ? or #. Leave it empty for the standard, {CAREERS_SITE_STANDARD}.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save'}
        </button>
        {state.message && !state.errors && (
          <span role="status" className="text-sm text-ok">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}

/**
 * Suggested From Earlier CVs (owner, 24 October 2026: "Suggest; HR adds"): how far back general CVs and earlier
 * applications count, 12 months unless changed.
 */
export function SuggestionSettingsForm({ action, settings }: { action: Action; settings: RecruitmentSettingsView }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const v = state.values ?? {};
  return (
    <form action={formAction} className="space-y-4">
      <FormErrors errors={state.errors} />
      <div className="max-w-xs">
        <label htmlFor={fid('months')} className="label">
          Months back CVs count
        </label>
        <input
          id={fid('months')}
          name="suggestMonths"
          type="number"
          inputMode="numeric"
          min={SUGGESTION_LIMITS.recencyMonthsMin}
          max={SUGGESTION_LIMITS.recencyMonthsMax}
          step={1}
          required
          defaultValue={str(v.suggestMonths) ?? String(settings.suggestions.recencyMonths)}
          className="input"
        />
        <p className="mt-1 text-xs text-muted">
          From {SUGGESTION_LIMITS.recencyMonthsMin} to {SUGGESTION_LIMITS.recencyMonthsMax} months; the standard is {SUGGESTION_LIMITS.recencyMonths}.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save'}
        </button>
        {state.message && !state.errors && (
          <span role="status" className="text-sm text-ok">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}

/** The invitation to apply's words (24 October 2026: "Yes, HR presses 'Invite to apply'"): left empty, the standard words go. */
export function InviteWordsForm({ action, settings }: { action: Action; settings: RecruitmentSettingsView }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const v = state.values ?? {};
  return (
    <form action={formAction} className="space-y-4">
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('subject')} className="label">
          Subject
        </label>
        <input
          id={fid('subject')}
          name="inviteSubject"
          maxLength={INVITE_LIMITS.subject}
          defaultValue={str(v.inviteSubject) ?? settings.invite.subject ?? ''}
          placeholder={settings.inviteStandard.subject}
          className="input"
        />
      </div>
      <div>
        <label htmlFor={fid('en')} className="label">
          In English
        </label>
        <textarea id={fid('en')} name="inviteEn" rows={9} maxLength={INVITE_LIMITS.text} defaultValue={str(v.inviteEn) ?? settings.invite.en ?? ''} placeholder={settings.inviteStandard.en} className="input" />
      </div>
      <div>
        <label htmlFor={fid('ar')} className="label">
          In Arabic
        </label>
        <textarea id={fid('ar')} name="inviteAr" dir="rtl" rows={9} maxLength={INVITE_LIMITS.text} defaultValue={str(v.inviteAr) ?? settings.invite.ar ?? ''} placeholder={settings.inviteStandard.ar} className="input" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save the words'}
        </button>
        {state.message && !state.errors && (
          <span role="status" className="text-sm text-ok">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}

/**
 * The positions on "Send us your CV" (owner, 25 October 2026: "should it be the positions?"; asked, "Position, grouped by
 * team"; packages/shared cv-positions.ts): every one under its team, each with a switch, on unless HR hides it from the
 * careers page, and a public name (empty: its own); the job titles it merges under it. Every row is sent on Save.
 */
export function PositionsForm({ action, positions }: { action: Action; positions: readonly CvPosition[] }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const v = state.values;
  const groups = positionsByTeam(positions);
  return (
    <form action={formAction} className="space-y-5">
      <FormErrors errors={state.errors} />
      {groups.map((g) => (
        <fieldset key={g.teamId} className="space-y-2">
          <legend className="text-xs font-semibold tracking-wide text-muted uppercase">{titleCase(g.team)}</legend>
          <ul className="divide-y divide-line-soft rounded-lg border border-line">
            {g.positions.map((p) => {
              const shown = v ? str(v[positionField.shown(p.key)]) === 'on' : !p.hidden;
              return (
                <li key={p.key} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:items-center">
                  <input type="hidden" name={positionField.key} value={p.key} />
                  <input type="hidden" name={positionField.merged(p.key)} value={p.name} />
                  <div className="min-w-0 space-y-1">
                    <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm font-semibold">
                      <input
                        type="checkbox"
                        role="switch"
                        name={positionField.shown(p.key)}
                        defaultChecked={shown}
                        aria-label={`${p.name}: shown on the careers page`}
                        className="size-5 shrink-0 accent-accent"
                      />
                      <span className="break-words">{p.name}</span>
                    </label>
                    <p className="text-xs text-muted break-words">From: {p.titles.join(', ')}</p>
                  </div>
                  <div>
                    <label htmlFor={fid(`name-${p.key}`)} className="label">
                      Public name <span className="font-normal text-muted">(optional)</span>
                    </label>
                    <input
                      id={fid(`name-${p.key}`)}
                      name={positionField.publicName(p.key)}
                      maxLength={CV_POSITION_LIMITS.publicName}
                      defaultValue={v ? (str(v[positionField.publicName(p.key)]) ?? '') : (p.publicName ?? '')}
                      placeholder={p.name}
                      className="input"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
      <p className="hint">The switch on: shown on the careers page. Off: hidden there, still on HR’s lists (marked hidden).</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save the positions'}
        </button>
        {state.message && !state.errors && (
          <span role="status" className="text-sm text-ok">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}

/** The positions as the CEO reads them (they don't change them): by team, the hidden ones marked. */
export function PositionsList({ positions }: { positions: readonly CvPosition[] }) {
  return (
    <div className="space-y-4">
      {positionsByTeam(positions).map((g) => (
        <section key={g.teamId} className="space-y-1">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{titleCase(g.team)}</h3>
          <ul className="space-y-1 text-sm">
            {g.positions.map((p) => (
              <li key={p.key} className={p.hidden ? 'text-muted' : undefined}>
                {p.shownName}
                {p.hidden && <span className="badge ms-2 bg-canvas text-muted">Hidden</span>}
                <span className="block text-xs text-muted">From: {p.titles.join(', ')}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
