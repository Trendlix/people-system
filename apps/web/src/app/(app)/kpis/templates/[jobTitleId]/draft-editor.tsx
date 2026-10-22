'use client';

import { KPI_TEMPLATE_LIMITS, kpiTemplateProblems, type KpiPillarSet, type KpiTemplateView } from '@trendlix/shared';
import Link from 'next/link';
import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { DeleteForm, FormErrors, useFieldIds } from '@/components/form';
import { Select } from '@/components/select';
import { formatDateTime } from '@/lib/format';
import { KPI_PATHS } from '@/lib/kpi-paths';
import type { FormState } from '@/lib/types';
import {
  aboveTarget,
  addCriterion,
  addMetric,
  baseWeightLabel,
  canMove,
  chooseDuty,
  contentOf,
  draftWeightTotal,
  DUTY_TYPED,
  dutyChoice,
  formGroups,
  formOf,
  moveMetric,
  onlyForPublishing,
  PILLARS_CHANGED_NOTE,
  pillarsFromText,
  removeCriterion,
  removeMetric,
  resetWeights,
  setPillarWeight,
  typedWeights,
  UNPLACED_NOTE,
  UNPLACED_TITLE,
  updateCriterion,
  updateMetric,
  weightedPillars,
  weightsAreBase,
  weightsProblems,
  weightsResetNote,
  type DraftForm,
  type MetricForm,
  type PillarGroup,
} from './builder';

// A job title's KPI template draft, as HR (or the Super Admin) builds it (owner, 21 October 2026: "Full framework per
// role"; "Templates: HR"): the pillars with their weights and max points, the automatic Attendance metric's points
// in its pillar (it can't be removed), and the metrics, each with its pillar, name, definition, how it's
// measured, the JD duty it is linked to (one of the JD's duty rows, beside the builder, or typed), its target points and
// its criteria scale, 2 to 6 rows, a criterion allowed to give more than the target ("above target": a final % may
// reach 110%). Metrics are added, removed and moved within their pillar. What stops it being saved, and what stops it
// being published, show as it is typed (kpiTemplateProblems). Save draft keeps it; Publish saves it and publishes it,
// asking first, as it applies from the next month's scorecards; a Super Admin may discard it.
// The pillars (owner, 21 October 2026: "Fully flexible"): the KPI framework's newest, with their weights, the Attendance
// metric in the pillar the framework chose; a draft written for other pillars is said so, its metrics placed in these
// by name, those whose pillar is gone in Unplaced, last, each to be given a pillar or removed before publishing.
// By department (owner, 22 October 2026: "but i need pillars to each department / wights can be changed for each
// department and Job title"): the pillars are the job title's department's (or the company's), said over them with a
// link to KPI Pillars; each pillar's weight is typed on its header, the department's shown beside it when it differs,
// with the total and "Use the department's weights"; a draft whose own weights were reset (the pillars gained or lost
// one) says so.

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
  pillars,
  fid,
  setForm,
  newKey,
  canUp,
  canDown,
}: {
  metric: MetricForm;
  number: number;
  duties: readonly string[];
  pillars: KpiPillarSet;
  fid: (name: string) => string;
  setForm: SetForm;
  newKey: () => string;
  canUp: boolean;
  canDown: boolean;
}) {
  const id = (field: string) => fid(`${metric.key}-${field}`);
  const update = (patch: Partial<Omit<MetricForm, 'key' | 'id' | 'criteria' | 'wasIn'>>) => setForm((f) => updateMetric(f, metric.key, patch));
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
          <Select id={id('pillar')} value={metric.pillar ?? ''} onChange={(e) => update({ pillar: e.target.value || null })} className="input">
            {metric.pillar === null && <option value="">Choose a pillar</option>}
            {pillars.pillars.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name} ({p.weight}%)
              </option>
            ))}
          </Select>
          {metric.pillar === null && metric.wasIn && <p className="hint text-warn">It was in {metric.wasIn}, which the framework no longer has.</p>}
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

