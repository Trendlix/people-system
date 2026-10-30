'use client';

import Link from 'next/link';
import { useState } from 'react';
import { EMPLOYMENT_TYPES, LABELS } from '@trendlix/shared';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { FormState, ReimbursementTypeView } from '@/lib/types';
import { CAP_FIELDS, capField, typedRulesText, type CapKey } from './reimbursement-types';

// Payroll Setup → Reimbursement Types, adding or changing a type (HR; owner, 18 October 2026: "allow the employee to
// add reimbursement request … for specific preset up conditions", "in the setup i need to enter for it a cap"): its
// names and description; the caps first, large, each optional (a claim, a month, a year, in EGP); a receipt required or
// not; within how many days of the expense it is claimed; who may claim it (departments with their teams, grades,
// employment types; none ticked: everyone); and whether it is on. What the conditions come to, as the employee reads
// them, shows under them as they are typed. The API checks them all again.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const optional = <span className="font-normal text-muted">(optional)</span>;
const chip =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft';

export interface DepartmentChoice {
  id: string;
  label: string;
  teams: { id: string; label: string }[];
}

/** A list chosen: as typed after a refused save, else as saved. */
function chosenOf(state: FormState, key: string, saved: readonly string[]): Set<string> {
  const typed = state.values?.[key];
  if (state.values) return new Set(Array.isArray(typed) ? typed : typed ? [typed] : []);
  return new Set(saved);
}

