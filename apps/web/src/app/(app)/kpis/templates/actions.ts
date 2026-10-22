'use server';

// KPI Templates (owner, 21 October 2026: "Templates: HR"): HR and the Super Admin start a job title's draft (blank, a
// copy of its newest version, a sample or another job title's), save it, publish it ("Publishing applies from the next
// month"), and change the KPI settings' deadlines; only a Super Admin discards a draft (only a Super Admin deletes:
// owner's decision, 15 October 2026). Each forwards to the API, which checks the session, the role and the rules
// again, so calling these directly can't bypass them; the rules are checked here first only to save a round trip.
// The KPI role library (owner, 21 October 2026: "can you add templetes for all departments and job roles"): a draft from
// one of its roles, "Draft templates for every job title" and "Publish selected drafts", each saying what it did.
// The KPI pillars (owner, 21 October 2026: "Fully flexible"): HR and the Super Admin save the next ones; a draft is
// checked first in the pillars it is placed in (the framework's newest, as the page had them).
// By department (owner, 22 October 2026: "but i need pillars to each department / wights can be changed for each
// department and Job title"): a department's own pillars saved the same way, or its going back to the company's from a
// month; a draft's own weights for its pillars checked first, then sent with it.
import {
  kpiSettingsProblems,
  kpiTemplateProblems,
  kpiWeightsProblems,
  type KpiDraftAllResult,
  type KpiFrameworkInput,
  type KpiPublishDraftsResult,
} from '@trendlix/shared';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from '@/lib/api';
import { KPI_API, KPI_PATHS } from '@/lib/kpi-paths';
import { deleteRefusal } from '@/lib/session';
import type { FormState } from '@/lib/types';
import { shown } from '../../organization/payroll/replies';
import { contentFromJson, pillarsFromJson } from './[jobTitleId]/builder';
import { followCompanySavedText, frameworkSavedText } from './framework';
import { draftSourceOf, SETTING_KEYS, settingsOf, settingsSummary, templateIdsOf, type DraftAllState, type PublishDraftsState } from './templates';

const UUID = /^[0-9a-f-]{36}$/i;

const NOT_FOUND = 'This KPI template could not be found. Please reload the page.';

/** The job title's builder again, saying what was done (the page reads `done`). */
const doneHref = (jobTitleId: string, done: 'started' | 'saved' | 'published' | 'discarded') => `${KPI_PATHS.template(jobTitleId)}?done=${done}`;

/** The API's refusal as the form's errors, its dates as DD/MM/YYYY. */
function refused(err: unknown, before: string[] = []): FormState {
  if (err instanceof ApiError) return { errors: [...before, ...shown(err.messages)] };
  throw err;
}

/** The KPI settings: the four deadlines, days of the month after the scorecard's (PATCH /kpis/settings). */
export async function updateKpiSettings(_prev: FormState, fd: FormData): Promise<FormState> {
  const settings = settingsOf(Object.fromEntries(SETTING_KEYS.map((k) => [k, String(fd.get(k) ?? '')])));
  const problems = kpiSettingsProblems(settings);
  if (problems.length) return { errors: problems };
  try {
    await apiSend('PATCH', KPI_API.settings, settings);
  } catch (err) {
    return refused(err);
  }
  refresh();
  return { message: `Saved: ${settingsSummary(settings)} of the month after the scorecard's.` };
}

/**
 * The next KPI pillars (PUT /kpis/framework), as the form sent them (JSON: KpiFrameworkInput, with the next framework it
 * changed, none: null): the company's, or a department's (`departmentId`, with its name for what the page says), or a
 * department going back to the company's (`followsCompany`, no pillars). The page checked them as typed; the API checks
 * them again.
 */
export async function saveKpiFramework(_prev: FormState, fd: FormData): Promise<FormState> {
  let input: (KpiFrameworkInput & { nextId: string | null; departmentName?: unknown }) | null = null;
  try {
    const value: unknown = JSON.parse(String(fd.get('framework') ?? ''));
    if (value && typeof value === 'object' && !Array.isArray(value)) input = value as KpiFrameworkInput & { nextId: string | null };
  } catch {
    input = null;
  }
  if (!input || !Array.isArray(input.pillars) || typeof input.appliesFrom !== 'string') return { errors: ['The pillars could not be read. Please try again.'] };
  const nextId = typeof input.nextId === 'string' && UUID.test(input.nextId) ? input.nextId : null;
  if (input.departmentId !== undefined && input.departmentId !== null && !(typeof input.departmentId === 'string' && UUID.test(input.departmentId))) {
    return { errors: ['This department could not be found. Please reload the page.'] };
  }
  const departmentId = typeof input.departmentId === 'string' ? input.departmentId : null;
  const follows = departmentId !== null && input.followsCompany === true;
  const department = typeof input.departmentName === 'string' && input.departmentName.trim() ? input.departmentName.trim() : 'The department';
  try {
    // a department's fields only when it is one, so the company's pillars are sent as they always were
    await apiSend('PUT', KPI_API.framework, {
      appliesFrom: input.appliesFrom,
      attendancePillar: follows ? '' : String(input.attendancePillar ?? ''),
      pillars: follows ? [] : input.pillars,
      nextId,
      ...(departmentId && { departmentId }),
      ...(follows && { followsCompany: true }),
    });
  } catch (err) {
    return refused(err);
  }
  refresh();
  if (follows) return { message: followCompanySavedText(department, input.appliesFrom) };
  return { message: frameworkSavedText(input.appliesFrom, departmentId ? department : null) };
}

