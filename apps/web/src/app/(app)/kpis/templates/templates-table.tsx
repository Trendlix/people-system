'use client';

import type { KpiTemplateRow } from '@trendlix/shared';
import Link from 'next/link';
import { Fragment, useActionState, useState } from 'react';
import { FormErrors } from '@/components/form';
import { titleCase } from '@/lib/format';
import { KPI_PATHS } from '@/lib/kpi-paths';
import { latestMonth, OLD_PILLARS_BADGE } from './framework';
import {
  draftIdsOf,
  jobTitlesLabel,
  peopleLabel,
  publishDraftsConfirmText,
  publishDraftsSummary,
  publishTimingNote,
  refusedDraftName,
  templateRowText,
  type PublishDraftsState,
  type TemplateGroup,
} from './templates';

// The job titles on KPI Templates (owner, 21 October 2026: "Templates: HR"), by department and team, each with its
// version in force, the one opening next month, its draft, its versions and its people, each opening its builder. For
// HR and the Super Admin, "Publish selected drafts" (owner, 21 October 2026: "can you add templetes for all departments
// and job roles"): a box on each draft, one to choose them all, a confirm, then what was published and what stopped the
// others (each stays a draft). Publishing now applies from next month's scorecards, those for this month, or, while new
// KPI pillars are coming (owner, 21 October 2026: "Fully flexible"), from their first month's. A job title whose
// newest version uses the old pillars is marked. By department (owner, 22 October 2026: "but i need pillars to each
// department"): each draft's own pillars' first month, its department's or the company's; the confirm says the latest
// of those chosen.

const none = <span className="text-muted">—</span>;

/** `choice`: its draft's box (null: no draft to choose); undefined: no boxes on the list. */
function TemplateRow({ row, choice }: { row: KpiTemplateRow; choice?: { checked: boolean; toggle: () => void } | null }) {
  const text = templateRowText(row);
  const nothing = !text.inForce && !text.upcoming && !text.draft;
  return (
    <tr>
      {choice !== undefined && (
        <td className="w-10">
          {choice && row.draft && (
            <input
              type="checkbox"
              checked={choice.checked}
              onChange={choice.toggle}
              aria-label={`Select the draft of ${row.jobTitle.titleEn}`}
              className="size-5 accent-accent"
            />
          )}
        </td>
      )}
      <td className="min-w-56">
        <Link href={KPI_PATHS.template(row.jobTitle.id)} className="font-semibold">
          {row.jobTitle.titleEn}
        </Link>
        {nothing && <span className="block text-xs text-muted">No KPI template yet</span>}
        {row.oldPillars && <span className="badge mt-1 bg-warn-soft text-warn">{OLD_PILLARS_BADGE}</span>}
      </td>
      <td className="min-w-48 text-sm">
        {text.inForce ? (
          <>
            <span className="badge bg-ok-soft text-ok">In force</span>
            <span className="mt-1 block">{text.inForce}</span>
          </>
        ) : (
          none
        )}
      </td>
      <td className="min-w-44 text-sm">
        {text.upcoming ? (
          <>
            <span className="badge">Upcoming</span>
            <span className="mt-1 block">{text.upcoming}</span>
          </>
        ) : (
          none
        )}
      </td>
      <td className="min-w-40 text-sm">
        {text.draft ? (
          <>
            <span className="badge bg-warn-soft text-warn">Draft</span>
            <span className="mt-1 block">{text.draft}</span>
          </>
        ) : (
          none
        )}
      </td>
      <td className="text-right tabular-nums">{row.versions}</td>
      <td className="text-right whitespace-nowrap tabular-nums">{peopleLabel(row.people)}</td>
    </tr>
  );
}

