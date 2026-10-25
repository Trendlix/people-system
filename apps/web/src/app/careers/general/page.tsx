import { Suspense } from 'react';
import { linkedinFormKey, type PublicGeneralForm } from '@trendlix/shared';
import { publicGet } from '@/lib/public-api';
import { BackLink, Loading, Notice, PageFrame, PageHead } from '../ui';
import { sendGeneralCv } from './actions';
import { GeneralForm } from './general-form';

// "Send us your CV" on the careers page (owner, 22 October 2026: "what came out of the posted jobs and what cam on
// randomly", "Both"): for someone who doesn't see their role among the open jobs, with the positions to choose from
// (owner, 25 October 2026: "should it be the positions?"; asked, "Position, grouped by team": the job titles with their
// levels merged, under the teams by their own names, never C-level). Public, like the open jobs; dressed as
// trendlix.com ("i need it to match the UI"): its page hero, then the form. An API from before the positions has none
// to offer: the form waits for it ("can't be shown right now") rather than asking for an area it no longer keeps. Since
// 25 October 2026 (owner: "can i use linkedin to complete the data? and for creatives, they need to add their
// portfolios"): the portfolio each position asks for, "Fill in with LinkedIn" when it is on, and the address's
// ?linkedin= back from it, which the form reads.

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

async function General({ searchParams }: Props) {
  const [form, query] = await Promise.all([publicGet<PublicGeneralForm>('/general-cvs/form'), searchParams]);
  const returned = Array.isArray(query.linkedin) ? query.linkedin[0] : query.linkedin;
  if (!form.ok || !Array.isArray(form.data.positions)) {
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
        <GeneralForm
          action={sendGeneralCv}
          positions={form.data.positions}
          portfolios={{ portfolios: form.data.portfolios, otherPortfolio: form.data.otherPortfolio }}
          linkedin={{ on: form.data.linkedinSignIn === true, formKey: linkedinFormKey({ kind: 'general' }), returned: returned ?? null }}
        />
      </div>
    </div>
  );
}

export default function GeneralPage(props: Props) {
  return (
    <PageFrame>
      <Suspense fallback={<Loading>Loading the form…</Loading>}>
        <General {...props} />
      </Suspense>
    </PageFrame>
  );
}