/** A pillar's weight on its header: typed (the job title's own), the department's beside it when it differs. */
function PillarWeight({ pillarKey, name, form, max, baseLabel, fid, setForm }: { pillarKey: string; name: string; form: DraftForm; max: number; baseLabel: string; fid: (name: string) => string; setForm: SetForm }) {
  const id = fid(`weight-${pillarKey}`);
  const base = form.baseWeights?.[pillarKey] ?? null;
  const typed = typedWeights(form)[pillarKey];
  if (base === null) {
    return (
      <p className="text-sm text-muted tabular-nums">
        Weight {form.weights[pillarKey]}% · max {max} points
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
      <label htmlFor={id}>Weight</label>
      <input
        id={id}
        value={form.weights[pillarKey] ?? ''}
        inputMode="numeric"
        autoComplete="off"
        maxLength={3}
        aria-describedby={typed !== base ? `${id}-base` : undefined}
        onChange={(e) => {
          const weight = e.target.value;
          setForm((f) => setPillarWeight(f, pillarKey, weight));
        }}
        className="input min-h-9 w-16 py-1 tabular-nums"
      />
      <span>%</span>
      {typed !== base && (
        <span id={`${id}-base`} className="badge bg-line-soft text-muted">
          <span className="sr-only">{name}: </span>
          {baseLabel}: {base}%
        </span>
      )}
      <span className="tabular-nums">· max {max} points</span>
    </div>
  );
}

function PillarEditor({
  group,
  form,
  duties,
  baseLabel,
  fid,
  setForm,
  newKey,
}: {
  group: PillarGroup<{ form: MetricForm; number: number }>;
  form: DraftForm;
  duties: readonly string[];
  /** Whose weights the base ones are: the department's name, or "Company". */
  baseLabel: string;
  fid: (name: string) => string;
  setForm: SetForm;
  newKey: () => string;
}) {
  const { pillar, metrics, max, attendance } = group;
  const heading = fid(`pillar-${pillar?.key ?? 'unplaced'}`);
  return (
    <section aria-labelledby={heading} className={pillar ? 'space-y-3' : 'space-y-3 rounded-lg border border-warn/40 bg-warn-soft/40 p-4'}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <h3 id={heading} className={pillar ? 'font-semibold' : 'font-semibold text-warn'}>
          {pillar ? pillar.name : UNPLACED_TITLE}
        </h3>
        {pillar && <PillarWeight pillarKey={pillar.key} name={pillar.name} form={form} max={max} baseLabel={baseLabel} fid={fid} setForm={setForm} />}
      </div>
      {!pillar && <p className="max-w-3xl text-sm text-warn">{UNPLACED_NOTE}</p>}
      {attendance && <AttendanceEditor value={form.attendancePoints} fid={fid} setForm={setForm} />}
      {metrics.length > 0 ? (
        <ol className="space-y-3">
          {metrics.map((m) => (
            <MetricEditor
              key={m.form.key}
              metric={m.form}
              number={m.number}
              duties={duties}
              pillars={weightedPillars(form)}
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
      {pillar && (
        <button
          type="button"
          onClick={() => {
            const key = newKey();
            setForm((f) => addMetric(f, pillar.key, key));
          }}
          className="btn btn-secondary"
        >
          Add a metric to {pillar.name}
        </button>
      )}
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
  draft: Pick<KpiTemplateView, 'version' | 'updatedAt' | 'attendancePoints' | 'metrics' | 'pillars' | 'attendancePillar' | 'pillarsChanged'> &
    // an API from before department pillars sends none of these
    Partial<Pick<KpiTemplateView, 'pillarsFrom' | 'baseWeights' | 'ownWeights' | 'weightsReset'>>;
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
  // the KPI framework's newest pillars, which the API placed the draft's metrics in
  const [pillars] = useState<KpiPillarSet>(() => ({ pillars: draft.pillars, attendancePillar: draft.attendancePillar }));
  const [form, setFormState] = useState<DraftForm>(() => formOf(draft, duties, pillars, draft.baseWeights ?? null));
  // the draft as saved, to say when there are changes not saved yet (placed in new pillars, or its own weights reset:
  // not saved so yet)
  const [saved] = useState(() => (draft.pillarsChanged || draft.weightsReset ? '' : JSON.stringify(contentOf(formOf(draft, duties, pillars, draft.baseWeights ?? null)))));
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
  const saving = [...kpiTemplateProblems(content, { pillars }), ...weightsProblems(form)];
  const whose = pillarsFromText(draft.pillarsFrom);
  const baseLabel = baseWeightLabel(draft.pillarsFrom);
  const total = draftWeightTotal(form);
  const publishing = onlyForPublishing(kpiTemplateProblems(content, { publishing: true, pillars }), saving);
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
    fd.set('pillars', JSON.stringify(pillars));
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
        {draft.pillarsChanged && (
          <p role="status" className="mt-3 max-w-3xl rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
            {PILLARS_CHANGED_NOTE}
          </p>
        )}
        {draft.weightsReset && (
          <p role="status" className="mt-3 max-w-3xl rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
            {weightsResetNote(draft.pillarsFrom)}
          </p>
        )}
      </div>
      {form.baseWeights && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-canvas px-4 py-3 text-sm">
          <p className="max-w-xl text-muted">
            {whose ? `${whose}. ` : ''}Type a pillar’s weight on its heading to weight it for this job title only; the pillars themselves are changed on{' '}
            <Link href={KPI_PATHS.pillars}>KPI Pillars</Link>.
          </p>
          <p role="status" aria-live="polite" className={`font-semibold tabular-nums ${total === 100 ? 'text-ok' : 'text-warn'}`}>
            Weights total {total}%{total === 100 ? '' : ': they must add up to 100%'}
          </p>
          <button type="button" disabled={weightsAreBase(form)} onClick={() => setForm(resetWeights)} className="btn btn-secondary min-h-9 py-1">
            {draft.pillarsFrom ? `Use ${draft.pillarsFrom.nameEn}’s weights` : 'Use the company’s weights'}
          </button>
        </div>
      )}
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
          <PillarEditor key={g.pillar?.key ?? 'unplaced'} group={g} form={form} duties={duties} baseLabel={baseLabel} fid={fid} setForm={setForm} newKey={newKey} />
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
