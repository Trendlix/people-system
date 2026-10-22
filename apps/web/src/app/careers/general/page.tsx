import { Suspense } from 'react';
import type { PublicGeneralForm } from '@trendlix/shared';
import { getBrand } from '@/lib/api';
import { publicGet } from '@/lib/public-api';
import { CompanyHeader, Notice, type CareersBrand } from '../ui';
import { sendGeneralCv } from './actions';
import { GeneralForm } from './general-form';

// "Send us your CV" on the careers page (owner, 22 October 2026: "what came out of the posted jobs and what cam on
// randomly", "Both"): for someone who doesn't see their role among the open jobs, with the areas (the company's
// departments) to choose from. Public, like the open jobs.

async function General() {
  const [form, logo] = await Promise.all([publicGet<PublicGeneralForm>('/general-cvs/form'), getBrand()]);
  if (!form.ok) {
    return (
      <Notice brand={null} title="This Form Can't Be Shown Right Now">
        <p>Please try again in a few minutes.</p>
      </Notice>
    );
  }
  const { company, areas } = form.data;
  const brand: CareersBrand = { nameEn: company.nameEn || logo.nameEn, nameAr: company.nameAr ?? logo.nameAr, logoVersion: logo.logoVersion, thumbnailVersion: logo.thumbnailVersion };
  return (
    <>
      <CompanyHeader brand={brand} />
      <GeneralForm action={sendGeneralCv} areas={areas} />
    </>
  );
}

export default function GeneralPage() {
  return (
    <Suspense fallback={<p className="py-8 text-center text-sm text-muted">Loading the form…</p>}>
      <General />
    </Suspense>
  );
}
