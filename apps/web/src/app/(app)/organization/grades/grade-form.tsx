'use client';

import Link from 'next/link';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { FormState, Grade } from '@/lib/types';

/** A step of the grading system, e.g. G4 Senior with rank 4 (1 is the lowest level). Code and rank are each unique. */
export function GradeForm({ action, grade }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; grade?: Grade }) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();

  return (
    <form {...form} className="card max-w-xl space-y-5 p-6">
      <FormErrors errors={state.errors} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('code')} className="label">
            Grade code
          </label>
          <input
            id={fid('code')}
            name="code"
            required
            maxLength={10}
            placeholder="e.g. G4"
            autoComplete="off"
            defaultValue={valueOf(state, 'code', grade?.code)}
            className="input uppercase"
          />
        </div>
        <div>
          <label htmlFor={fid('rank')} className="label">
            Rank
          </label>
          <input
            id={fid('rank')}
            name="rank"
            type="number"
            required
            min={1}
            max={99}
            step={1}
            defaultValue={valueOf(state, 'rank', grade ? String(grade.rank) : undefined)}
            aria-describedby={fid('rank-hint')}
            className="input"
          />
          <p id={fid('rank-hint')} className="hint">
            Its level in the hierarchy: 1 for the lowest. Each grade has its own rank.
          </p>
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('levelEn')} className="label">
            Level (English)
          </label>
          <input id={fid('levelEn')} name="levelEn" required maxLength={100} placeholder="e.g. Senior" defaultValue={valueOf(state, 'levelEn', grade?.levelEn)} className="input" />
        </div>
        <div>
          <label htmlFor={fid('levelAr')} className="label">
            Level (Arabic) <span className="font-normal text-muted">· optional</span>
          </label>
          <input id={fid('levelAr')} name="levelAr" lang="ar" dir="rtl" maxLength={100} defaultValue={valueOf(state, 'levelAr', grade?.levelAr)} className="input" />
        </div>
      </div>
      <div>
        <label htmlFor={fid('description')} className="label">
          Example <span className="font-normal text-muted">· optional</span>
        </label>
        <input
          id={fid('description')}
          name="description"
          maxLength={300}
          placeholder="e.g. Senior Graphic Designer"
          defaultValue={valueOf(state, 'description', grade?.description)}
          aria-describedby={fid('description-hint')}
          className="input"
        />
        <p id={fid('description-hint')} className="hint">
          The roles at this level, as a guide when choosing an employee&apos;s grade or the grades a job title allows.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending}>{grade ? 'Save changes' : 'Create grade'}</SubmitButton>
        <Link href="/organization/grades" className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