/** A new draft for the job title, from what the form chose (POST /kpis/templates/job-titles/:id/draft). */
export async function startKpiDraft(jobTitleId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(jobTitleId)) return { errors: [NOT_FOUND] };
  const read = draftSourceOf(fd);
  if ('error' in read) return { errors: [read.error] };
  try {
    await apiSend('POST', KPI_API.newDraft(jobTitleId), read.source);
  } catch (err) {
    return refused(err);
  }
  redirect(doneHref(jobTitleId, 'started'));
}

/**
 * The draft saved as the builder has it (PUT /kpis/templates/:id); with `intent` publish, then published (POST
 * …/publish), what is on screen being what is published.
 */
export async function sendKpiDraft(jobTitleId: string, templateId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(jobTitleId) || !UUID.test(templateId)) return { errors: [NOT_FOUND] };
  const content = contentFromJson(fd.get('content'));
  if (!content) return { errors: ['The draft could not be read. Please try again.'] };
  const publish = fd.get('intent') === 'publish';
  // checked first in the pillars the page placed it in, when it sent them; the API checks it in the framework's newest
  const pillars = pillarsFromJson(fd.get('pillars'));
  const problems = pillars
    ? [...kpiTemplateProblems(content, { publishing: publish, pillars }), ...(content.weights ? kpiWeightsProblems(pillars, content.weights) : [])]
    : [];
  if (problems.length) return { errors: problems };
  try {
    await apiSend('PUT', KPI_API.template(templateId), content);
  } catch (err) {
    return refused(err);
  }
  if (publish) {
    try {
      await apiSend('POST', KPI_API.publish(templateId));
    } catch (err) {
      return refused(err, ['The draft is saved, but it wasn’t published:']);
    }
  }
  redirect(doneHref(jobTitleId, publish ? 'published' : 'saved'));
}

/**
 * "Draft templates for every job title" (POST /kpis/templates/draft-all): a draft from the matched library role for each
 * job title with no draft and no published version; what was made and what was left. The list then shows the drafts.
 */
export async function draftAllKpiTemplates(): Promise<DraftAllState> {
  let result: KpiDraftAllResult | undefined;
  try {
    result = await apiSend<KpiDraftAllResult>('POST', KPI_API.draftAll);
  } catch (err) {
    return refused(err);
  }
  refresh();
  return result ? { result } : { errors: ['The server sent an answer that could not be read. Reload the page to see the drafts.'] };
}

/** "Publish selected drafts" (POST /kpis/templates/publish-drafts): those that pass are published; what stops the others. */
export async function publishKpiDrafts(_prev: PublishDraftsState, fd: FormData): Promise<PublishDraftsState> {
  const templateIds = templateIdsOf(fd);
  if (!templateIds.length) return { errors: ['Choose the drafts to publish.'] };
  let result: KpiPublishDraftsResult | undefined;
  try {
    result = await apiSend<KpiPublishDraftsResult>('POST', KPI_API.publishDrafts, { templateIds });
  } catch (err) {
    return refused(err);
  }
  refresh();
  return result ? { result } : { errors: ['The server sent an answer that could not be read. Reload the page to see what was published.'] };
}

/** The draft discarded (DELETE /kpis/templates/:id): a Super Admin's only. */
export async function discardKpiDraft(jobTitleId: string, templateId: string): Promise<FormState> {
  const refusal = await deleteRefusal();
  if (refusal) return { errors: refusal };
  if (!UUID.test(jobTitleId) || !UUID.test(templateId)) return { errors: [NOT_FOUND] };
  try {
    await apiSend('DELETE', KPI_API.template(templateId));
  } catch (err) {
    return refused(err);
  }
  redirect(doneHref(jobTitleId, 'discarded'));
}
