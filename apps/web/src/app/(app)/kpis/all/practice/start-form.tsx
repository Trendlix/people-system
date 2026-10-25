'use client';

import { useState } from 'react';
import type { KpiPracticeChoices } from '@trendlix/shared';
import { FormErrors, useFieldIds, useKeptForm } from '@/components/form';
import { Select } from '@/components/select';
import type { FormState } from '@/lib/types';
import { monthChoiceLabel, personChoiceLabel, START_FIELDS, templateChoiceLabel } from '../../practice';

// "Start a practice scorecard" (owner, 22 October 2026: "I or HR start a practice scorecard for any employee and month,
// from a draft or published template"): the employee (anyone HR may see whose job title has a template), the month
// (this one by default, its attendance so far; any back to the month they joined) and the version (the job title's
// newest by default, a draft first: "Let them pick a draft explicitly, since testing a draft is the point"). It opens
// as the month's real one would, notifies nobody, and opens on its page. While attendance is out of the KPI (owner, 25
// October 2026: "Fixed cut only"), this month isn't said to have its attendance so far: it counts in no score.

export function StartPracticeForm({
  choices,
  action,
  attendanceInKpi = true,
}: {
  choices: KpiPracticeChoices;
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  /** Whether the Attendance metric counts in the KPI (the setting); on unless sent. */
  attendanceInKpi?: boolean;
}) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  const [employeeId, setEmployeeId] = useState('');
  const person = choices.people.find((p) => p.employee.id === employeeId) ?? null;
  const [month, setMonth] = useState(choices.month);
  const [templateId, setTemplateId] = useState('');

  function choosePerson(id: string) {
    setEmployeeId(id);
    const next = choices.people.find((p) => p.employee.id === id);
    // this month when it is theirs, else their latest; their job title's newest version
    setMonth(next?.months.includes(choices.month) ? choices.month : (next?.months[0] ?? choices.month));
    setTemplateId(next?.templates[0]?.id ?? '');
  }

  const chosen = person?.templates.find((t) => t.id === templateId) ?? null;

  return (
    <form {...form} aria-label="Start a practice scorecard" className="card space-y-4 p-5">
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label htmlFor={fid('employee')} className="label">
            Employee
          </label>
          <Select id={fid('employee')} name={START_FIELDS.employee} required value={employeeId} onChange={(e) => choosePerson(e.target.value)} className="input">
            <option value="">Choose…</option>
            {choices.people.map((p) => (
              <option key={p.employee.id} value={p.employee.id}>
                {personChoiceLabel(p)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor={fid('month')} className="label">
            Month
          </label>
          <Select id={fid('month')} name={START_FIELDS.month} required value={month} onChange={(e) => setMonth(e.target.value)} disabled={!person} className="input">
            {(person?.months ?? [choices.month]).map((m) => (
              <option key={m} value={m}>
                {monthChoiceLabel(m, choices.month, attendanceInKpi)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor={fid('template')} className="label">
            Template version
          </label>
          <Select
            id={fid('template')}
            name={START_FIELDS.template}
            required
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            disabled={!person}
            aria-describedby={fid('template-hint')}
            className="input"
          >
            {!person && <option value="">Choose the employee first</option>}
            {(person?.templates ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {templateChoiceLabel(t)}
              </option>
            ))}
          </Select>
          <p id={fid('template-hint')} className="hint">
            {chosen?.draft ? 'The draft as it is saved now: saving a change to it starts this scorecard again.' : 'The newest version is chosen; pick the draft to try it before publishing.'}
          </p>
        </div>
      </div>
      {choices.people.length === 0 && <p className="text-sm text-muted">Nobody to start one for yet: only people whose job title has a KPI template (a draft or published) are listed.</p>}
      <FormErrors errors={state.errors} />
      <button type="submit" disabled={pending || !person} className="btn btn-primary">
        {pending ? 'Starting…' : 'Start practice scorecard'}
      </button>
    </form>
  );
}
