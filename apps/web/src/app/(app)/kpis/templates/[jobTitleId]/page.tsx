import {
  KPI_SAMPLE_TEMPLATES,
  kpiLibraryMatchOf,
  kpiLibraryRoles,
  kpiMonthName,
  type KpiFrameworkView,
  type KpiJobTitleTemplates,
  type KpiLibraryRole,
  type KpiSampleView,
  type KpiTemplateRow,
  type KpiTemplateView,
} from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { RichText } from '@/components/rich-text';
import { apiGet } from '@/lib/api';
import { formatDate, formatDateTime, titleCase } from '@/lib/format';
import { KPI_API, KPI_PATHS } from '@/lib/kpi-paths';
import { isBlankRichText } from '@/lib/rich-text';
import { canDelete } from '@/lib/roles';
import { canEditOrganisation, getCurrentUser } from '@/lib/session';
import { getOrNull } from '../../../approvals/data';
import { todayInCairo } from '../../../employees/ui';
import { BackLink, Empty, Loading, UUID } from '../../../organization/ui';
import { practiceLabel } from '../../practice';
import { discardKpiDraft, sendKpiDraft, startKpiDraft } from '../actions';
import { OLD_PILLARS_BADGE, pillarRowsOf, pillarsMonthOf } from '../framework';
import { TemplateView } from '../template-view';
import { copyChoices, libraryChoices, librarySuggestion, metricsLabel, publishConfirmText, readsKpiTemplates, sampleLabel, userName } from '../templates';
import { DraftEditor } from './draft-editor';
import { StartDraft } from './start-draft';

// A job title's KPI template (owner, 21 October 2026: "Full framework per role"; "Templates: HR"): its job description
// beside the builder ("Show the job title's JD next to the builder, so HR can link duties"), the draft HR is building
// or the ways to start one ("Start from a sample", "Copy from another job title", blank, or a copy of the newest
// version), and the versions published, newest first, each readable as it is: when it opens from, who published it,
// its metrics and the scorecards that opened with it, the one in force marked. Publishing applies from the next month;
// a scorecard keeps the version it opened with, and the history is kept. A manager of someone under the job title, or
// someone under it, may read its published versions ("Managers can view their team's templates"); the API answers
// them those alone, and says whether the caller builds (`canEdit`). A draft may also start from the KPI role library
// (owner, 21 October 2026: "can you add templetes for all departments and job roles"), the role matching the job title
// suggested as "Draft templates for every job title" would pick it.
// The pillars (owner, 21 October 2026: "Fully flexible"): each version shown in its own; the newest marked when it uses
// the old ones, with how to update it; the draft in the KPI framework's newest, published from their first month.
// By department (owner, 22 October 2026: "but i need pillars to each department / wights can be changed for each
// department and Job title"): the draft's pillars are its department's (or the company's), their first month its
// department's when coming; its weights may be the job title's own (the draft editor).

export const metadata: Metadata = { title: 'KPI Template · People System' };

const notSet = <span className="text-muted">Not set</span>;

/** A job description field as it was written. */
const field = (html: string | null) => (html && !isBlankRichText(html) ? <RichText html={html} /> : notSet);

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

/** The job description, read only, beside the builder. */
function JobDescription({ jobTitle, editLink }: { jobTitle: KpiJobTitleTemplates['jobTitle']; editLink: boolean }) {
  return (
    <section aria-labelledby="kpi-jd" className="card space-y-4 p-5">
      <div>
        <h2 id="kpi-jd" className="font-semibold">
          Job Description
        </h2>
        <p className="text-xs text-muted">Link each metric to the duty it measures.</p>
      </div>
      <Part title="Purpose of the Role">{field(jobTitle.jdPurpose)}</Part>
      <Part title="Duties & Responsibilities">{field(jobTitle.jdDuties)}</Part>
      <Part title="Requirements">{field(jobTitle.jdRequirements)}</Part>
      {editLink && (
        <p className="border-t border-line-soft pt-3 text-sm">
          <Link href={`/organization/departments/${jobTitle.department.id}/job-titles/${jobTitle.id}`}>Open the job title to change its job description</Link>
        </p>
      )}
    </section>
  );
}

