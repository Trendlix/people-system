'use client';

import { startTransition, useActionState, useRef, useState } from 'react';
import { lawRatesFor } from '@trendlix/shared';
import { FormErrors, useFieldIds } from '@/components/form';
import type { FormState, LawRatesView } from '@/lib/types';
import {
  addBand,
  addTier,
  changeTier,
  deletable,
  deleteQuestion,
  formProblems,
  lawRatesOf,
  nextYear,
  removeBand,
  removeTier,
  typedOf,
  type LawRatesTyped,
  type TierRow,
} from './law-rates';
import { deleteLawRates, saveLawRates } from './law-rates-actions';
import { LawRatesTable } from './law-rates-table';

// Rates Set by Law for the Super Admin (owner's request, 16 October 2026: the tax brackets "editable by superadmin, to
// modify it if the law changed"): the table with a Change button for each year and Delete for all but the earliest
// (whose rates the years before it use), and Add a year, which starts from the latest year's values. The rates are
// typed as percents (to 4 decimals) and the amounts in EGP (to the piaster); the salary tax's tiers and bands in a
// structured editor. The form is checked here as the API checks it (lawRatesProblems) before it is sent, and the API's
// own refusals are shown too.

type Editing = { adding: true } | { adding: false; year: number };

const small = 'inline-flex min-h-9 items-center text-sm font-semibold hover:underline disabled:cursor-not-allowed disabled:opacity-60';

/** Delete, for a year other than the earliest: asks first; the API's refusal shows beside it. */
function DeleteYear({ year, years, onDeleted }: { year: number; years: readonly number[]; onDeleted: (message: string) => void }) {
  const [state, formAction, pending] = useActionState(async (): Promise<FormState> => {
    const next = await deleteLawRates(year);
    if (next.message) onDeleted(next.message);
    return next;
  }, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(deleteQuestion(years, year))) e.preventDefault();
      }}
    >
      <button type="submit" disabled={pending} className={`${small} text-danger`}>
        {pending ? 'Deleting…' : 'Delete'}
        <span className="sr-only"> the rates for {year}</span>
      </button>
      {state.errors && (
        <p role="alert" className="max-w-56 text-xs whitespace-normal text-danger">
          {state.errors.join(' ')}
        </p>
      )}
    </form>
  );
}

export function LawRatesEditor({ views, currentYear, thisYear }: { views: readonly LawRatesView[]; currentYear: number | null; thisYear: number }) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const years = views.map((v) => v.year);
  const latest = views.at(-1);

  function open(next: Editing) {
    setNotice(null);
    setEditing(next);
  }

  return (
    <div className="space-y-4">
      {notice && (
        <p role="status" className="text-sm text-ok">
          {notice}
        </p>
      )}
      {views.length > 0 ? (
        <LawRatesTable
          views={views}
          currentYear={currentYear}
          actions={(v) => (
            <div className="flex flex-col items-start gap-1">
              <button type="button" onClick={() => open({ adding: false, year: v.year })} className={`${small} text-accent`}>
                Change<span className="sr-only"> the rates for {v.year}</span>
              </button>
              {deletable(years, v.year) && (
                <DeleteYear
                  year={v.year}
                  years={years}
                  onDeleted={(message) => {
                    setNotice(message);
                    setEditing((e) => (e && !e.adding && e.year === v.year ? null : e));
                  }}
                />
              )}
            </div>
          )}
        />
      ) : (
        <p className="text-sm text-muted">No years are kept yet: add the first one.</p>
      )}
      {editing ? (
        <LawRatesForm
          // a fresh form for each year opened
          key={editing.adding ? 'adding' : editing.year}
          adding={editing.adding ? { kept: years } : null}
          start={
            editing.adding
              ? typedOf(latest ?? lawRatesFor(thisYear), nextYear(years, thisYear))
              : typedOf(views.find((v) => v.year === editing.year) ?? lawRatesFor(editing.year, views))
          }
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setNotice(message);
            setEditing(null);
          }}
        />
      ) : (
        <button type="button" onClick={() => open({ adding: true })} className="btn btn-secondary">
          Add a year
        </button>
      )}
    </div>
  );
}

