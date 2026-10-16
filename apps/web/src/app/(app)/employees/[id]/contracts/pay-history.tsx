import { RAISE_REASON_LABELS } from '@trendlix/shared';
import { formatDate } from '@/lib/format';
import type { Contract } from '@/lib/types';
import { recordForm2 } from '../../raise-actions';
import { changeLabel, changeOf, decisionText, fromToText, insuredFromText, stageOf, versionBefore } from './raise';
import { RecordForm2 } from './raise-buttons';
import { StageBadge } from './raise-card';

// The current employment's pay history in the Contract section (owner's decisions, 16 October 2026: "think about
// tracking the salary raises through the employment period too"): every contract version, newest first, as what it is
// to the one before (Hired, Amendment, New contract, Renewal), from when, the gross before and after (to those who see
// salaries), why, where it stands, the CEO's decision, and from when the insured wage follows it (the next January, or
// the date given with Form 2, which HR records for an approved raise, signed or not). Its documents are with the
// contract documents further down the tab.

const dash = <span className="text-muted">—</span>;

/** A version's documents are generated once it needs no approval, or the CEO approved it. */
const documentsGenerated = (c: Contract) => !c.raise || c.raise.approval === 'approved';

export function PayHistory({ contracts, canRecordForm2, seesDocuments }: { contracts: Contract[]; canRecordForm2: boolean; seesDocuments: boolean }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <caption className="sr-only">Pay history: every contract version, newest first</caption>
        <thead>
          <tr>
            <th>Version</th>
            <th>Number</th>
            <th>Kind</th>
            <th>Effective Date</th>
            <th>Gross From → To</th>
            <th>Reason</th>
            <th>Status</th>
            <th>CEO&apos;s Decision</th>
            <th>Insured Wage From</th>
            {seesDocuments && (
              <th>
                <span className="sr-only">Documents</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {contracts.map((c) => {
            const change = changeOf(c, contracts);
            const before = change === 'hired' ? null : versionBefore(c, contracts);
            const stage = stageOf(c);
            const r = c.raise;
            const name = `version ${c.version} (${c.number})`;
            return (
              <tr key={c.id}>
                <td className="tabular-nums">{c.version}</td>
                <td className="whitespace-nowrap">{c.number}</td>
                <td className="whitespace-nowrap">{changeLabel(change)}</td>
                <td className="whitespace-nowrap tabular-nums">{formatDate(c.startDate)}</td>
                <td className="min-w-56 tabular-nums">{c.salaryHidden ? dash : (fromToText(before?.grossSalary ?? null, c.grossSalary) ?? dash)}</td>
                <td className="whitespace-nowrap">{r ? RAISE_REASON_LABELS[r.reason] : dash}</td>
                <td>
                  <StageBadge stage={stage} />
                </td>
                <td className="min-w-40">
                  {decisionText(r) ?? dash}
                  {stage === 'returned' && r?.returnedReason && <span className="block text-xs text-muted">{r.returnedReason}</span>}
                </td>
                <td className="whitespace-nowrap tabular-nums">
                  {r ? insuredFromText(r) : dash}
                  {canRecordForm2 && r?.approval === 'approved' && <RecordForm2 action={recordForm2.bind(null, c.id, c.startDate)} effective={c.startDate} form2From={r.form2From} name={name} />}
                </td>
                {seesDocuments && (
                  <td className="whitespace-nowrap">
                    {documentsGenerated(c) ? (
                      <a href="#contract-documents" className="inline-flex min-h-9 items-center text-sm font-semibold">
                        Documents<span className="sr-only"> of {name}</span>
                      </a>
                    ) : (
                      <span className="text-xs text-muted">Once approved</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
