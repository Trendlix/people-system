'use client';

import { KPI_ATTENDANCE_PILLAR, KPI_PILLARS, KPI_TEMPLATE_LIMITS, kpiTemplateProblems, type KpiPillarId, type KpiTemplateView } from '@trendlix/shared';
import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { DeleteForm, FormErrors, useFieldIds } from '@/components/form';
import { Select } from '@/components/select';
import { formatDateTime } from '@/lib/format';
import type { FormState } from '@/lib/types';
import {
  aboveTarget,
  addCriterion,
  addMetric,
  canMove,
  chooseDuty,
  contentOf,
  DUTY_TYPED,
  dutyChoice,
  formGroups,
  formOf,
  moveMetric,
  onlyForPublishing,
  removeCriterion,
  removeMetric,
  updateCriterion,
  updateMetric,
  type DraftForm,
  type MetricForm,
  type PillarGroup,
} from './builder';

// A job title's KPI template draft, as HR (or the Super Admin) builds it (owner, 21 October 2026: "Full framework per
// role"; "Templates: HR"): the four pillars with their weights and max points, the automatic Attendance metric's points
// in Discipline & Growth (it can't be removed), and the metrics, each with its pillar, name, definition, how it's
// measured, the JD duty it is linked to (one of the JD's duty rows, beside the builder, or typed), its target points and
// its criteria scale, 2 to 6 rows, a criterion allowed to give more than the target ("above target": a final % may
// reach 110%). Metrics are added, removed and moved within their pillar. What stops it being saved, and what stops it
// being published, show as it is typed (kpiTemplateProblems). Save draft keeps it; Publish saves it and publishes it,
// asking first, as it applies from the next month's scorecards; a Super Admin may discard it.

type SetForm = (change: (form: DraftForm) => DraftForm) => void;

const L = KPI_TEMPLATE_LIMITS;

// small buttons in a metric's row, at least 36px tall for a finger
const small =
  'inline-flex min-h-9 items-center rounded-md px-2.5 text-sm font-semibold text-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';
const smallDanger =
  'inline-flex min-h-9 items-center rounded-md px-2.5 text-sm font-semibold text-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

