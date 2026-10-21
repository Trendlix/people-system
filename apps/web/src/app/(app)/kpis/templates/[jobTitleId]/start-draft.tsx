'use client';

import { FormErrors, useFieldIds, useKeptForm } from '@/components/form';
import { Select } from '@/components/select';
import type { FormState } from '@/lib/types';
import type { CopyGroup } from '../templates';

// Starting a job title's draft (owner's brief, 21 October 2026: "Offer 'Start from a sample': the 3 samples in
// kpi-framework.json (Senior Frontend Developer, Video Producer, HR Specialist), and 'Copy from another job title'"):
// blank, a copy of its newest published version, a sample, or another job title's version. Each is a form of its own,
// sent to the same action; the draft then opens in the builder. "From the role library" (owner, 21 October 2026: "can
// you add templetes for all departments and job roles"): any role of the KPI role library, the one matching the job
// title chosen to start with, saying why.

export function StartDraft({
  start,
  newestVersion,
  samples,
  copies,
  library,
}: {
  start: (prev: FormState, fd: FormData) => Promise<FormState>;
  /** The newest published version's number, to edit a copy of; null: none published yet. */
  newestVersion: number | null;
  /** The samples, by code; null: they couldn't be read. */
  samples: { code: string; label: string }[] | null;
  /** Other job titles' versions, by department; null: they couldn't be read. */
  copies: CopyGroup[] | null;
  /** The role library's roles by kind, the one suggested for this job title and why; null: they couldn't be read. */
  library: { groups: CopyGroup[]; suggested: string | null; suggestion: string | null } | null;
}) {
  const { state, pending, form } = useKeptForm(start);
  const fid = useFieldIds();

  return (
    <section aria-labelledby={fid('heading')} className="card space-y-5 p-6">
      <div>
        <h2 id={fid('heading')} className="text-lg font-semibold">
          Start a Draft
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          {newestVersion !== null
            ? `Version ${newestVersion} is the newest published. A draft becomes the next version: nothing changes until it is published, and then only from the next month’s scorecards.`
            : 'This job title has no KPI template yet. Build it from its job description, beside this: each key duty becomes a metric with a points scale.'}
        </p>
      </div>
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap gap-3">
        {newestVersion !== null && (
          <form {...form}>
            <input type="hidden" name="from" value="published" />
            <button type="submit" disabled={pending} className="btn btn-primary">
              Edit a copy of version {newestVersion}
            </button>
          </form>
        )}
        <form {...form}>
          <input type="hidden" name="from" value="blank" />
          <button type="submit" disabled={pending} className={`btn ${newestVersion !== null ? 'btn-secondary' : 'btn-primary'}`}>
            Start blank
          </button>
        </form>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <form {...form} className="space-y-2 lg:col-span-2">
          <input type="hidden" name="from" value="library" />
          {library && library.groups.length > 0 ? (
            <>
              <label htmlFor={fid('library')} className="label">
                From the role library
              </label>
              <Select
                id={fid('library')}
                name="libraryKey"
                required
                defaultValue={library.suggested ?? ''}
                aria-describedby={fid('library-hint')}
                className="input max-w-xl"
              >
                <option value="" disabled>
                  Choose a role
                </option>
                {library.groups.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
              <p id={fid('library-hint')} className="hint max-w-3xl">
                {library.suggestion ? `${library.suggestion} ` : ''}
                Its metrics are linked to this job title’s duties where they match, and a title that leads people gets a team leadership metric. Change them to fit
                before publishing.
              </p>
              <button type="submit" disabled={pending} className="btn btn-secondary">
                Start from this role
              </button>
            </>
          ) : (
            <>
              <p className="label">From the role library</p>
              <p className="text-sm text-muted">{library ? 'The role library has no roles.' : 'The role library couldn’t load.'}</p>
            </>
          )}
        </form>

        <form {...form} className="space-y-2">
          <input type="hidden" name="from" value="sample" />
          {samples && samples.length > 0 ? (
            <>
              <label htmlFor={fid('sample')} className="label">
                Start from a sample
              </label>
              <Select id={fid('sample')} name="sampleCode" required defaultValue="" aria-describedby={fid('sample-hint')} className="input">
                <option value="" disabled>
                  Choose a sample
                </option>
                {samples.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <p id={fid('sample-hint')} className="hint">
                The framework’s role templates from the HR KPI sheet: change their metrics to fit this job title before publishing.
              </p>
              <button type="submit" disabled={pending} className="btn btn-secondary">
                Start from this sample
              </button>
            </>
          ) : (
            <>
              <p className="label">Start from a sample</p>
              <p className="text-sm text-muted">{samples ? 'No samples are available.' : 'The samples couldn’t load.'}</p>
            </>
          )}
        </form>

        <form {...form} className="space-y-2">
          <input type="hidden" name="from" value="template" />
          {copies && copies.length > 0 ? (
            <>
              <label htmlFor={fid('copy')} className="label">
                Copy from another job title
              </label>
              <Select id={fid('copy')} name="templateId" required defaultValue="" aria-describedby={fid('copy-hint')} className="input">
                <option value="" disabled>
                  Choose a job title’s version
                </option>
                {copies.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
              <p id={fid('copy-hint')} className="hint">
                Its metrics and points are copied into this job title’s draft; the other job title’s stay as they are.
              </p>
              <button type="submit" disabled={pending} className="btn btn-secondary">
                Copy this template
              </button>
            </>
          ) : (
            <>
              <p className="label">Copy from another job title</p>
              <p className="text-sm text-muted">{copies ? 'No other job title has a template to copy yet.' : 'The other job titles’ templates couldn’t load.'}</p>
            </>
          )}
        </form>
      </div>
      {pending && (
        <p role="status" className="text-sm text-muted">
          Starting the draft…
        </p>
      )}
    </section>
  );
}
