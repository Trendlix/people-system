'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import { formatDate, parseDate } from '@/lib/format';
import type { EndingRule, FormState } from '@/lib/types';
import { addDays, noticeLabel, noticeLastDay } from '../contracts/dates';

// The End employment form: how the employment ends (one of the ending rules), who started it, when notice was given,
// pay in lieu, and for a resignation its certification at the labour office. While HR types, it shows the rule's
// notice and the last working day. HR saving it counts as HR's approval; it then goes to the CEO.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** A resignation is decided within 10 days of being received, or it counts as accepted (Decree 187/2025). */
const RESIGNATION_DECISION_DAYS = 10;

const optional = <span className="font-normal text-muted">(optional)</span>;

/** The notice date's label and hint, by who gives the notice (and whether there is any). */
function noticeWording(rule: EndingRule | undefined, initiator: string, noticeBy: string | null): { label: string; hint: string } {
  if (!rule) return { label: 'Notice date', hint: 'Choose how the employment ends first.' };
  if (rule.key === 'non_renewal') {
    return {
      label: 'Notice given on',
      hint: `The day the employee was told the contract won't be renewed${noticeBy ? `: by ${formatDate(noticeBy)} at the latest, 45 working days before it ends` : ''}.`,
    };
  }
  if (rule.noticeAmount <= 0)
    return { label: 'Effective date', hint: 'No notice applies: this is the last working day (e.g. the date agreed, or of the event).' };
  const byEmployee = rule.initiator === 'employee' || (rule.initiator === 'either' && initiator === 'employee');
  return byEmployee
    ? { label: 'Notice received on', hint: 'The day the company received the notice. The notice period starts from it.' }
    : { label: 'Notice given on', hint: 'The day the employee was given the notice. The notice period starts from it.' };
}

