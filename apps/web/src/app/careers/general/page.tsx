import { Suspense } from 'react';
import type { PublicGeneralForm } from '@trendlix/shared';
import { publicGet } from '@/lib/public-api';
import { BackLink, Loading, Notice, PageFrame, PageHead } from '../ui';
import { sendGeneralCv } from './actions';
import { GeneralForm } from './general-form';

// "Send us your CV" on the careers page (owner, 22 October 2026: "what came out of the posted jobs and what cam on
// randomly", "Both"): for someone who doesn't see their role among the open jobs, with the areas (the company's
// departments) to choose from. Public, like the open jobs; dressed as trendlix.com ("i need it to match the UI"): its
// page hero, then the form.

async function General() {
  const form = await publicGet<PublicGeneralForm>('/general-cvs/form');
  if (!form.ok) {
    return (
      <Notice title="This Form Can’t Be Shown Right Now" back>
        <p>Please try again in a few minutes.</p>
      </Notice>
    );
  }
  return (
    <div className="careers-container">
      <BackLink />
      <PageHead crumb="Careers" title="Send Us Your CV">
        <p className="careers-page-lead">No job open for you right now? Tell us what you do, and we will contact you when one fits.</p>
      </PageHead>
      <div className="mt-12 max-w-3xl lg:mt-16">
        <GeneralForm action={sendGeneralCv} areas={form.data.areas} />
      </div>
    </div>
  );
}

export default function GeneralPage() {
  return (
    <PageFrame>
      <Suspense fallback={<Loading>Loading the form…</Loading>}>
        <General />
      </Suspense>
    </PageFrame>
  );
}
