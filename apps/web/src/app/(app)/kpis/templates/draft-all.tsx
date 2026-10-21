'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { FormErrors, useFieldIds } from '@/components/form';
import { KPI_PATHS } from '@/lib/kpi-paths';
import { draftAllSummary, madeDraftRole, madeDraftUnplaced, type DraftAllState } from './templates';

// "Draft templates for every job title" (owner, 21 October 2026: "can you add templetes for all departments and job
// roles"): one press makes a draft for each job title with no KPI template yet, from the closest role in the KPI role
// library (its title, then its department, else the universal template), its metrics linked to the job title's duties.
// Nothing is published and no other template changes. Asks first; then says what it made, each job title with the role
// it used and why, and the job titles it left and why. The list below then shows them as drafts. The library is written
// for the plan's four pillars (owner, 21 October 2026: "Fully flexible"): a draft's metrics whose pillar the framework
// no longer has are in Unplaced, said on it.

export function DraftAllForm({
  action,
  confirmText,
  withoutTemplate,
}: {
  action: (prev: DraftAllState) => Promise<DraftAllState>;
  confirmText: string;
  /** The job titles with no KPI template yet: those it would draft. */
  withoutTemplate: number;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const result = state.result;
  const nothingLeft = withoutTemplate === 0;
  return (
    <section aria-labelledby={fid('heading')} className="card space-y-4 p-6">
      <div>
        <h2 id={fid('heading')} className="text-lg font-semibold">
          Draft Templates for Every Job Title
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Starts a draft for each job title that has no KPI template yet, from the closest role in the KPI role library: developers, designers, video, content,
          social media, marketing, accounts, projects, sales, HR, finance and the office, or a general one for its kind of department. Each draft’s metrics are
          linked to the job title’s duties where they match, and a title that leads people (head, lead, manager, director, supervisor) gets a team leadership
          metric. Nothing is published: review each draft, then publish it.
        </p>
      </div>
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!window.confirm(confirmText)) e.preventDefault();
        }}
      >
        <button type="submit" disabled={pending || nothingLeft} aria-describedby={nothingLeft ? fid('none') : undefined} className="btn btn-primary">
          {pending ? 'Making the drafts…' : 'Draft templates for every job title'}
        </button>
        {nothingLeft && (
          <p id={fid('none')} className="mt-2 text-sm text-muted">
            Every job title has a KPI template or a draft already.
          </p>
        )}
      </form>
      <FormErrors errors={state.errors} />
      {result && (
        <div role="status" className="space-y-4 rounded-lg border border-line-soft p-4">
          <p className={`text-sm font-semibold ${result.made.length ? 'text-ok' : ''}`}>{draftAllSummary(result)}</p>
          {result.made.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">Drafts Made</h3>
              <ul className="mt-2 max-h-96 divide-y divide-line-soft overflow-y-auto text-sm">
                {result.made.map((m) => (
                  <li key={m.templateId} className="py-2">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <Link href={KPI_PATHS.template(m.jobTitleId)} className="font-medium">
                        {m.title}
                      </Link>
                      <span className="text-xs text-muted">{m.department}</span>
                    </span>
                    <span className="block">
                      <span aria-hidden="true">→ </span>
                      <span className="sr-only">from the role </span>
                      {madeDraftRole(m)}
                    </span>
                    <span className="block text-xs text-muted">{m.reason}</span>
                    {madeDraftUnplaced(m) && <span className="block text-xs text-warn">{madeDraftUnplaced(m)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.skipped.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">Job Titles Skipped</h3>
              <ul className="mt-2 max-h-72 divide-y divide-line-soft overflow-y-auto text-sm">
                {result.skipped.map((s) => (
                  <li key={s.jobTitleId} className="py-2">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <Link href={KPI_PATHS.template(s.jobTitleId)} className="font-medium">
                        {s.title}
                      </Link>
                      <span className="text-xs text-muted">{s.department}</span>
                    </span>
                    <span className="block text-muted">{s.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