/** What the rule and the dates typed mean: the notice, the last working day and, for a resignation, the decision due. */
function Preview({
  rule,
  given,
  payInLieu,
  contract,
  probationEnd,
}: {
  rule: EndingRule | undefined;
  /** YYYY-MM-DD, or null while not (properly) typed. */
  given: string | null;
  payInLieu: boolean;
  contract: { endDate: string; nonRenewalNoticeBy: string | null } | null;
  probationEnd: string | null;
}) {
  if (!rule) return null;
  const source = rule.source ? ` (${rule.source})` : '';
  const lines: React.ReactNode[] = [rule.noticeAmount > 0 ? `Notice: ${noticeLabel(rule.noticeAmount, rule.noticeUnit)}${source}.` : `No notice${source}.`];
  if (given && payInLieu) {
    lines.push(<>Last working day: {formatDate(given)}. The notice is paid instead of worked.</>);
  } else if (rule.key === 'non_renewal' && contract) {
    lines.push(<>Last working day: {formatDate(contract.endDate)}, the contract&apos;s end date.</>);
    const by = contract.nonRenewalNoticeBy;
    if (by && given && given > by) {
      lines.push(
        <span className="font-semibold text-danger">
          Too late: the non-renewal notice was due by {formatDate(by)}. Renew the contract in writing, or choose another way to end it.
        </span>,
      );
    } else if (by) {
      lines.push(<>The notice is due by {formatDate(by)}.</>);
    }
  } else if (!given) {
    lines.push(<>Enter the {rule.noticeAmount > 0 ? 'notice date' : 'effective date'} to see the last working day.</>);
  } else {
    const last = noticeLastDay(given, rule.noticeAmount, rule.noticeUnit);
    lines.push(
      last.approximate ? (
        <>
          Last working day: about {formatDate(last.date)} ({noticeLabel(rule.noticeAmount, rule.noticeUnit)} counted Sunday to Thursday; the exact day follows
          the employee&apos;s shift and is set when it is saved).
        </>
      ) : (
        <>Last working day: {formatDate(last.date)}.</>
      ),
    );
  }
  if (rule.key === 'probation' && probationEnd && given && given > probationEnd) {
    lines.push(
      <span className="font-semibold text-danger">
        Too late: probation ended on {formatDate(probationEnd)}, and notice during probation must be given by then. Choose another way to end it.
      </span>,
    );
  }
  if (rule.key === 'resignation' && given) {
    lines.push(<>The company decides by {formatDate(addDays(given, RESIGNATION_DECISION_DAYS))}, or the resignation counts as accepted (Decree 187/2025).</>);
  }
  return (
    <div role="status" className="space-y-1 rounded-lg bg-canvas px-4 py-3 text-sm">
      {lines.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
    </div>
  );
}

export function EndingForm({
  action,
  rules,
  initialRule,
  contract,
  probationEnd,
  today,
  cancelHref,
}: {
  action: Action;
  /** The rules that can be chosen now (active; probation only while on probation; non-renewal only with a fixed term). */
  rules: EndingRule[];
  initialRule?: string;
  /** The signed fixed-term contract, for a non-renewal: it ends on its end date, with notice by 45 working days before. */
  contract: { endDate: string; nonRenewalNoticeBy: string | null } | null;
  /** While on probation: its end date, by which notice during probation must be given. */
  probationEnd: string | null;
  /** YYYY-MM-DD in Cairo: the notice date to start with. */
  today: string;
  cancelHref: string;
}) {
  // Kept form: a refused save leaves everything as typed and chosen.
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();

  const [ruleKey, setRuleKey] = useState(() =>
    valueOf(state, 'ruleKey', rules.some((r) => r.key === initialRule) ? initialRule : rules.length === 1 ? rules[0].key : ''),
  );
  // What is typed, for the preview and the fields that depend on it (the fields themselves stay uncontrolled).
  const [typed, setTyped] = useState<Record<string, string>>(() => ({
    initiator: valueOf(state, 'initiator'),
    noticeGivenOn: valueOf(state, 'noticeGivenOn', formatDate(today)),
    payInLieu: valueOf(state, 'payInLieu'),
  }));
  function track(e: React.FormEvent<HTMLFormElement>) {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || !t.name) return;
    const value = t.type === 'checkbox' ? (t.checked ? t.value : '') : t.value;
    setTyped((v) => ({ ...v, [t.name]: value }));
  }

  const rule = rules.find((r) => r.key === ruleKey);
  const given = parseDate(typed.noticeGivenOn) || null;
  const payInLieu = Boolean(rule?.payInLieu) && typed.payInLieu === 'yes';
  const notice = noticeWording(rule, typed.initiator, contract?.nonRenewalNoticeBy ?? null);

  return (
    <form {...form} onChange={track} className="card max-w-3xl space-y-6 p-6">
      <FormErrors errors={state.errors} />

      <div>
        <label htmlFor={fid('ruleKey')} className="label">
          How the employment ends
        </label>
        <Select
          id={fid('ruleKey')}
          name="ruleKey"
          required
          value={ruleKey}
          onChange={(e) => setRuleKey(e.target.value)}
          aria-describedby={fid('ruleKey-hint')}
          className="input"
        >
          <option value="">Choose how it ends</option>
          {rules.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </Select>
        <p id={fid('ruleKey-hint')} className="hint">
          {rule
            ? `${noticeLabel(rule.noticeAmount, rule.noticeUnit)}${rule.payInLieu ? ', which can be paid instead of worked' : ''}. ${rule.source}.`
            : 'The ways HR set up in Organization → Contracts & Endings, each with its notice.'}
        </p>
      </div>

      {rule?.initiator === 'either' && (
        <fieldset>
          <legend className="label">Who started it</legend>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['employee', 'The employee'],
                ['company', 'The company'],
              ] as const
            ).map(([value, text]) => (
              <label
                key={value}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft"
              >
                <input type="radio" name="initiator" value={value} required defaultChecked={typed.initiator === value} className="size-4 accent-accent" />
                {text}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('noticeGivenOn')} className="label">
            {notice.label}
          </label>
          <DateInput
            id={fid('noticeGivenOn')}
            name="noticeGivenOn"
            required
            aria-describedby={fid('noticeGivenOn-hint')}
            defaultValue={valueOf(state, 'noticeGivenOn', formatDate(today))}
          />
          <p id={fid('noticeGivenOn-hint')} className="hint">
            {notice.hint}
          </p>
        </div>
        {rule?.payInLieu && (
          <div className="sm:pt-7">
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="payInLieu"
                value="yes"
                defaultChecked={typed.payInLieu === 'yes'}
                aria-describedby={fid('payInLieu-hint')}
                className="mt-0.5 size-4 accent-accent"
              />
              <span>
                <span className="font-medium">Pay the notice instead of it being worked</span>
                <span id={fid('payInLieu-hint')} className="hint block">
                  The employee stops working on the notice date, and the notice period is paid.
                </span>
              </span>
            </label>
          </div>
        )}
      </div>

      {rule?.key === 'resignation' && (
        <fieldset className="space-y-3" aria-describedby={fid('certified-hint')}>
          <legend className="font-semibold">Certified at the Labour Office</legend>
          <p id={fid('certified-hint')} className="text-sm text-muted">
            A resignation counts only once it is certified at the labour office (Decree 187/2025): enter the office, the serial number and the date on the
            certificate.
          </p>
          <div className="grid gap-5 sm:grid-cols-3">
            <div>
              <label htmlFor={fid('certifiedOffice')} className="label">
                Labour office
              </label>
              <input
                id={fid('certifiedOffice')}
                name="certifiedOffice"
                required
                maxLength={120}
                autoComplete="off"
                defaultValue={valueOf(state, 'certifiedOffice')}
                className="input"
              />
            </div>
            <div>
              <label htmlFor={fid('certifiedSerial')} className="label">
                Serial number
              </label>
              <input
                id={fid('certifiedSerial')}
                name="certifiedSerial"
                required
                maxLength={60}
                autoComplete="off"
                defaultValue={valueOf(state, 'certifiedSerial')}
                className="input tabular-nums"
              />
            </div>
            <div>
              <label htmlFor={fid('certifiedOn')} className="label">
                Certified on
              </label>
              <DateInput id={fid('certifiedOn')} name="certifiedOn" required defaultValue={valueOf(state, 'certifiedOn')} />
            </div>
          </div>
        </fieldset>
      )}

      <div className="grid gap-5">
        <div>
          <label htmlFor={fid('reason')} className="label">
            Reason {optional}
          </label>
          <input id={fid('reason')} name="reason" maxLength={200} autoComplete="off" defaultValue={valueOf(state, 'reason')} className="input" />
        </div>
        <div>
          <label htmlFor={fid('note')} className="label">
            Note {optional}
          </label>
          <textarea
            id={fid('note')}
            name="note"
            rows={3}
            maxLength={500}
            aria-describedby={fid('note-hint')}
            defaultValue={valueOf(state, 'note')}
            className="input"
          />
          <p id={fid('note-hint')} className="hint">
            E.g. the handover, or what was agreed. Up to 500 characters.
          </p>
        </div>
      </div>

      <Preview rule={rule} given={given} payInLieu={payInLieu} contract={contract} probationEnd={probationEnd} />

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
        <SubmitButton busy={pending} pendingText="Sending…">
          Send for the CEO&apos;s approval
        </SubmitButton>
        <Link href={cancelHref} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
