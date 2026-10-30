'use client';

import Link from 'next/link';
import { useState } from 'react';
import { LEAVE_BALANCE_LABELS, LEAVE_BALANCES, LEAVE_PAY_LABELS, LEAVE_PAYS, leaveTypeRulesText, type LeaveBalanceKind, type LeavePay } from '@trendlix/shared';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import type { FormState, LeaveTypeView } from '@/lib/types';
import { limitField, wholeFrom } from './setup';

// Organization → Leave → a leave type, added or changed (HR; owner, 18 October 2026: "can you apply the leaves according
// to the law?"): its names; whether it is paid, unpaid or partly paid (sick leave at the percent HR sets: Art. 131 leaves
// it to the Social Insurance Law); what its days come out of (the annual balance, as casual leave is counted against it,
// Art. 128; days of its own a year; days a request; none); its limits (days a request, times in service, the service it
// needs first, the notice); a document needed; men or women only; counted in calendar days; half days; its place in the
// list; and whether it is on. What the rules come to, as the employee reads them, shows under them as they are typed.
// The API checks them all again.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const optional = <span className="font-normal text-muted">(optional)</span>;
const chip =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft';

/** What each kind of balance means, under its picker. */
const BALANCE_HINTS: Record<LeaveBalanceKind, string> = {
  annual: 'The annual leave itself: its days by service, age and disability are set above.',
  from_annual: 'Counted against the annual balance, with a most a year of its own: casual leave, 7 a year (Art. 128).',
  yearly: 'Days of its own each calendar year, apart from the annual balance.',
  per_request: 'So many days each time it is taken, e.g. Hajj 30, maternity 120.',
  none: 'No balance: as many days as needed, e.g. sick leave as the medical authority sets.',
};