function CriteriaEditor({ metric, number, id, setForm, newKey }: { metric: MetricForm; number: number; id: (field: string) => string; setForm: SetForm; newKey: () => string }) {
  const criteria = metric.criteria;
  return (
    <fieldset aria-describedby={id('criteria-hint')}>
      <legend className="label">Criteria scale</legend>
      <p id={id('criteria-hint')} className="hint mb-2">
        From {L.criteriaMin} to {L.criteriaMax}, one picked each month, e.g. “No delays” 35, “1–2 delays” 30, “3+ delays” 20. A criterion may give more than the
        target: the final % can then reach 110%.
      </p>
      <ol className="space-y-2">
        {criteria.map((c, j) => (
          <li key={c.key} className="flex flex-wrap items-center gap-2">
            <span aria-hidden="true" className="w-5 text-right text-sm text-muted tabular-nums">
              {j + 1}.
            </span>
            <label htmlFor={id(`${c.key}-label`)} className="sr-only">
              Metric {number}, criterion {j + 1}: label
            </label>
            <input
              id={id(`${c.key}-label`)}
              value={c.label}
              maxLength={L.label}
              autoComplete="off"
              placeholder="What it says"
              onChange={(e) => {
                const label = e.target.value;
                setForm((f) => updateCriterion(f, metric.key, c.key, { label }));
              }}
              className="input min-w-40 flex-1"
            />
            <label htmlFor={id(`${c.key}-points`)} className="sr-only">
              Metric {number}, criterion {j + 1}: points
            </label>
            <input
              id={id(`${c.key}-points`)}
              value={c.points}
              inputMode="numeric"
              autoComplete="off"
              maxLength={3}
              onChange={(e) => {
                const points = e.target.value;
                setForm((f) => updateCriterion(f, metric.key, c.key, { points }));
              }}
              className="input w-20 tabular-nums"
            />
            <span className="text-sm text-muted">points</span>
            {aboveTarget(c.points, metric.targetPoints) && <span className="badge">Above target</span>}
            <button
              type="button"
              disabled={criteria.length <= L.criteriaMin}
              onClick={() => setForm((f) => removeCriterion(f, metric.key, c.key))}
              className={smallDanger}
            >
              Remove<span className="sr-only"> criterion {j + 1} of metric {number}</span>
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        disabled={criteria.length >= L.criteriaMax}
        onClick={() => {
          const key = newKey();
          setForm((f) => addCriterion(f, metric.key, key));
        }}
        className={`${small} mt-2`}
      >
        Add a criterion<span className="sr-only"> to metric {number}</span>
      </button>
    </fieldset>
  );
}

function MetricEditor({
  metric,
  number,
  duties,
  fid,
  setForm,
  newKey,
  canUp,
  canDown,
}: {
  metric: MetricForm;
  number: number;
  duties: readonly string[];
  fid: (name: string) => string;
  setForm: SetForm;
  newKey: () => string;
  canUp: boolean;
  canDown: boolean;
}) {
  const id = (field: string) => fid(`${metric.key}-${field}`);
  const update = (patch: Partial<Omit<MetricForm, 'key' | 'id' | 'criteria'>>) => setForm((f) => updateMetric(f, metric.key, patch));
  const choice = dutyChoice(metric, duties);
  return (
    <li className="space-y-4 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={id('heading')} className="font-semibold">
          Metric {number}
        </h4>
        <div className="flex flex-wrap gap-1">
          <button type="button" disabled={!canUp} onClick={() => setForm((f) => moveMetric(f, metric.key, -1))} className={small}>
            Move up<span className="sr-only"> metric {number}</span>
          </button>
          <button type="button" disabled={!canDown} onClick={() => setForm((f) => moveMetric(f, metric.key, 1))} className={small}>
            Move down<span className="sr-only"> metric {number}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const name = metric.name.trim();
              if (name && !window.confirm(`Remove metric ${number} (${name}) and its criteria?`)) return;
              setForm((f) => removeMetric(f, metric.key));
            }}
            className={smallDanger}
          >
            Remove<span className="sr-only"> metric {number}</span>
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_15rem]">
        <div>
          <label htmlFor={id('name')} className="label">
            Name
          </label>
          <input
            id={id('name')}
            value={metric.name}
            maxLength={L.name}
            autoComplete="off"
            placeholder="e.g. Sprint tasks delivered on time"
            onChange={(e) => update({ name: e.target.value })}
            className="input"
          />
        </div>
        <div>
          <label htmlFor={id('pillar')} className="label">
            Pillar
          </label>
          <Select id={id('pillar')} value={String(metric.pillar)} onChange={(e) => update({ pillar: Number(e.target.value) as KpiPillarId })} className="input">
            {KPI_PILLARS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.weight}%)
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor={id('definition')} className="label">
            Definition <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id={id('definition')}
            rows={2}
            value={metric.definition}
            maxLength={L.text}
            placeholder="What it is about"
            onChange={(e) => update({ definition: e.target.value })}
            className="input"
          />
        </div>
        <div>
          <label htmlFor={id('howMeasured')} className="label">
            How it’s measured <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id={id('howMeasured')}
            rows={2}
            value={metric.howMeasured}
            maxLength={L.text}
            placeholder="Where the figure comes from"
            onChange={(e) => update({ howMeasured: e.target.value })}
            className="input"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <div className="space-y-2">
          <div>
            <label htmlFor={id('duty')} className="label">
              JD duty <span className="font-normal text-muted">(optional)</span>
            </label>
            <Select
              id={id('duty')}
              value={choice}
              onChange={(e) => update(chooseDuty(metric, e.target.value))}
              aria-describedby={id('duty-hint')}
              className="input"
            >
              <option value="">None</option>
              {duties.length > 0 && (
                <optgroup label="The job description’s duties">
                  {duties.map((d, i) => (
                    <option key={`${i}:${d}`} value={d}>
                      {d}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value={DUTY_TYPED}>{duties.length > 0 ? 'Type another duty' : 'Type the duty'}</option>
            </Select>
            <p id={id('duty-hint')} className="hint">
              {duties.length > 0 ? 'The duty of the job description it measures.' : 'The job description has no duties listed: type the duty it measures.'}
            </p>
          </div>
          {metric.dutyTyped && (
            <div>
              <label htmlFor={id('dutyText')} className="label">
                Duty
              </label>
              <input
                id={id('dutyText')}
                value={metric.jdDuty}
                maxLength={L.duty}
                autoComplete="off"
                onChange={(e) => update({ jdDuty: e.target.value })}
                className="input"
              />
            </div>
          )}
        </div>
        <div>
          <label htmlFor={id('target')} className="label">
            Target points
          </label>
          <input
            id={id('target')}
            value={metric.targetPoints}
            inputMode="numeric"
            autoComplete="off"
            maxLength={3}
            aria-describedby={id('target-hint')}
            onChange={(e) => update({ targetPoints: e.target.value })}
            className="input w-24 tabular-nums"
          />
          <p id={id('target-hint')} className="hint">
            What counts as 100% of it.
          </p>
        </div>
      </div>

      <CriteriaEditor metric={metric} number={number} id={id} setForm={setForm} newKey={newKey} />
    </li>
  );
}

/** The automatic Attendance metric (owner, 21 October 2026: "Attendance: Yes, as the sheet"): its points alone. */
function AttendanceEditor({ value, fid, setForm }: { value: string; fid: (name: string) => string; setForm: SetForm }) {
  return (
    <div className="rounded-lg bg-canvas p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Attendance</span>
        <span className="badge bg-line-soft text-muted">Automatic</span>
      </div>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Filled in by the system each month: its points × the month’s attendance score as payroll works it out (worked ÷ expected hours, in full at or above
        the attendance grace). Nobody picks it, and it can’t be removed.
      </p>
      <label htmlFor={fid('attendancePoints')} className="label mt-3">
        Points
      </label>
      <input
        id={fid('attendancePoints')}
        value={value}
        inputMode="numeric"
        autoComplete="off"
        maxLength={3}
        onChange={(e) => {
          const attendancePoints = e.target.value;
          setForm((f) => ({ ...f, attendancePoints }));
        }}
        className="input w-24 tabular-nums"
      />
    </div>
  );
}

function PillarEditor({
  group,
  form,
  duties,
  fid,
  setForm,
  newKey,
}: {
  group: PillarGroup<{ form: MetricForm; number: number }>;
  form: DraftForm;
  duties: readonly string[];
  fid: (name: string) => string;
  setForm: SetForm;
  newKey: () => string;
}) {
  const { pillar, metrics, max } = group;
  const heading = fid(`pillar-${pillar.id}`);
  const attendance = pillar.id === KPI_ATTENDANCE_PILLAR;
  return (
    <section aria-labelledby={heading} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
        <h3 id={heading} className="font-semibold">
          {pillar.name}
        </h3>
        <p className="text-sm text-muted tabular-nums">
          Weight {pillar.weight}% · max {max} points
        </p>
      </div>
      {attendance && <AttendanceEditor value={form.attendancePoints} fid={fid} setForm={setForm} />}
      {metrics.length > 0 ? (
        <ol className="space-y-3">
          {metrics.map((m) => (
            <MetricEditor
              key={m.form.key}
              metric={m.form}
              number={m.number}
              duties={duties}
              fid={fid}
              setForm={setForm}
              newKey={newKey}
              canUp={canMove(form, m.form.key, -1)}
              canDown={canMove(form, m.form.key, 1)}
            />
          ))}
        </ol>
      ) : (
        !attendance && <p className="text-sm text-muted">No metric yet. Every pillar is scored: add one before publishing.</p>
      )}
      <button
        type="button"
        onClick={() => {
          const key = newKey();
          setForm((f) => addMetric(f, pillar.id, key));
        }}
        className="btn btn-secondary"
      >
        Add a metric to {pillar.name}
      </button>
    </section>
  );
}

/** What stops the draft being saved, and what stops it being published, as it is typed. */
function Problems({ saving, publishing }: { saving: string[]; publishing: string[] }) {
  if (!saving.length && !publishing.length) return <p className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">Ready to publish.</p>;
  return (
    <div className="space-y-3">
      {saving.length > 0 && (
        <div className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          <p className="font-semibold">Before it can be saved:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {saving.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {publishing.length > 0 && (
        <div className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          <p className="font-semibold">Before it can be published:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {publishing.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function DraftEditor({
  draft,
  duties,
  action,
  discard,
  confirmPublish,
}: {
  draft: Pick<KpiTemplateView, 'version' | 'updatedAt' | 'attendancePoints' | 'metrics'>;
  /** The JD's duty rows, to link a metric to. */
  duties: readonly string[];
  /** Saves the draft, or (`intent` publish) saves and publishes it. */
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  /** A Super Admin's only; null for anyone else. */
  discard: ((prev: FormState, fd: FormData) => Promise<FormState>) | null;
  /** What Publish asks first. */
  confirmPublish: string;
}) {
  const fid = useFieldIds();
  const [form, setFormState] = useState<DraftForm>(() => formOf(draft, duties));
  // the draft as saved, to say when there are changes not saved yet
  const [saved] = useState(() => JSON.stringify(contentOf(formOf(draft, duties))));
  const [state, dispatch, pending] = useActionState(action, {});
  const [intent, setIntent] = useState<'save' | 'publish'>('save');
  const counter = useRef(0);
  // the form's own keys for the metrics and criteria added: only made in event handlers
  const newKey = () => {
    counter.current += 1;
    return `n${counter.current}`;
  };
  const setForm: SetForm = (change) => setFormState(change);

  const content = contentOf(form);
  const saving = kpiTemplateProblems(content);
  const publishing = onlyForPublishing(kpiTemplateProblems(content, { publishing: true }), saving);
  const dirty = JSON.stringify(content) !== saved;

  // leaving the page (closing it, reloading) with changes not saved asks first
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function submit(which: 'save' | 'publish') {
    if (which === 'publish' && !window.confirm(confirmPublish)) return;
    setIntent(which);
    const fd = new FormData();
    fd.set('intent', which);
    fd.set('content', JSON.stringify(content));
    startTransition(() => dispatch(fd));
  }

  return (
    <section aria-labelledby={fid('heading')} className="card space-y-6 p-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={fid('heading')} className="text-lg font-semibold">
            Draft
          </h2>
          <span className="badge bg-warn-soft text-warn">Version {draft.version}</span>
          {dirty && <span className="badge bg-line-soft text-muted">Changes not saved</span>}
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Last saved {formatDateTime(draft.updatedAt)}. Nothing changes until it is published; then it applies to the scorecards opened from the next month on.
        </p>
      </div>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!pending && saving.length === 0) submit('save');
        }}
        className="space-y-8"
      >
        <FormErrors errors={state.errors} />
        {formGroups(form).map((g) => (
          <PillarEditor key={g.pillar.id} group={g} form={form} duties={duties} fid={fid} setForm={setForm} newKey={newKey} />
        ))}
        <Problems saving={saving} publishing={publishing} />
        <div className="flex flex-wrap items-center gap-3 border-t border-line-soft pt-5">
          <button type="submit" disabled={pending || saving.length > 0} className="btn btn-secondary">
            {pending && intent === 'save' ? 'Saving…' : 'Save draft'}
          </button>
          <button type="button" disabled={pending || saving.length > 0 || publishing.length > 0} onClick={() => submit('publish')} className="btn btn-primary">
            {pending && intent === 'publish' ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </form>
      {discard && (
        <div className="border-t border-line-soft pt-5">
          <DeleteForm
            action={discard}
            confirmText={`Discard the draft of version ${draft.version}? What it has is lost; the published versions stay as they are.`}
            label="Discard draft"
          />
        </div>
      )}
    </section>
  );
}
