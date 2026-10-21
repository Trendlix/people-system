'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DepartmentOrTeamOptions } from '@/components/department-options';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { RichTextEditor } from '@/components/rich-text-editor';
import { Select } from '@/components/select';
import type { Department, FormState, Grade, JobTitle } from '@/lib/types';
import { gradeLabel } from '../grades/label';

/**
 * A job title and its job description. It belongs to a department itself (e.g. Head of Marketing, under Marketing) or to
 * one of its teams (e.g. Senior Content Creator, under Marketing → Content Team): owner's decision, 15 October 2026.
 * The department or team comes preselected from the page the form was opened on (`defaultDepartmentId`); choosing
 * another one moves the job title there.
 * `departments`: every department and team (GET /departments), for the picker. `grades`: GET /grades, lowest first.
 *
 * A job title has no grade of its own (owner's decision: a junior and a senior account manager are both Account
 * Managers, with different grades). It may limit the grades people with it can have to a range, either end of which
 * can be left open; each employment then has the person's own grade, in that range.
 *
 * The job description's purpose, duties and requirements are simple rich text, like an email's (owner's request,
 * 15 October 2026): bold, italic, underline, bulleted and numbered lists, and indents, sent as HTML.
 */
export function JobTitleForm({
  action,
  departments,
  grades,
  jobTitle,
  defaultDepartmentId,
  cancelHref,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  departments: Department[];
  grades: Grade[];
  jobTitle?: JobTitle;
  defaultDepartmentId?: string;
  cancelHref: string;
}) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  // The range's ends, kept in state so "To" only offers grades from "From" up.
  const [minId, setMinId] = useState(() => valueOf(state, 'minGradeId', jobTitle?.minGradeId));
  const [maxId, setMaxId] = useState(() => valueOf(state, 'maxGradeId', jobTitle?.maxGradeId));
  const [clearedMax, setClearedMax] = useState<Grade | null>(null);
  const minGrade = grades.find((g) => g.id === minId);
  // (a saved choice stays listed, so the API can say what is wrong with it)
  const highest = grades.filter((g) => !minGrade || g.rank >= minGrade.rank || g.id === maxId);

  return (
    <form {...form} className="card max-w-2xl space-y-5 p-6">
      <FormErrors errors={state.errors} />

      <div>
        <label htmlFor={fid('departmentId')} className="label">
          Department or team
        </label>
        <Select
          id={fid('departmentId')}
          name="departmentId"
          required
          defaultValue={valueOf(state, 'departmentId', jobTitle?.departmentId ?? defaultDepartmentId)}
          aria-describedby={fid('departmentId-hint')}
          className="input"
        >
          <option value="">Choose a department or team</option>
          <DepartmentOrTeamOptions departments={departments} />
        </Select>
        <p id={fid('departmentId-hint')} className="hint">
          The department itself for a job title over the whole department, e.g. Head of Marketing; otherwise one of its teams,
          e.g. Content Team for Senior Content Creator.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('titleEn')} className="label">
            Job title (English)
          </label>
          <input id={fid('titleEn')} name="titleEn" required maxLength={150} defaultValue={valueOf(state, 'titleEn', jobTitle?.titleEn)} className="input" />
        </div>
        <div>
          <label htmlFor={fid('titleAr')} className="label">
            Job title (Arabic) <span className="font-normal text-muted">· printed on contracts</span>
          </label>
          <input
            id={fid('titleAr')}
            name="titleAr"
            lang="ar"
            dir="rtl"
            maxLength={150}
            defaultValue={valueOf(state, 'titleAr', jobTitle?.titleAr)}
            className="input"
          />
        </div>
      </div>

      <fieldset aria-describedby={fid('grades-hint')} className="max-w-lg">
        <legend className="label">Grades</legend>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={fid('minGradeId')} className="mb-1 block text-sm text-muted">
              From
            </label>
            <Select
              id={fid('minGradeId')}
              name="minGradeId"
              value={minId}
              onChange={(e) => {
                const from = grades.find((g) => g.id === e.target.value);
                const to = grades.find((g) => g.id === maxId);
                setMinId(e.target.value);
                // a highest grade below the new lowest one would be the wrong way round: let it go, and say so
                if (from && to && to.rank < from.rank) {
                  setMaxId('');
                  setClearedMax(to);
                } else {
                  setClearedMax(null);
                }
              }}
              className="input"
            >
              <option value="">Any</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {gradeLabel(g)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor={fid('maxGradeId')} className="mb-1 block text-sm text-muted">
              To
            </label>
            <Select
              id={fid('maxGradeId')}
              name="maxGradeId"
              value={maxId}
              onChange={(e) => {
                setMaxId(e.target.value);
                setClearedMax(null);
              }}
              className="input"
            >
              <option value="">No limit</option>
              {highest.map((g) => (
                <option key={g.id} value={g.id}>
                  {gradeLabel(g)}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <p id={fid('grades-hint')} className="hint">
          The grades people with this title can have, e.g. G3 to G6 for Account Manager. Leave empty to allow any grade.
        </p>
        <div role="status">
          {clearedMax && minGrade && (
            <p className="hint text-warn">
              &ldquo;To&rdquo; was {gradeLabel(clearedMax)}, below {gradeLabel(minGrade)}, so it was cleared. Choose the highest grade again.
            </p>
          )}
        </div>
      </fieldset>

      <fieldset className="space-y-5 border-t border-line pt-5">
        <legend className="pr-2 font-semibold">Job Description</legend>
        <RichTextEditor name="jdPurpose" label="Purpose of the role" rows={3} defaultValue={valueOf(state, 'jdPurpose', jobTitle?.jdPurpose)} />
        <RichTextEditor
          name="jdDuties"
          label="Duties & responsibilities"
          rows={7}
          defaultValue={valueOf(state, 'jdDuties', jobTitle?.jdDuties)}
          hint="Format it as in an email: bold for headings, bullets or numbers for points, indent to nest. Its KPI template's metrics link to these duties (KPIs → KPI Templates)."
        />
        <RichTextEditor name="jdRequirements" label="Requirements" rows={4} defaultValue={valueOf(state, 'jdRequirements', jobTitle?.jdRequirements)} />
        {jobTitle && (
          <p className="hint">
            Job description version {jobTitle.jdVersion}. Changing the purpose, duties or requirements creates version {jobTitle.jdVersion + 1}.
          </p>
        )}
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending}>{jobTitle ? 'Save changes' : 'Create job title'}</SubmitButton>
        <Link href={cancelHref} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
