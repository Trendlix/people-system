import Link from 'next/link';
import { EMPLOYMENT_TYPES, LABELS } from '@trendlix/shared';
import { Select } from '@/components/select';
import { formatDate } from '@/lib/format';
import type { ContractListItem } from '@/lib/types';
import { ContractStatusBadge, termLabel } from '../employees/[id]/contracts/contract-section';
import { allowancesLabel, formatEgp, hourlyTerms, payLabel } from '../employees/[id]/contracts/salary';
import { profileHref } from '../employees/ui';
import { loadContractList } from './data';
import { contractsHref, countLabel, ENDING_WITHIN_DAYS, isFiltered, listPaths, readFilters, STATUS_FILTERS, type ContractFilters } from './list';

// Every contract in the company, filtered by a GET form so the address can be shared: a search, the status (drafts and
// signed unless chosen), the employment type and "ending within" (every contract is for a fixed term, so there is no
// term to filter by). The API does the filtering and the order (signed by end date, then drafts, then the rest). Each
// shows its term and how its pay is set; the salary (the gross, for pay by the hour the rate, the allowances and the
// total, and the insured salary) only for those who see salaries.

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

function ContractRow({ contract: c, salary }: { contract: ContractListItem; salary: boolean }) {
  return (
    <tr>
      <td>
        <Link href={profileHref(c.employee.id, 'contracts')} className="font-semibold">
          {c.employee.fullNameEn}
        </Link>
        <div className="text-xs text-muted">
          <span className="tabular-nums">{c.employee.employeeCode}</span>
          {!c.employmentCurrent && ' · Past employment'}
        </div>
      </td>
      <td className="whitespace-nowrap">
        <span className="tabular-nums">{c.number}</span>
        <div className="text-xs text-muted">Version {c.version}</div>
      </td>
      <td className="whitespace-nowrap">{LABELS.employmentType[c.employmentType] ?? c.employmentType}</td>
      <td>
        {c.jobTitleEn ?? dash}
        {c.departmentName && <div className="text-xs text-muted">{c.departmentName}</div>}
      </td>
      <td>
        <span className="whitespace-nowrap tabular-nums">{termLabel(c)}</span>
        {/* the hourly rate is with the salary */}
        <div className="text-xs text-muted">{payLabel({ ...c, salaryHidden: true })}</div>
      </td>
      <td>
        <ContractStatusBadge status={c.status} />
      </td>
      <td className="whitespace-nowrap tabular-nums">{c.signedOn ? formatDate(c.signedOn) : dash}</td>
      {salary && (
        <td className="text-right whitespace-nowrap tabular-nums">
          <Money amount={c.grossSalary} hidden={c.salaryHidden} />
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
                  <th>Term and Pay</th>
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
