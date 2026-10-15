import Link from 'next/link';
import { Suspense } from 'react';
import { canDelete } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { EmployeeProfile } from '@/lib/types';
import { canSeeEmployeeFiles, ProfileSection, profileHref } from '../../ui';
import { ContractSection, ContractSectionLoading } from '../contracts/contract-section';
import { endingInProgress } from '../employment-tab';
import { GeneratedDocuments, GeneratedDocumentsLoading } from './document-rows';

// The profile's Contracts tab: what the company issues. First the current employment's contract (its signed version,
// a draft to sign, New contract or Renew, the filing dates, every version), moved here from the Employment tab; then the
// documents generated from the templates, per contract version and for hiring, letters and leaving. Social insurance
// (its details and Forms 1 and 6) has its own tab since 16 October 2026 (owner's request); the contract's social
// insurance copy stays here, with the contract. The papers the employee brings stay on the Documents tab.
//
// Whoever sees the Employment details sees the contract, as before; the generated documents are HR's and the CEO's
// (HR generates and moves them along, the CEO views and downloads; the API checks this again).

export async function ContractsTab({ profile: p }: { profile: EmployeeProfile }) {
  const user = await getCurrentUser();
  const e = p.employment;
  return (
    <div className="space-y-8">
      {/* where a missing contract detail links to (#contract) */}
      <div id="contract" className="scroll-mt-6">
        {e ? (
          // loads on its own, so a slow contract list doesn't hold up the tab
          <Suspense fallback={<ContractSectionLoading />}>
            <ContractSection employee={p} employment={e} endingInProgress={endingInProgress(e)} />
          </Suspense>
        ) : (
          <ProfileSection title="Contract">
            <p className="rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">
              {p.fullNameEn} has no current employment, so no contract is in force.
              {p.access.edit && (
                <>
                  {' '}
                  Add the employment on the <Link href={profileHref(p.id, 'employment')}>Employment tab</Link> first; its contract comes after.
                </>
              )}
            </p>
          </ProfileSection>
        )}
      </div>

      {canSeeEmployeeFiles(user) && (
        // loads on its own too
        <Suspense fallback={<GeneratedDocumentsLoading />}>
          <GeneratedDocuments employee={p} can={{ act: p.access.edit, delete: canDelete(user) }} />
        </Suspense>
      )}
    </div>
  );
}
