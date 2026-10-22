import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import { BackLink, Empty, Loading } from '../../../organization/ui';
import { loadGeneralAreas } from '../../data';
import { addGeneralCv } from '../../general-actions';
import { tabHref } from '../../general';
import { AddCvForm } from '../../general-forms';
import { managesRecruitment } from '../../recruitment';

// HR's Add a CV (owner, 22 October 2026: "what came out of the posted jobs and what cam on randomly", "Both"): one that
// came by email, WhatsApp, LinkedIn, in person or by referral, kept as a general CV with the person's agreement as HR
// ticked it (who and when).

export const metadata: Metadata = { title: 'Add a CV · People System' };

async function AddCv() {
  const user = await getCurrentUser();
  if (!managesRecruitment(user)) return <Empty>Only HR and a Super Admin add CVs.</Empty>;
  const areas = await loadGeneralAreas();
  return <AddCvForm action={addGeneralCv} areas={areas} />;
}

export default function AddCvPage() {
  return (
    <div className="max-w-3xl space-y-4">
      <div className="space-y-2">
        <BackLink href={tabHref('general')}>General CVs</BackLink>
        <h1 className="text-2xl font-semibold">Add a CV</h1>
        <p className="text-sm text-muted">A CV that came without a posted job: by email, WhatsApp, LinkedIn, in person or by referral.</p>
      </div>
      <Suspense fallback={<Loading />}>
        <AddCv />
      </Suspense>
    </div>
  );
}
