import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import type { CardCorrection, LearnedField } from '@/lib/types';
import { deleteCardCorrection } from '../paperwork-actions';
import { BackLink, canSeeCardFixes, Empty, Loading } from '../ui';
import { DeleteFixButton } from './delete-fix-button';

// The fixes the ID card reader learned from HR's corrections (HR and Admin): a word or phrase it read wrong in the
// Arabic name or the address, and how HR corrected it before saving. Each fix is applied to the next readings (the
// fields it changes are marked for checking); one learned by mistake can be deleted.

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
  const fixes = await apiGet<CardCorrection[]>('/id-card/corrections');
  if (fixes.length === 0) {
    return <Empty>Nothing learned yet. A fix is learned when HR corrects a word read from an ID card and saves.</Empty>;
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
            <th>
              <span className="sr-only">Actions</span>
            </th>
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
              <td className="text-right">
                <DeleteFixButton
                  action={deleteCardCorrection.bind(null, f.id)}
                  name={f.wrong}
                  confirmText={`Delete this fix? “${f.wrong}” will no longer be changed to “${f.right}” in the next card readings.`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-3 text-sm text-muted">
        {fixes.length} {fixes.length === 1 ? 'fix' : 'fixes'}. Times: how often HR made the same correction. Last used: when it was last learned or
        confirmed.
      </p>
    </section>
  );
}

export default function CardCorrectionsPage() {
  return (
    <div className="space-y-4">
      <BackLink href="/employees">Employees</BackLink>
      <div>
        <h1 className="text-2xl font-semibold">Card Reading Fixes</h1>
        <p className="mt-1 max-w-3xl text-muted">
          Words the ID card reader got wrong and HR corrected before saving: in the Arabic name and the address, never in numbers or dates. Each
          fix is applied to the next card readings, and the fields it changes are marked for checking. Delete a fix if it was learned by mistake.
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <Fixes />
      </Suspense>
    </div>
  );
}