export function LeaveTypeForm({ action, type, nextOrder, cancelHref }: { action: Action; type?: LeaveTypeView; nextOrder: number; cancelHref: string }) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  const ticked = (key: string, saved: boolean) => (state.values ? key in state.values : saved);
  const [paid, setPaid] = useState<LeavePay>(() => (valueOf(state, 'paid', type?.paid ?? 'paid') as LeavePay) || 'paid');
  const [percent, setPercent] = useState(() => valueOf(state, 'payPercent', limitField(type?.payPercent)));
  const [balance, setBalance] = useState<LeaveBalanceKind>(() => (valueOf(state, 'balance', type?.balance ?? 'none') as LeaveBalanceKind) || 'none');
  const [limits, setLimits] = useState(() => ({
    daysPerYear: valueOf(state, 'daysPerYear', limitField(type?.daysPerYear)),
    maxPerRequest: valueOf(state, 'maxPerRequest', limitField(type?.maxPerRequest)),
    maxTimesInService: valueOf(state, 'maxTimesInService', limitField(type?.maxTimesInService)),
    minServiceMonths: valueOf(state, 'minServiceMonths', limitField(type?.minServiceMonths)),
    noticeDays: valueOf(state, 'noticeDays', limitField(type?.noticeDays)),
  }));
  const [flags, setFlags] = useState(() => ({
    documentRequired: ticked('documentRequired', type?.documentRequired ?? false),
    calendarDays: ticked('calendarDays', type?.calendarDays ?? false),
    halfDays: ticked('halfDays', type?.halfDays ?? false),
  }));
  const [gender, setGender] = useState(() => valueOf(state, 'gender', type?.gender ?? ''));
  const [nameEn, setNameEn] = useState(() => valueOf(state, 'nameEn', type?.nameEn));
  const withYear = balance === 'yearly' || balance === 'from_annual';

  // the rules as the employee will read them, while the numbers typed are numbers
  const num = (raw: string) => wholeFrom(raw, 0, 1000);
  const parsed = {
    daysPerYear: withYear ? num(limits.daysPerYear) : null,
    maxPerRequest: num(limits.maxPerRequest),
    maxTimesInService: num(limits.maxTimesInService),
    minServiceMonths: num(limits.minServiceMonths),
    noticeDays: num(limits.noticeDays),
    payPercent: paid === 'partly' ? wholeFrom(percent, 0, 100) : null,
  };
  const readable = Object.values(parsed).every((v) => v === null || !Number.isNaN(v));
  const shown = readable
    ? leaveTypeRulesText({
        kind: 'custom',
        nameEn: nameEn || 'This leave',
        paid,
        balance,
        gender: gender === 'male' || gender === 'female' ? gender : null,
        ...flags,
        ...parsed,
      })
    : null;

  const limitInput = (key: keyof typeof limits, label: string, hint: string, placeholder: string) => (
    <div>
      <label htmlFor={fid(key)} className="label">
        {label} {optional}
      </label>
      <input
        id={fid(key)}
        name={key}
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        placeholder={placeholder}
        value={limits[key]}
        onChange={(e) => setLimits((l) => ({ ...l, [key]: e.target.value }))}
        aria-describedby={fid(`${key}-hint`)}
        className="input w-32 tabular-nums"
      />
      <p id={fid(`${key}-hint`)} className="hint">
        {hint}
      </p>
    </div>
  );

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
            placeholder="e.g. Compassionate leave"
            autoComplete="off"
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label htmlFor={fid('nameAr')} className="label">
            Name (Arabic)
          </label>
          <input id={fid('nameAr')} name="nameAr" lang="ar" dir="rtl" required maxLength={100} autoComplete="off" defaultValue={valueOf(state, 'nameAr', type?.nameAr)} className="input" />
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="font-semibold">Pay</legend>
        <div className="flex flex-wrap gap-2">
          {LEAVE_PAYS.map((p) => (
            <label key={p} className={chip}>
              <input type="radio" name="paid" value={p} checked={paid === p} onChange={() => setPaid(p)} className="size-4 accent-accent" />
              {LEAVE_PAY_LABELS[p]}
            </label>
          ))}
        </div>
        {paid === 'partly' && (
          <div>
            <label htmlFor={fid('payPercent')} className="label">
              Share of the pay (%)
            </label>
            <input
              id={fid('payPercent')}
              name="payPercent"
              required
              inputMode="numeric"
              autoComplete="off"
              maxLength={3}
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              aria-describedby={fid('payPercent-hint')}
              className="input w-24 tabular-nums"
            />
            <p id={fid('payPercent-hint')} className="hint">
              What a day of it pays; the rest of the day is deducted on the payroll. Sick leave: as the Social Insurance Law 148/2019 sets it (the
              accountant confirms).
            </p>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="font-semibold">Days and Limits</legend>
        <div>
          <label htmlFor={fid('balance')} className="label">
            Counted against
          </label>
          <Select id={fid('balance')} name="balance" value={balance} onChange={(e) => setBalance(e.target.value as LeaveBalanceKind)} aria-describedby={fid('balance-hint')} className="input">
            {LEAVE_BALANCES.map((b) => (
              <option key={b} value={b}>
                {LEAVE_BALANCE_LABELS[b]}
              </option>
            ))}
          </Select>
          <p id={fid('balance-hint')} className="hint">
            {BALANCE_HINTS[balance]}
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {withYear && limitInput('daysPerYear', balance === 'yearly' ? 'Days a year' : 'Most days a year', 'Whole days, e.g. 7.', balance === 'yearly' ? '' : 'No limit')}
          {limitInput('maxPerRequest', balance === 'per_request' ? 'Days a request' : 'Most days a request', 'Whole days, e.g. 2.', 'No limit')}
          {limitInput('maxTimesInService', 'Most times in service', 'E.g. 3 for the birth of a child; once for Hajj.', 'No limit')}
          {limitInput('minServiceMonths', 'Months of service needed first', 'E.g. 60 (5 years) for Hajj (Art. 130).', 'None')}
          {limitInput('noticeDays', 'Days of notice', 'Days before the first day an employee must ask, e.g. 10 for exams (Art. 126). HR recording it needs none.', 'None')}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="font-semibold">Other Rules</legend>
        <div className="flex flex-wrap gap-2">
          <label className={chip}>
            <input
              type="checkbox"
              name="documentRequired"
              checked={flags.documentRequired}
              onChange={(e) => setFlags((f) => ({ ...f, documentRequired: e.target.checked }))}
              className="size-4 accent-accent"
            />
            Document needed
          </label>
          <label className={chip}>
            <input
              type="checkbox"
              name="calendarDays"
              checked={flags.calendarDays}
              onChange={(e) => setFlags((f) => ({ ...f, calendarDays: e.target.checked }))}
              className="size-4 accent-accent"
            />
            Counted in calendar days
          </label>
          <label className={chip}>
            <input type="checkbox" name="halfDays" checked={flags.halfDays} onChange={(e) => setFlags((f) => ({ ...f, halfDays: e.target.checked }))} className="size-4 accent-accent" />
            Half days allowed
          </label>
        </div>
        <p className="hint">
          A document: a medical certificate, proof of sitting the exam. Calendar days: every day from the first to the last (Hajj, maternity); else
          working days, the rest days and official holidays not counted (Art. 124).
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor={fid('gender')} className="label">
              For
            </label>
            <Select id={fid('gender')} name="gender" value={gender} onChange={(e) => setGender(e.target.value)} className="input">
              <option value="">Everyone</option>
              <option value="female">Female employees</option>
              <option value="male">Male employees</option>
            </Select>
          </div>
          <div>
            <label htmlFor={fid('sortOrder')} className="label">
              Place in the list
            </label>
            <input
              id={fid('sortOrder')}
              name="sortOrder"
              inputMode="numeric"
              autoComplete="off"
              maxLength={3}
              defaultValue={valueOf(state, 'sortOrder', String(type?.sortOrder ?? nextOrder))}
              aria-describedby={fid('sortOrder-hint')}
              className="input w-24 tabular-nums"
            />
            <p id={fid('sortOrder-hint')} className="hint">
              Lower first, as employees choose it.
            </p>
          </div>
        </div>
      </fieldset>

      <p role="status" className="rounded-lg bg-canvas px-4 py-3 text-sm">
        <span className="text-muted">Employees read: </span>
        {shown ?? <span className="text-muted">a number above isn&apos;t one yet.</span>}
      </p>

      <div className="border-t border-line-soft pt-5">
        <label className={`${chip} w-fit font-semibold`}>
          <input type="checkbox" role="switch" name="active" defaultChecked={ticked('active', type?.active ?? true)} aria-describedby={fid('active-hint')} className="size-5 accent-accent" />
          On
        </label>
        <p id={fid('active-hint')} className="hint">
          Off: not offered for new requests. The requests already sent keep going through their approvals.
        </p>
      </div>

      {type && <p className="hint">A change applies to the requests sent from now on; those sent keep their days.</p>}
      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending}>{type ? 'Save changes' : 'Add type'}</SubmitButton>
        <Link href={cancelHref} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