/** "Opens from 01/11/2026 (October 2026's KPIs on) · published by Mona Adel on 21/10/2026, 5:42 PM · 7 metrics · 12 scorecards". */
function versionFacts(v: KpiTemplateView): string {
  const parts = [
    v.opensFrom ? `Opens from ${formatDate(v.opensFrom)}${v.firstMonth ? ` (${kpiMonthName(v.firstMonth)}’s KPIs on)` : ''}` : null,
    v.publishedAt ? `published${userName(v.publishedBy) ? ` by ${userName(v.publishedBy)}` : ''} on ${formatDateTime(v.publishedAt)}` : null,
    metricsLabel(v.metrics.length),
    `${v.scorecards} ${v.scorecards === 1 ? 'scorecard' : 'scorecards'}`,
    // the practice ones, counted apart (owner, 22 October 2026: "Practice scorecards")
    v.practiceScorecards ? practiceLabel(v.practiceScorecards) : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function Versions({ versions, today, openInForce }: { versions: KpiTemplateView[]; today: string; openInForce: boolean }) {
  return (
    <section aria-labelledby="kpi-versions" className="space-y-3">
      <h2 id="kpi-versions" className="text-lg font-semibold">
        Versions
      </h2>
      {versions.length === 0 ? (
        <Empty>No version is published yet.</Empty>
      ) : (
        <ul className="space-y-3">
          {versions.map((v) => {
            const upcoming = !v.inForce && !!v.opensFrom && v.opensFrom > today;
            // the newest only: an older version is replaced by it anyway
            const old = v.oldPillars && v.id === versions[0].id;
            return (
              <li key={v.id} className="card p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">Version {v.version}</h3>
                  {v.inForce && <span className="badge bg-ok-soft text-ok">In force</span>}
                  {upcoming && <span className="badge">Upcoming</span>}
                  {old && <span className="badge bg-warn-soft text-warn">{OLD_PILLARS_BADGE}</span>}
                </div>
                <p className="mt-1 text-sm text-muted">{versionFacts(v)}</p>
                <details open={openInForce && v.inForce} className="mt-3">
                  <summary className="min-h-9 cursor-pointer text-sm font-semibold text-accent">View version {v.version}</summary>
                  <div className="mt-4">
                    <TemplateView template={v} />
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The draft as those who don't build templates read it (the CEO, an Admin): what it has, read only. */
function DraftReadOnly({ draft }: { draft: KpiTemplateView }) {
  return (
    <section aria-labelledby="kpi-draft" className="card space-y-3 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="kpi-draft" className="text-lg font-semibold">
          Draft
        </h2>
        <span className="badge bg-warn-soft text-warn">Version {draft.version}</span>
      </div>
      <p className="text-sm text-muted">Being prepared by HR; last saved {formatDateTime(draft.updatedAt)}. It changes nothing until it is published.</p>
      <details>
        <summary className="min-h-9 cursor-pointer text-sm font-semibold text-accent">View the draft</summary>
        <div className="mt-4">
          <TemplateView template={draft} headingLevel="h3" />
        </div>
      </details>
    </section>
  );
}

const DONE: Record<string, string> = {
  started: 'Draft started. Change it below, then save it or publish it.',
  saved: 'Draft saved.',
  discarded: 'Draft discarded. The published versions are as they were.',
};

async function Builder({ params, searchParams }: { params: PageProps<'/kpis/templates/[jobTitleId]'>['params']; searchParams: PageProps<'/kpis/templates/[jobTitleId]'>['searchParams'] }) {
  const [{ jobTitleId }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(jobTitleId)) notFound();
  const [user, data] = await Promise.all([getCurrentUser(), apiGet<KpiJobTitleTemplates>(KPI_API.jobTitleTemplates(jobTitleId))]);
  const { jobTitle, draft, versions, canEdit } = data;
  const today = todayInCairo();
  const starting = canEdit && !draft;
  // to start a draft from: the samples, the library's roles and the other job titles' versions, read quietly (none: that
  // choice says so)
  const [samples, rows, roles] = starting
    ? await Promise.all([getOrNull<KpiSampleView[]>(KPI_API.samples), getOrNull<KpiTemplateRow[]>(KPI_API.templates), getOrNull<KpiLibraryRole[]>(KPI_API.library)])
    : [null, null, null];
  // the KPI pillars coming, if any: a version published now applies from their first month (read quietly)
  const framework = canEdit && draft ? await getOrNull<KpiFrameworkView>(KPI_API.framework) : null;
  const oldNewest = versions[0]?.oldPillars ? versions[0] : null;
  // the API's roles; when they can't be read, the same from the shared library (their keys are the API's)
  const libraryRoles = roles ?? kpiLibraryRoles();
  const match = kpiLibraryMatchOf(jobTitle);
  const suggested = libraryRoles.some((r) => r.key === match.key) ? match : null;
  const department = jobTitle.department.parentName ? `${jobTitle.department.parentName} › ${jobTitle.department.nameEn}` : jobTitle.department.nameEn;
  const done = typeof query.done === 'string' ? query.done : null;
  const published = done === 'published' ? (versions[0] ?? null) : null;
  const doneText = published
    ? `Version ${published.version} is published. It applies to the scorecards opened from ${formatDate(published.opensFrom)}${published.firstMonth ? `: ${kpiMonthName(published.firstMonth)}’s KPIs on` : ''}.`
    : done
      ? (DONE[done] ?? null)
      : null;

  return (
    <div className="space-y-6">
      {readsKpiTemplates(user) && <BackLink href={KPI_PATHS.templates}>KPI Templates</BackLink>}
      <div>
        <p className="text-sm text-muted">KPI template</p>
        <h1 className="text-2xl font-semibold">{titleCase(jobTitle.titleEn)}</h1>
        {jobTitle.titleAr && (
          <p lang="ar" dir="rtl" className="w-fit">
            {jobTitle.titleAr}
          </p>
        )}
        <p className="mt-1 text-sm text-muted">{department}</p>
      </div>
      {doneText && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          {doneText}
        </p>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-8">
          {draft && canEdit && (
            <DraftEditor
              // a new editor once the draft is saved again, with the ids the API gave its new metrics
              key={`${draft.id}:${draft.updatedAt}`}
              draft={draft}
              duties={jobTitle.duties}
              action={sendKpiDraft.bind(null, jobTitleId, draft.id)}
              // only a Super Admin deletes (owner's decision, 15 October 2026)
              discard={canDelete(user) ? discardKpiDraft.bind(null, jobTitleId, draft.id) : null}
              confirmPublish={publishConfirmText(draft.version, today, framework ? pillarsMonthOf(framework, pillarRowsOf(framework, jobTitle.department)) : null)}
            />
          )}
          {draft && !canEdit && <DraftReadOnly draft={draft} />}
          {oldNewest && !draft && (
            <p role="status" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
              <span className="font-semibold">Version {oldNewest.version} uses the old pillars.</span>{' '}
              {canEdit
                ? `Start a draft from a copy of it to place its metrics in the new pillars, then publish it. Until a version on the new pillars applies, its scorecards keep opening on version ${oldNewest.version} and its pillars.`
                : `HR updates it to the new pillars. Until then, its scorecards keep opening on version ${oldNewest.version} and its pillars.`}
            </p>
          )}
          {starting && (
            <StartDraft
              start={startKpiDraft.bind(null, jobTitleId)}
              newestVersion={versions[0]?.version ?? null}
              // the API's samples; when they can't be read, the same three from the shared rules (their codes are the API's)
              samples={(samples ?? KPI_SAMPLE_TEMPLATES).map((s) => ({ code: s.code, label: sampleLabel(s) }))}
              copies={rows ? copyChoices(rows, jobTitleId) : null}
              library={{ groups: libraryChoices(libraryRoles), suggested: suggested?.key ?? null, suggestion: suggested ? librarySuggestion(suggested) : null }}
            />
          )}
          {!canEdit && (
            <p className="text-sm text-muted">
              {versions.length ? 'The versions published, newest first. HR builds the templates.' : 'No KPI template is published for this job title yet. HR builds the templates.'}
            </p>
          )}
          <Versions versions={versions} today={today} openInForce={!canEdit} />
        </div>
        <aside className="min-w-0 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto">
          <JobDescription jobTitle={jobTitle} editLink={canEdit && canEditOrganisation(user)} />
        </aside>
      </div>
    </div>
  );
}

export default function KpiTemplatePage({ params, searchParams }: PageProps<'/kpis/templates/[jobTitleId]'>) {
  return (
    <div className="max-w-7xl">
      <Suspense fallback={<Loading />}>
        <Builder params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
