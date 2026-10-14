'use client';

import Link from 'next/link';
import { useState } from 'react';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { Department, FormState } from '@/lib/types';

/**
 * A department, or a team when it belongs to a department (e.g. Content Team in Marketing). One level only: a team
 * belongs to a department, never to another team, and a department that has teams stays a department. Job titles
 * belong to teams only, so a team that has job titles stays a team (it can move to another department).
 *
 * `departments`: every department and team (GET /departments), for the "belongs to" choice.
 * `defaultParentId`: a new team's department (from "Add team").
 * `cancelHref`: where Cancel goes; left out on the department page, where the form sits under its teams.
 */
export function DepartmentForm({
  action,
  department,
  departments,
  defaultParentId,
  cancelHref,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  department?: Department;
  departments: Department[];
  defaultParentId?: string;
  cancelHref?: string;
}) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  const [parentId, setParentId] = useState(() => valueOf(state, 'parentId', department ? department.parentId : defaultParentId));
  const choices = departments.filter((d) => !d.parentId && d.id !== department?.id);
  const teams = department?._count.children ?? 0;
  const isTeam = parentId !== '';
  // A team with job titles can't become a department (they would no longer be in a team).
  const titles = department?.parentId ? department._count.jobTitles : 0;

  return (
    <form {...form} className="card max-w-xl space-y-5 p-6">
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('parentId')} className="label">
          Department this team belongs to
        </label>
        {/* Disabled (and so not sent) for a department that has teams: it stays a department. */}
        <select
          id={fid('parentId')}
          name="parentId"
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          disabled={teams > 0}
          aria-describedby={fid('parentId-hint')}
          className="input disabled:cursor-not-allowed disabled:bg-canvas disabled:text-muted"
        >
          <option value="" disabled={titles > 0}>
            None — this is a department
          </option>
          {choices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nameEn}
            </option>
          ))}
        </select>
        <p id={fid('parentId-hint')} className="hint">
          {teams > 0
            ? `${department?.nameEn} has ${teams} ${teams === 1 ? 'team' : 'teams'}, so it stays a department. Move its teams to another department first to make it a team.`
            : titles > 0
              ? `${department?.nameEn} has ${titles} ${titles === 1 ? 'job title' : 'job titles'}, so it stays a team; it can move to another department. Job titles belong to teams.`
              : 'Choose a department to make this a team in it, e.g. Content Team in Marketing.'}
        </p>
      </div>
      <div>
        <label htmlFor={fid('nameEn')} className="label">
          Name (English)
        </label>
        <input id={fid('nameEn')} name="nameEn" required maxLength={100} defaultValue={valueOf(state, 'nameEn', department?.nameEn)} className="input" />
      </div>
      <div>
        <label htmlFor={fid('nameAr')} className="label">
          Name (Arabic) <span className="font-normal text-muted">· optional</span>
        </label>
        <input
          id={fid('nameAr')}
          name="nameAr"
          lang="ar"
          dir="rtl"
          maxLength={100}
          defaultValue={valueOf(state, 'nameAr', department?.nameAr)}
          className="input"
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending}>{department ? 'Save changes' : isTeam ? 'Create team' : 'Create department'}</SubmitButton>
        {cancelHref && (
          <Link href={cancelHref} className="btn btn-secondary">
            Cancel
          </Link>
        )}
      </div>
    </form>
  );
}