export function TemplatesTable({
  groups,
  publish,
  today,
  pillarsFrom,
  draftPillarsFrom = {},
}: {
  groups: TemplateGroup[];
  /** "Publish selected drafts" (HR, the Super Admin); null: the list only. */
  publish: ((prev: PublishDraftsState, fd: FormData) => Promise<PublishDraftsState>) | null;
  /** Today in Cairo, YYYY-MM-DD: when what is published now applies. */
  today: string;
  /** The month the company's next KPI pillars apply from (YYYY-MM); null: none coming. */
  pillarsFrom: string | null;
  /** By draft id: the month its pillars (its department's, or the company's) apply from while still to come; null: in force. */
  draftPillarsFrom?: Readonly<Record<string, string | null>>;
}) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [state, formAction, pending] = useActionState(publish ?? (async (prev: PublishDraftsState) => prev), {});
  const drafts = groups.flatMap((g) => g.teams.flatMap((t) => draftIdsOf(t.rows)));
  // those still drafts: one published meanwhile drops out
  const selected = drafts.filter((id) => chosen.has(id));
  const all = drafts.length > 0 && selected.length === drafts.length;
  const span = publish ? 7 : 6;

  const toggle = (id: string) =>
    setChosen((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-3">
      {publish && (
        <div className="space-y-3">
          <form
            action={formAction}
            onSubmit={(e) => {
              // the latest pillars' month of the drafts chosen; a draft not known, the company's
              const month = latestMonth(selected.map((id) => (id in draftPillarsFrom ? draftPillarsFrom[id] : pillarsFrom)));
              if (!selected.length || !window.confirm(publishDraftsConfirmText(selected.length, today, month))) e.preventDefault();
            }}
            className="flex flex-wrap items-center gap-x-4 gap-y-2"
          >
            {selected.map((id) => (
              <input key={id} type="hidden" name="templateIds" value={id} />
            ))}
            <button type="submit" disabled={pending || !selected.length} className="btn btn-secondary">
              {pending ? 'Publishing…' : selected.length ? `Publish selected drafts (${selected.length})` : 'Publish selected drafts'}
            </button>
            <p className="max-w-2xl text-sm text-muted">
              {drafts.length ? 'Tick the drafts to publish, or all of them in the header. ' : 'No job title has a draft to publish. '}
              {publishTimingNote(today, pillarsFrom)}
            </p>
          </form>
          <FormErrors errors={state.errors} />
          {state.result && (
            <div role="status" className="space-y-3 rounded-lg border border-line-soft p-4 text-sm">
              <p className={`font-semibold ${state.result.published.length ? 'text-ok' : ''}`}>{publishDraftsSummary(state.result)}</p>
              {state.result.published.length > 0 && (
                <div>
                  <h3 className="font-semibold">Published</h3>
                  <ul className="mt-1 max-h-60 list-disc space-y-0.5 overflow-y-auto pl-5">
                    {state.result.published.map((p) => (
                      <li key={p.templateId}>
                        <Link href={KPI_PATHS.template(p.jobTitleId)}>{p.title}</Link>, version {p.version}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {state.result.problems.length > 0 && (
                <div>
                  <h3 className="font-semibold">Not Published</h3>
                  <ul className="mt-1 max-h-72 space-y-2 overflow-y-auto">
                    {state.result.problems.map((p) => (
                      <li key={p.templateId}>
                        {p.jobTitleId ? <Link href={KPI_PATHS.template(p.jobTitleId)}>{refusedDraftName(p)}</Link> : refusedDraftName(p)}
                        <ul className="mt-0.5 list-disc pl-5 text-muted">
                          {p.problems.map((problem) => (
                            <li key={problem}>{problem}</li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              {publish && (
                <th scope="col" className="w-10">
                  <input
                    type="checkbox"
                    checked={all}
                    ref={(el) => {
                      if (el) el.indeterminate = selected.length > 0 && !all;
                    }}
                    disabled={!drafts.length}
                    onChange={() => setChosen(all ? new Set() : new Set(drafts))}
                    aria-label="Select all drafts"
                    className="size-5 accent-accent"
                  />
                </th>
              )}
              <th scope="col">Job title</th>
              <th scope="col">In force</th>
              <th scope="col">Upcoming</th>
              <th scope="col">Draft</th>
              <th scope="col" className="text-right">
                Versions
              </th>
              <th scope="col" className="text-right">
                People
              </th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.department}>
              <tr>
                <th colSpan={span} scope="colgroup" className="bg-canvas py-2.5 text-left text-sm tracking-normal text-ink normal-case">
                  <span className="sticky left-4 inline-flex flex-wrap items-baseline gap-x-2">
                    {titleCase(g.department)}
                    <span className="text-xs font-normal text-muted">{jobTitlesLabel(g.count)}</span>
                  </span>
                </th>
              </tr>
              {g.teams.map((t) => (
                <Fragment key={t.team ?? ''}>
                  {t.team !== null && (
                    <tr>
                      <th colSpan={span} scope="colgroup" className="bg-card py-2 text-left text-sm font-medium tracking-normal text-muted normal-case">
                        <span className="sticky left-4 inline-flex pl-4">{titleCase(t.team)}</span>
                      </th>
                    </tr>
                  )}
                  {t.rows.map((r) => (
                    <TemplateRow
                      key={r.jobTitle.id}
                      row={r}
                      choice={publish ? (r.draft ? { checked: chosen.has(r.draft.id), toggle: () => toggle(r.draft!.id) } : null) : undefined}
                    />
                  ))}
                </Fragment>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
