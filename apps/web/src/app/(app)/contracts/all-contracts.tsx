import Link from 'next/link';
import { EMPLOYMENT_TYPES, LABELS, WORK_PATTERN_LABELS } from '@trendlix/shared';
import { Shown } from '@/components/hidden';
import { Select } from '@/components/select';
import { formatDate } from '@/lib/format';
import { isHidden, joinShown, labelOf } from '@/lib/hidden';
import type { ContractListItem } from '@/lib/types';
import { ContractStatusBadge, termLabel } from '../employees/[id]/contracts/contract-section';
import { allowancesLabel, formatEgp, hourlyTerms, payLabel } from '../employees/[id]/contracts/salary';
import { contractLengthText, workNatureLabel } from '../employees/employment-law';
import { LawWarningBadges } from '../employees/law-badges';
import { contractHref } from '../employees/ui';
import { loadContractList } from './data';
import {
  contractsHref,
  countLabel,
  ENDING_WITHIN_DAYS,
  FORM_FILTERS,
  isFiltered,
  listPaths,
  readFilters,
  STATUS_FILTERS,
  type ContractFilters,
} from './list';

// Every contract in the company, filtered by a GET form so the address can be shared: a search, the status (drafts and
// signed unless chosen), the employment type, the contract's length and "ending within". The API does the filtering
// and the order (signed by end date, then drafts, then the rest). Each shows its length and term, how its pay is set,
// and HR's warnings by the labour law (owner, 18 October 2026: a fixed term that became open-ended, Art. 88; casual work
// past its 6 months, Art. 1(7)); the salary (the gross, for pay by the hour the rate, the allowances and the total, and
// the insured salary) only for those who see salaries.

type Query = Record<string, string | string[] | undefined>;

const dash = <span className="text-muted">—</span>;

