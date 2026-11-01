import Link from 'next/link';
import { Suspense } from 'react';
import { ALLOWANCE_BASIS_LABELS } from '@trendlix/shared';
import { apiGet } from '@/lib/api';
import { canEditOrganisation, getCurrentUser } from '@/lib/session';
import type { AllowanceType } from '@/lib/types';
import { Empty, Loading } from '../ui';

// The kinds of allowance (owner's request, 15 October 2026): paid a month on top of the gross salary, each taxed or not
// and insured or not. HR adds them to contracts and job offers, which keep each one's name and treatment as drafted.
// Everyone signed in can see them; HR and Admin change them (the API checks this again).

const yesNo = (value: boolean) => (value ? 'Yes' : 'No');

async function AllowancesList() {
  const [user, allowances] = await Promise.all([getCurrentUser(), apiGet<AllowanceType[]>('/allowance-types')]);
  const canEdit = canEditOrganisation(user);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {allowances.length} {allowances.length === 1 ? 'allowance' : 'allowances'}
        </p>
        {canEdit && (
          <Link href="/organization/allowances/new" className="btn btn-primary">
            New allowance
          </Link>
        )}
      </div>
      {allowances.length === 0 ? (
        <Empty>No allowances yet.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Allowance</th>
                <th>Arabic Name</th>
                <th>Paid</th>
                <th>Taxed</th>
                <th>Insured</th>
                <th>Status</th>
                <th>
                  In Use<span className="sr-only">: on a contract or offer</span>
                </th>
                {canEdit && (
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {allowances.map((a) => (
                <tr key={a.id} className={a.active ? undefined : 'text-muted'}>
                  <td className="font-medium">{a.nameEn}</td>
                  <td lang="ar" dir="rtl" className="text-right">
                    {a.nameAr}
                  </td>
                  <td>{ALLOWANCE_BASIS_LABELS[a.basis ?? 'fixed']}</td>
                  <td>{yesNo(a.taxable)}</td>
                  <td>{yesNo(a.insured)}</td>
                  <td>
                    {a.active ? <span className="badge bg-ok-soft text-ok">Active</span> : <span className="badge bg-line-soft text-muted">Inactive</span>}
                  </td>
                  <td>{yesNo(a.inUse)}</td>
                  {canEdit && (
                    <td className="text-right">
                      <Link href={`/organization/allowances/${a.id}`}>
                        Edit<span className="sr-only"> {a.nameEn}</span>
                      </Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function AllowancesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AllowancesList />
    </Suspense>
  );
}
