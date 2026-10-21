import { contractStatusOf, type ContractStatusView, type ContractTone } from '@trendlix/shared';
import type { EmployeeSummary } from '../../../lib/types';

// The Employees list's Contract column, in place of the employee code (owner, 21 October 2026: "instead of the Emp code,
// add contract status"; "State + end date"): the row's contract status (contractStatusOf, @trendlix/shared), an end
// within 30 days in amber. The code is still searched. Pure code, tested; relative imports for the tests.

/**
 * A directory row's contract status today (YYYY-MM-DD, in Cairo): null for a C-level person's card (`restricted`: the
 * API sends nothing of it) or a current employment from an API without the facts, so the cell shows nothing.
 */
export function directoryContractStatus(e: EmployeeSummary, today: string): ContractStatusView | null {
  if (e.restricted) return null;
  const job = e.employment;
  if (job && job.contract === undefined) return null;
  return contractStatusOf(
    {
      employment: job && {
        employmentType: job.employmentType,
        status: job.status,
        joinDate: job.joinDate,
        probationEnd: job.probationEnd ?? null,
        contract: job.contract ?? null,
        endingOn: job.endingOn ?? null,
      },
      leftOn: e.lastEnded?.endDate ?? null,
    },
    today,
  );
}

/** Each tone's text: in force as any text, amber for an end within 30 days or past, quiet for nothing in force. */
export const CONTRACT_TONE_STYLE: Record<ContractTone, string> = {
  ok: '',
  warn: 'font-semibold text-warn',
  muted: 'text-muted',
};
