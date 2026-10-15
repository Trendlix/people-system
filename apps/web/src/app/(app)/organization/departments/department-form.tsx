'use client';

import Link from 'next/link';
import { useState } from 'react';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { Department, FormState } from '@/lib/types';

/**
 * A department, or a team when it belongs to a department (e.g. Content Team in Marketing). One level only: a team
 * belongs to a department, never to another team, and a department that has teams stays a department. Its job titles
 * go with it: a job title belongs to a department itself or to one of its teams (owner's decision, 15 October 2026),
 * so a team taken out of its department becomes a department that holds them itself.
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
          <option value="">None — this is a department</option>
          {choices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nameEn}
            </option>
          ))}
        </select>
        <p id={fid('parentId-hint')} className="hint">
          {teams > 0
            ? `${department?.nameEn} has ${teams} ${teams === 1 ? 'team' : 'teams'}, so it stays a department. Move its teams to another department first to make it a team.`
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