export function ReimbursementTypeForm({
  action,
  type,
  departments,
  grades,
  cancelHref,
}: {
  action: Action;
  type?: ReimbursementTypeView;
  /** The departments with their teams (departmentChoices); null when they couldn't be read. */
  departments: DepartmentChoice[] | null;
  /** The grades, lowest first; null when they couldn't be read. */
  grades: { id: string; label: string }[] | null;
  cancelHref: string;
}) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  // a checkbox is sent only when ticked: after a refused save, ticked if it was sent; otherwise as saved
  const ticked = (key: string, saved: boolean) => (state.values ? key in state.values : saved);
  const [caps, setCaps] = useState<Record<CapKey, string>>(() => ({
    capPerClaim: valueOf(state, 'capPerClaim', capField(type?.capPerClaim ?? null)),
    capPerMonth: valueOf(state, 'capPerMonth', capField(type?.capPerMonth ?? null)),
    capPerYear: valueOf(state, 'capPerYear', capField(type?.capPerYear ?? null)),
  }));
  const [days, setDays] = useState(() => valueOf(state, 'claimWithinDays', type?.claimWithinDays == null ? '' : String(type.claimWithinDays)));
  const [receipt, setReceipt] = useState(() => ticked('receiptRequired', type?.receiptRequired ?? true));
  const shown = typedRulesText({ ...caps, claimWithinDays: days, receiptRequired: receipt });
  const departmentsChosen = chosenOf(state, 'departmentIds', type?.departmentIds ?? []);
  const gradesChosen = chosenOf(state, 'gradeIds', type?.gradeIds ?? []);
  const typesChosen = chosenOf(state, 'employmentTypes', type?.employmentTypes ?? []);

  return (
    <form {...form} className="card max-w-3xl space-y-6 p-6">
      <FormErrors errors={state.errors} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('nameEn')} className="label">
            Name (English)
          </label>
          <input
            id={fid('nameEn')}
            name="nameEn"
            required
            maxLength={100}
            placeholder="e.g. Mobile bill"
            autoComplete="off"
            defaultValue={valueOf(state, 'nameEn', type?.nameEn)}
            aria-describedby={fid('name-hint')}
            className="input"
          />
        </div>
        <div>
          <label htmlFor={fid('nameAr')} className="label">
            Name (Arabic)
          </label>
          <input
            id={fid('nameAr')}
            name="nameAr"
            lang="ar"
            dir="rtl"
            required
            maxLength={100}
            autoComplete="off"
            defaultValue={valueOf(state, 'nameAr', type?.nameAr)}
            aria-describedby={fid('name-hint')}
            className="input"
          />
        </div>
        <p id={fid('name-hint')} className="hint -mt-3 sm:col-span-2">
          As employees choose it when they claim, and as their payslip&apos;s Reimbursement addition says it. Each type has its own English name.
        </p>
        <div className="sm:col-span-2">
          <label htmlFor={fid('description')} className="label">
            Description {optional}
          </label>
          <textarea
            id={fid('description')}
            name="description"
            rows={2}
            maxLength={500}
            defaultValue={valueOf(state, 'description', type?.description)}
            aria-describedby={fid('description-hint')}
            className="input"
          />
          <p id={fid('description-hint')} className="hint">
            What it covers, shown to the employee beside the type, e.g. &ldquo;Taxis and fuel for visits to clients; not the daily commute.&rdquo;
          </p>
        </div>
      </div>

      <fieldset className="space-y-3 rounded-lg border border-accent/30 bg-accent-soft/40 p-4" aria-describedby={fid('caps-hint')}>
        <legend className="px-1 text-base font-semibold">Caps</legend>
        <p id={fid('caps-hint')} className="hint -mt-1">
          The most an employee may claim of this type, in EGP: at once, in a calendar month and in a calendar year, by the expense&apos;s date. Leave a
          cap empty for no cap. A claim over a cap can&apos;t be sent.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          {CAP_FIELDS.map((f) => (
            <div key={f.key}>
              <label htmlFor={fid(f.key)} className="label">
                Cap {f.what}
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted">EGP</span>
                <input
                  id={fid(f.key)}
                  name={f.key}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="No cap"
                  value={caps[f.key]}
                  onChange={(e) => setCaps((c) => ({ ...c, [f.key]: e.target.value }))}
                  className="input text-base font-semibold tabular-nums"
                />
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="font-semibold">Other Conditions</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={`${chip} w-fit`}>
              <input
                type="checkbox"
                name="receiptRequired"
                checked={receipt}
                onChange={(e) => setReceipt(e.target.checked)}
                aria-describedby={fid('receipt-hint')}
                className="size-4 accent-accent"
              />
              Receipt required
            </label>
            <p id={fid('receipt-hint')} className="hint">
              A claim must have at least one photo or PDF of the receipt.
            </p>
          </div>
          <div>
            <label htmlFor={fid('claimWithinDays')} className="label">
              Claimed within (days) {optional}
            </label>
            <input
              id={fid('claimWithinDays')}
              name="claimWithinDays"
              inputMode="numeric"
              autoComplete="off"
              maxLength={3}
              placeholder="No deadline"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              aria-describedby={fid('claimWithinDays-hint')}
              className="input w-32 tabular-nums"
            />
            <p id={fid('claimWithinDays-hint')} className="hint">
              How many days after the expense it can still be claimed, 1 to 365, e.g. 30. Empty: any time.
            </p>
          </div>
        </div>
        <p role="status" className="rounded-lg bg-canvas px-4 py-3 text-sm">
          <span className="text-muted">Employees read: </span>
          {shown ?? <span className="text-muted">a cap or the days aren&apos;t a number yet.</span>}
        </p>
      </fieldset>

      <fieldset className="space-y-4" aria-describedby={fid('who-hint')}>
        <legend className="font-semibold">Who Can Claim It</legend>
        <p id={fid('who-hint')} className="hint -mt-2">
          By their current employment. Nothing ticked in a list: everyone, whatever it is. A department takes its teams with it.
        </p>
        <div>
          <p className="label">Departments</p>
          {departments === null ? (
            <p className="text-sm text-muted">The departments couldn&apos;t be loaded. Please try again in a moment.</p>
          ) : (
            <div className="space-y-2">
              {departments.map((d) => (
                <div key={d.id} className="flex flex-wrap gap-2">
                  <label className={chip}>
                    <input type="checkbox" name="departmentIds" value={d.id} defaultChecked={departmentsChosen.has(d.id)} className="size-4 accent-accent" />
                    <span className="font-medium">{d.label}</span>
                  </label>
                  {d.teams.map((t) => (
                    <label key={t.id} className={chip}>
                      <input type="checkbox" name="departmentIds" value={t.id} defaultChecked={departmentsChosen.has(t.id)} className="size-4 accent-accent" />
                      {t.label}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="label">Grades</p>
          {grades === null ? (
            <p className="text-sm text-muted">The grades couldn&apos;t be loaded. Please try again in a moment.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {grades.map((g) => (
                <label key={g.id} className={chip}>
                  <input type="checkbox" name="gradeIds" value={g.id} defaultChecked={gradesChosen.has(g.id)} className="size-4 accent-accent" />
                  {g.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="label">Employment types</p>
          <div className="flex flex-wrap gap-2">
            {EMPLOYMENT_TYPES.map((t) => (
              <label key={t} className={chip}>
                <input type="checkbox" name="employmentTypes" value={t} defaultChecked={typesChosen.has(t)} className="size-4 accent-accent" />
                {LABELS.employmentType[t]}
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <div className="border-t border-line-soft pt-5">
        <label className={`${chip} w-fit font-semibold`}>
          <input
            type="checkbox"
            role="switch"
            name="active"
            defaultChecked={ticked('active', type?.active ?? true)}
            aria-describedby={fid('active-hint')}
            className="size-5 accent-accent"
          />
          On
        </label>
        <p id={fid('active-hint')} className="hint">
          Off: not offered for new claims. The claims already sent keep going through their approvals.
        </p>
      </div>

      {type && <p className="hint">A change applies to the claims sent from now on; those sent keep the conditions they were sent under.</p>}
      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending}>{type ? 'Save changes' : 'Add type'}</SubmitButton>
        <Link href={cancelHref} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