/** A field of the form: its label, the input, and a hint under it. */
function Field({
  id,
  label,
  hint,
  value,
  onChange,
  numeric = false,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={numeric ? 'numeric' : 'decimal'}
        autoComplete="off"
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="input tabular-nums"
      />
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Adding a year (`adding`: the years kept, which it must not be) or changing one: the rates, then the tax tiers. */
function LawRatesForm({
  adding,
  start,
  onClose,
  onSaved,
}: {
  adding: { kept: readonly number[] } | null;
  start: LawRatesTyped;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const fid = useFieldIds();
  const [typed, setTyped] = useState<LawRatesTyped>(start);
  // what is wrong as checked here before sending; the API's refusals come in `state`
  const [problems, setProblems] = useState<string[]>([]);
  const [state, formAction, pending] = useActionState(async (prev: FormState, fd: FormData): Promise<FormState> => {
    const next = await saveLawRates(prev, fd);
    if (next.message) onSaved(next.message);
    return next;
  }, {});
  const set = (key: Exclude<keyof LawRatesTyped, 'taxTiers'>) => (value: string) => setTyped((t) => ({ ...t, [key]: value }));
  const year = adding ? typed.year : start.year;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const found = formProblems(typed, adding);
    setProblems(found);
    if (found.length) return;
    const fd = new FormData();
    fd.set('rates', JSON.stringify(lawRatesOf(typed)));
    if (adding) fd.set('adding', '1');
    startTransition(() => formAction(fd));
  }

  return (
    <section aria-labelledby={fid('heading')} className="space-y-5 rounded-lg border border-line p-5">
      <h3 id={fid('heading')} className="font-semibold">
        {adding ? 'Add a Year' : `Change the ${start.year} Rates`}
      </h3>
      <form onSubmit={submit} className="space-y-6">
        <FormErrors errors={problems.length ? problems : state.errors} />

        {adding && (
          <div className="sm:max-w-48">
            <Field
              id={fid('year')}
              label="Applies from (year)"
              hint="A year without its own uses the latest earlier one's."
              value={typed.year}
              onChange={set('year')}
              numeric
            />
          </div>
        )}

        <fieldset className="space-y-4">
          <legend className="font-semibold">Social Insurance</legend>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Field
              id={fid('employeeInsuranceRate')}
              label="Employee's share (%)"
              hint="Of the insured wage, e.g. 11."
              value={typed.employeeInsuranceRate}
              onChange={set('employeeInsuranceRate')}
            />
            <Field
              id={fid('employerInsuranceRate')}
              label="Company's share (%)"
              hint="Of the insured wage, e.g. 18.75."
              value={typed.employerInsuranceRate}
              onChange={set('employerInsuranceRate')}
            />
            <Field
              id={fid('insurableWageMin')}
              label="Minimum insurable wage (EGP)"
              hint="A month: a lower wage is insured at it."
              value={typed.insurableWageMin}
              onChange={set('insurableWageMin')}
            />
            <Field
              id={fid('insurableWageMax')}
              label="Maximum insurable wage (EGP)"
              hint="A month: a higher wage is insured at it."
              value={typed.insurableWageMax}
              onChange={set('insurableWageMax')}
            />
          </div>
        </fieldset>

        <div className="border-t border-line-soft pt-5">
          <fieldset className="space-y-4">
            <legend className="font-semibold">Tax and Funds</legend>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <Field
                id={fid('personalExemption')}
                label="Personal exemption (EGP a year)"
                hint="Taken off the annual net income before the tax, e.g. 20,000."
                value={typed.personalExemption}
                onChange={set('personalExemption')}
              />
              <Field
                id={fid('martyrsRate')}
                label="Martyrs' Fund (%)"
                hint="Of the gross and the taxed allowances, e.g. 0.05."
                value={typed.martyrsRate}
                onChange={set('martyrsRate')}
              />
              <Field
                id={fid('healthInsuranceRate')}
                label="Health insurance (%)"
                hint="The employee's share of comprehensive health insurance, taken off before the tax: 0 while it doesn't apply in Cairo."
                value={typed.healthInsuranceRate}
                onChange={set('healthInsuranceRate')}
              />
            </div>
          </fieldset>
        </div>

        {/* the minimum wage (owner, 18 October 2026): a trainee's last training stage is paid at least this (Labour Law Art. 29) */}
        <div className="border-t border-line-soft pt-5">
          <fieldset className="space-y-4">
            <legend className="font-semibold">Minimum Wage</legend>
            <div className="sm:max-w-sm">
              <Field
                id={fid('minimumWage')}
                label="Minimum wage (EGP a month)"
                hint="The private sector's minimum wage. A trainee's last training stage is paid at least this (Labour Law Art. 29). Leave it empty while it isn't set: nothing is checked against it."
                value={typed.minimumWage}
                onChange={set('minimumWage')}
              />
            </div>
          </fieldset>
        </div>

        {/* the before-tax health insurance limit (owner, 20 October 2026, on the employee's medical share: "Before Tax i think") */}
        <div className="border-t border-line-soft pt-5">
          <fieldset className="space-y-4">
            <legend className="font-semibold">Before-Tax Health Insurance</legend>
            <div className="sm:max-w-sm">
              <Field
                id={fid('beforeTaxHealthLimit')}
                label="Before-tax health insurance limit a year (EGP)"
                hint="The most of an employee's health insurance share, the recurring deductions ticked Deducted before tax, that lowers their taxable pay in a year: a twelfth of it a month. The tax law limits it: ask your accountant for the limit. Leave it empty for no limit."
                value={typed.beforeTaxHealthLimit}
                onChange={set('beforeTaxHealthLimit')}
              />
            </div>
          </fieldset>
        </div>

        <TierEditor fid={fid} rows={typed.taxTiers} onChange={(taxTiers) => setTyped((t) => ({ ...t, taxTiers }))} />

        <p className="text-sm text-muted">
          Payroll runs made from now on use these rates for {/^\d{4}$/.test(year) ? year : 'the year'}, and a draft run takes them when it is refreshed.
          Approved runs keep the rates they were worked out with.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={pending} className="btn btn-primary">
            {pending ? 'Saving…' : adding ? 'Add the year' : 'Save changes'}
          </button>
          <button type="button" onClick={onClose} disabled={pending} className="btn btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * The salary tax's tiers, lowest first: each tier's limit on the whole annual net income (the last has none) and its
 * bands, each band's upper limit (the last has none) and its rate. Tiers and bands are added at the end, starting from
 * the one before (addTier, addBand), and removed down to one.
 */
function TierEditor({ fid, rows, onChange }: { fid: (name: string) => string; rows: readonly TierRow[]; onChange: (rows: TierRow[]) => void }) {
  // keys for the rows added here, apart from the "t1b2" ones of the rows the form started with
  const added = useRef(0);
  const newKey = () => `n${++added.current}`;

  return (
    <div className="border-t border-line-soft pt-5">
      <fieldset className="space-y-4" aria-describedby={fid('tiers-hint')}>
        <legend className="font-semibold">Salary Tax Tiers</legend>
        <p id={fid('tiers-hint')} className="text-sm text-muted">
          The tier is chosen by the whole annual net income (after social insurance and the personal exemption), and the whole income is then taxed on that
          tier&apos;s bands, from 0. The last tier, and each tier&apos;s last band, have no limit. Limits in EGP a year, rates in percent.
        </p>
        <ol className="space-y-4">
          {rows.map((tier, i) => {
            const lastTier = i === rows.length - 1;
            const name = `Tier ${i + 1}`;
            return (
              <li key={tier.key} className="rounded-lg border border-line-soft bg-canvas/50 p-4">
                <fieldset className="space-y-3">
                  <legend className="text-sm font-semibold">{name}</legend>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {lastTier ? (
                      <p className="text-sm text-muted">{rows.length > 1 ? 'No limit: every income above the tier before it.' : 'No limit: every income.'}</p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <label htmlFor={fid(`${tier.key}-upTo`)} className="text-sm">
                          Whole annual net income up to (EGP)
                        </label>
                        <input
                          id={fid(`${tier.key}-upTo`)}
                          value={tier.upTo}
                          onChange={(e) => onChange(changeTier(rows, i, { upTo: e.target.value }))}
                          inputMode="decimal"
                          autoComplete="off"
                          className="input w-40 tabular-nums"
                        />
                      </div>
                    )}
                    {rows.length > 1 && (
                      <button type="button" onClick={() => onChange(removeTier(rows, i))} className={`${small} text-danger`}>
                        Remove tier<span className="sr-only"> {i + 1}</span>
                      </button>
                    )}
                  </div>

                  <table className="w-full max-w-xl text-sm">
                    <caption className="sr-only">{name}&apos;s bands</caption>
                    <thead>
                      <tr className="text-left text-xs text-muted">
                        <th scope="col" className="py-1 pr-3 font-medium">
                          Band
                        </th>
                        <th scope="col" className="py-1 pr-3 font-medium">
                          Up to (EGP)
                        </th>
                        <th scope="col" className="py-1 pr-3 font-medium">
                          Rate (%)
                        </th>
                        <th scope="col" className="py-1">
                          <span className="sr-only">Remove</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {tier.bands.map((band, j) => {
                        const lastBand = j === tier.bands.length - 1;
                        const bandName = `${name}, band ${j + 1}`;
                        return (
                          <tr key={band.key}>
                            <td className="py-1 pr-3 tabular-nums">{j + 1}</td>
                            <td className="py-1 pr-3">
                              {lastBand ? (
                                <span className="text-muted">No limit</span>
                              ) : (
                                <>
                                  <label htmlFor={fid(`${band.key}-upTo`)} className="sr-only">
                                    {bandName}: up to (EGP)
                                  </label>
                                  <input
                                    id={fid(`${band.key}-upTo`)}
                                    value={band.upTo}
                                    onChange={(e) => onChange(changeTier(rows, i, { band: j, upTo: e.target.value }))}
                                    inputMode="decimal"
                                    autoComplete="off"
                                    className="input w-40 tabular-nums"
                                  />
                                </>
                              )}
                            </td>
                            <td className="py-1 pr-3">
                              <label htmlFor={fid(`${band.key}-rate`)} className="sr-only">
                                {bandName}: rate (%)
                              </label>
                              <input
                                id={fid(`${band.key}-rate`)}
                                value={band.rate}
                                onChange={(e) => onChange(changeTier(rows, i, { band: j, rate: e.target.value }))}
                                inputMode="decimal"
                                autoComplete="off"
                                className="input w-28 tabular-nums"
                              />
                            </td>
                            <td className="py-1">
                              {tier.bands.length > 1 && (
                                <button type="button" onClick={() => onChange(removeBand(rows, i, j))} className={`${small} text-danger`}>
                                  Remove<span className="sr-only"> {bandName}</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <button type="button" onClick={() => onChange(addBand(rows, i, newKey()))} className={`${small} text-accent`}>
                    Add a band<span className="sr-only"> to {name.toLowerCase()}</span>
                  </button>
                </fieldset>
              </li>
            );
          })}
        </ol>
        <button type="button" onClick={() => onChange(addTier(rows, newKey()))} className="btn btn-secondary">
          Add a tier
        </button>
      </fieldset>
    </div>
  );
}
