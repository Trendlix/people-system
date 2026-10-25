'use client';

import { useActionState, useState } from 'react';
import { PORTFOLIO_KIND_LABELS, PORTFOLIO_KINDS, PORTFOLIO_LIMITS, PORTFOLIO_MODE_LABELS, PORTFOLIO_MODES, type PortfolioMode, type PortfolioPositionView } from '@trendlix/shared';
import { FormErrors, useFieldIds } from '@/components/form';
import { Select } from '@/components/select';
import { titleCase } from '@/lib/format';
import type { FormState } from '@/lib/types';
import { askWithTitleText, LINK_CHOICES, portfolioByTeam, portfolioField, rowValues } from '../../recruitment/portfolio';

// Recruitment Settings' "Portfolio on the Forms" (owner, 25 October 2026, on "Apply for This Job": "for creatives, they
// need to add their portfolios. so based on the positions i have, what kind of portfolios i might need to ask them
// for?"; asked, "Portfolio per position"; packages/shared portfolio.ts): every position under its team, as "Positions on
// the CV Form" lists them, each with what the careers forms ask: Hidden, Optional or Required, a hint under the field,
// the kinds taken and how many links (1 to 3). A position HR never set shows the rule's default (marked "Default");
// saving one sets every job title it merges, and a row left as its default stays the default. Every row is sent on Save.
// Beside the hint, the section title (owner, 26 October 2026, on the careers site's form: "i cant visualize that this is
// a portfolio section"; asked, "a section title per position"): the portfolio part's heading, blank for the rule's (its
// placeholder).

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

function Row({ p, sent }: { p: PortfolioPositionView; sent?: Record<string, string | string[]> }) {
  const fid = useFieldIds();
  const start = rowValues(p, sent);
  const [mode, setMode] = useState<PortfolioMode>(start.mode);
  const asked = mode !== 'hidden';
  return (
    <li className="grid gap-4 p-4 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
      <input type="hidden" name={portfolioField.key} value={p.key} />
      <div className="min-w-0 space-y-1">
        <p className="font-semibold break-words">
          {p.name}
          {!p.set && <span className="badge ms-2 bg-canvas align-middle text-muted">Default</span>}
          {p.hidden && <span className="badge ms-2 bg-canvas align-middle text-muted">Hidden from the CV form</span>}
        </p>
        <p className="text-xs break-words text-muted">From: {p.titles.join(', ')}</p>
        {p.mixed && <p className="text-xs text-warn">Its job titles ask differently: saving makes them one.</p>}
      </div>
      <div className="min-w-0 space-y-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,9rem)_minmax(0,7rem)]">
          <div>
            <label htmlFor={fid('mode')} className="label">
              On the forms
            </label>
            <Select id={fid('mode')} name={portfolioField.mode(p.key)} value={mode} onChange={(e) => setMode(e.target.value as PortfolioMode)} className="input">
              {PORTFOLIO_MODES.map((m) => (
                <option key={m} value={m}>
                  {PORTFOLIO_MODE_LABELS[m]}
                </option>
              ))}
            </Select>
          </div>
          <div className={asked ? undefined : 'opacity-60'}>
            <label htmlFor={fid('links')} className="label">
              Links allowed
            </label>
            <Select id={fid('links')} name={portfolioField.links(p.key)} defaultValue={String(start.maxLinks)} className="input">
              {LINK_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {/* what the form shows of it: the section's heading, and the hint under it (26 October 2026) */}
        <div className={`grid gap-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]${asked ? '' : ' opacity-60'}`}>
          <div>
            <label htmlFor={fid('title')} className="label">
              Section title <span className="font-normal text-muted">(blank: the default)</span>
            </label>
            <input id={fid('title')} name={portfolioField.title(p.key)} maxLength={PORTFOLIO_LIMITS.title} defaultValue={start.title} placeholder={p.defaultAsk.title} className="input" />
          </div>
          <div>
            <label htmlFor={fid('hint')} className="label">
              Hint <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id={fid('hint')}
              name={portfolioField.hint(p.key)}
              maxLength={PORTFOLIO_LIMITS.hint}
              defaultValue={start.hint}
              placeholder={p.defaultAsk.hint ?? 'e.g. A showreel on Vimeo or YouTube'}
              className="input"
            />
          </div>
        </div>
        <fieldset className={asked ? undefined : 'opacity-60'}>
          <legend className="label">Kinds taken</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {PORTFOLIO_KINDS.map((k) => (
              <label key={k} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" name={portfolioField.kinds(p.key)} value={k} defaultChecked={start.kinds.includes(k)} className="size-4 shrink-0 accent-accent" />
                {PORTFOLIO_KIND_LABELS[k]}
              </label>
            ))}
          </div>
        </fieldset>
        {!asked && <p className="hint">Hidden: the forms don’t ask for a portfolio. The kinds and hint stay for a vacancy that asks for one anyway.</p>}
      </div>
    </li>
  );
}

/** HR's form (HR and a Super Admin): every position, by team. */
export function PortfolioSettingsForm({ action, positions }: { action: Action; positions: readonly PortfolioPositionView[] }) {
  const [state, formAction, pending] = useActionState(action, {});
  const groups = portfolioByTeam(positions);
  return (
    <form action={formAction} className="space-y-5">
      <FormErrors errors={state.errors} />
      {groups.map((g) => (
        <fieldset key={g.teamId} className="space-y-2">
          <legend className="text-xs font-semibold tracking-wide text-muted uppercase">{titleCase(g.team)}</legend>
          <ul className="divide-y divide-line-soft rounded-lg border border-line">
            {g.positions.map((p) => (
              <Row key={p.key} p={p} sent={state.values} />
            ))}
          </ul>
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save the portfolio settings'}
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

/** The settings as the CEO reads them (they don't change them): by team, each position's ask in words. */
export function PortfolioSettingsList({ positions }: { positions: readonly PortfolioPositionView[] }) {
  return (
    <div className="space-y-4">
      {portfolioByTeam(positions).map((g) => (
        <section key={g.teamId} className="space-y-1">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{titleCase(g.team)}</h3>
          <ul className="space-y-1 text-sm">
            {g.positions.map((p) => (
              <li key={p.key}>
                <span className="font-medium">{p.name}</span>
                {!p.set && <span className="badge ms-2 bg-canvas text-muted">Default</span>}
                <span className="block text-xs text-muted">
                  {askWithTitleText(p.ask)}
                  {p.ask.hint ? ` · “${p.ask.hint}”` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
