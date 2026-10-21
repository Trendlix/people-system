'use server';

// KPI Templates (owner, 21 October 2026: "Templates: HR"): HR and the Super Admin start a job title's draft (blank, a
// copy of its newest version, a sample or another job title's), save it, publish it ("Publishing applies from the next
// month"), and change the KPI settings' deadlines; only a Super Admin discards a draft (only a Super Admin deletes:
// owner's decision, 15 October 2026). Each forwards to the API, which checks the session, the role and the rules
// again, so calling these directly can't bypass them; the rules are checked here first only to save a round trip.
import { kpiSettingsProblems, kpiTemplateProblems } from '@trendlix/shared';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from '@/lib/api';
import { KPI_API, KPI_PATHS } from '@/lib/kpi-paths';
import { deleteRefusal } from '@/lib/session';
import type { FormState } from '@/lib/types';
import { shown } from '../../organization/payroll/replies';
import { contentFromJson } from './[jobTitleId]/builder';
import { draftSourceOf, SETTING_KEYS, settingsOf, settingsSummary } from './templates';

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
  const problems = kpiTemplateProblems(content, { publishing: publish });
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
