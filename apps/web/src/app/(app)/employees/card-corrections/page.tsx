import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { canDelete } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { CardCorrection, LearnedField } from '@/lib/types';
import { StaffOnly } from '../../staff-only';
import { deleteCardCorrection } from '../paperwork-actions';
import { BackLink, canSeeCardFixes, Empty, Loading } from '../ui';
import { DeleteFixButton } from './delete-fix-button';

// The fixes the ID card reader learned from HR's corrections (HR and Admin): a word or phrase it read wrong in the
// Arabic name or the address, and how HR corrected it before saving. Each fix is applied to the next readings (the
// fields it changes are marked for checking); a Super Admin can delete one learned by mistake (only a Super Admin
// deletes, owner's decision of 15 October 2026).

const FIELD_LABEL: Record<LearnedField, string> = {
  fullNameAr: 'Arabic name',
  addressAr: 'Address',
};

function Arabic({ children }: { children: string }) {
  return (
    <span lang="ar" dir="rtl" className="inline-block">
      {children}
    </span>
  );
}

async function Fixes() {
  const user = await getCurrentUser();
  if (!canSeeCardFixes(user)) return <Empty>Only HR and Admin can see what the card reader has learned.</Empty>;
  const mayDelete = canDelete(user);
  const fixes = await apiGet<CardCorrection[]>('/id-card/corrections');
  if (fixes.length === 0) {
    return <Empty>Nothing learned yet.</Empty>;
  }

  return (
    <section className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Field</th>
            <th>As Read</th>
            <th>Corrected To</th>
            <th>Times</th>
            <th>Last Used</th>
            {mayDelete && (
              <th>
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {fixes.map((f) => (
            <tr key={f.id}>
              <td className="whitespace-nowrap">{FIELD_LABEL[f.field] ?? f.field}</td>
              <td>
                <Arabic>{f.wrong}</Arabic>
              </td>
              <td className="font-medium">
                <Arabic>{f.right}</Arabic>
              </td>
              <td className="tabular-nums">{f.timesSeen}</td>
              <td className="whitespace-nowrap tabular-nums">{formatDate(f.updatedAt)}</td>
              {mayDelete && (
                <td className="text-right">
                  <DeleteFixButton
                    action={deleteCardCorrection.bind(null, f.id)}
                    name={f.wrong}
                    confirmText={`Delete the fix of “${f.wrong}”?`}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-3 text-sm text-muted">
        {fixes.length} {fixes.length === 1 ? 'fix' : 'fixes'}
      </p>
    </section>
  );
}

export default function CardCorrectionsPage() {
  return (
    <StaffOnly>
      <div className="space-y-4">
        <BackLink href="/employees">Employees</BackLink>
        <h1 className="page-title">Card Reading Fixes</h1>
        <Suspense fallback={<Loading />}>
          <Fixes />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