function FilterSelect({
  id,
  name,
  label,
  value,
  options,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <Select id={id} name={name} defaultValue={value} className="input min-w-44">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

const TYPE_OPTIONS = [{ value: '', label: 'All types' }, ...EMPLOYMENT_TYPES.map((t) => ({ value: t, label: LABELS.employmentType[t] }))];
const ENDING_OPTIONS = [{ value: '', label: 'Any time' }, ...ENDING_WITHIN_DAYS.map((d) => ({ value: String(d), label: `${d} days` }))];

function Filters({ filters: f }: { filters: ContractFilters }) {
  return (
    // keyed by the filters, so following a link to other filters (Clear) shows them, not what was typed before
    <form key={contractsHref(f)} className="flex flex-wrap items-end gap-3 p-4">
      <div className="min-w-56 flex-1">
        <label htmlFor="contract-search" className="label">
          Search
        </label>
        <input
          id="contract-search"
          name="q"
          type="search"
          maxLength={100}
          defaultValue={f.q}
          placeholder="Name, employee code or contract number"
          className="input"
        />
      </div>
      <FilterSelect id="contract-status" name="status" label="Status" value={f.status} options={STATUS_FILTERS} />
      <FilterSelect id="contract-type" name="type" label="Employment type" value={f.type} options={TYPE_OPTIONS} />
      <FilterSelect id="contract-form" name="form" label="Contract length" value={f.form} options={FORM_FILTERS} />
      <FilterSelect id="contract-ending" name="endingWithin" label="Ending within" value={f.endingWithin === null ? '' : String(f.endingWithin)} options={ENDING_OPTIONS} />
      <button type="submit" className="btn btn-secondary">
        Search
      </button>
      {isFiltered(f) && (
        <Link href="/contracts" className="btn btn-secondary">
          Clear
        </Link>
      )}
    </form>
  );
}

/** An amount in EGP, or a dash when there is none or it is hidden from this viewer. */
function Money({ amount, hidden }: { amount: number | null; hidden: boolean }) {
  return hidden || amount === null ? dash : <>{formatEgp(amount)}</>;
}

/** Under the gross: the hourly rate, each allowance and the total with them, and the insured salary. */
function SalaryLines({ contract: c }: { contract: ContractListItem }) {
  const allowances = c.allowances ?? [];
  const hourly = c.payBasis === 'hourly' && c.hourlyRate !== null ? hourlyTerms(c) : null;
  return (
    <div className="text-xs text-muted">
      {hourly && <div>{hourly}</div>}
      {allowances.length > 0 && (
        <>
          <div className="whitespace-normal">+ {allowancesLabel(allowances)}</div>
          {c.totalSalary !== null && <div>Total {formatEgp(c.totalSalary)} a month</div>}
        </>
      )}
      {c.insuredSalary !== null && <div>Insured {formatEgp(c.insuredSalary)}</div>}
    </div>
  );
}

/** Under the employment type: "Paid by commission", "Casual", "Remote work", as they apply, or nothing. */
const employmentNotes = (c: ContractListItem) =>
  [
    c.paidByCommission && 'Paid by commission',
    // hidden from a developer (owner, 22 October 2026: "Hide per-person details"): left out
    c.workNature && c.workNature !== 'regular' && !isHidden(c.workNature) && workNatureLabel(c.workNature),
    c.workPattern && c.workPattern !== 'on_site' && WORK_PATTERN_LABELS[c.workPattern],
  ]
    .filter(Boolean)
    .join(' · ');

function ContractRow({ contract: c, salary }: { contract: ContractListItem; salary: boolean }) {
  return (
    <tr>
      <td>
        <Link href={contractHref(c.employee.id)} className="font-semibold">
          {c.employee.fullNameEn}
        </Link>
        {/* the code, hidden from a developer (23 October 2026), left out */}
        <div className="text-xs text-muted tabular-nums">{joinShown([c.employee.employeeCode, !c.employmentCurrent && 'Past employment'])}</div>
      </td>
      <td className="whitespace-nowrap">
        <span className="tabular-nums">
          <Shown text={c.number} />
        </span>
        <div className="text-xs text-muted">
          Version {c.version}
          {/* an intern's agreement converted to full-time (19 October 2026) */}
          {c.convertsTo && ' · Conversion to full-time'}
        </div>
      </td>
      <td>
        <span className="whitespace-nowrap">
          <Shown text={labelOf(LABELS.employmentType, c.employmentType) ?? c.employmentType} />
        </span>
        {/* by the labour law (18 October 2026): paid by commission, as Sales was; a nature of the work other than regular;
            remote work (Art. 96(1)) */}
        {employmentNotes(c) && <div className="text-xs text-muted">{employmentNotes(c)}</div>}
      </td>
      <td>
        <Shown text={c.jobTitleEn} empty={dash} />
        {c.departmentName && !isHidden(c.departmentName) && <div className="text-xs text-muted">{c.departmentName}</div>}
      </td>
      <td>
        <div className="text-xs text-muted">{contractLengthText(c)}</div>
        <span className="whitespace-nowrap tabular-nums">
          <Shown text={termLabel(c)} />
        </span>
        {/* the hourly rate is with the salary */}
        <div className="text-xs text-muted">{payLabel({ ...c, salaryHidden: true })}</div>
      </td>
      <td>
        <div className="flex flex-wrap gap-1.5">
          <ContractStatusBadge status={c.status} />
          <LawWarningBadges of={c} />
        </div>
      </td>
      <td className="whitespace-nowrap tabular-nums">{c.signedOn ? formatDate(c.signedOn) : dash}</td>
      {salary && (
        <td className="text-right whitespace-nowrap tabular-nums">
          {/* an intern's agreement pays no wage (19 October 2026): its allowances alone */}
          {c.employmentType === 'intern' && !c.convertsTo && !c.salaryHidden ? <span className="text-muted">No wage</span> : <Money amount={c.grossSalary} hidden={c.salaryHidden} />}
          {!c.salaryHidden && <SalaryLines contract={c} />}
        </td>
      )}
    </tr>
  );
}

const quiet = 'border-t border-line px-4 py-10 text-center text-sm text-muted';

export async function AllContracts({ searchParams, salary }: { searchParams: Promise<Query>; salary: boolean }) {
  const f = readFilters(await searchParams);
  const listing = await loadContractList(listPaths(f));

  return (
    <div className="card">
      <Filters filters={f} />
      {listing.kind === 'unavailable' ? (
        <p className={quiet}>Not available yet.</p>
      ) : listing.kind === 'failed' ? (
        <p className={quiet}>
          Couldn&apos;t load the contracts. <span className="block pt-1 text-xs">{listing.message}</span>
        </p>
      ) : listing.rows.length === 0 ? (
        <p className={quiet}>
          No contracts match. {isFiltered(f) && <Link href="/contracts">Clear filters</Link>}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto border-t border-line">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Contract</th>
                  <th>Employment Type</th>
                  <th>Job Title</th>
                  <th>Length, Term and Pay</th>
                  <th>Status</th>
                  <th>Signed On</th>
                  {salary && <th className="text-right">Salary</th>}
                </tr>
              </thead>
              <tbody>
                {listing.rows.map((c) => (
                  <ContractRow key={c.id} contract={c} salary={salary} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-3 text-sm text-muted">{countLabel(listing.rows.length)}</p>
        </>
      )}
    </div>
  );
}
