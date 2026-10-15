import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import { logoUrl, thumbnailUrl } from '@/lib/brand';
import { canDelete } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { Company } from '@/lib/types';
import { BackLink, Loading, RequireEditor } from '../../ui';
import { CompanyForm } from './company-form';
import { CompanyImageForm } from './image-form';

async function EditCompany() {
  const [user, company] = await Promise.all([getCurrentUser(), apiGet<Company>('/company')]);
  const logoSrc = company.hasLogo && company.logoUpdatedAt ? logoUrl(company.logoUpdatedAt) : null;
  const thumbnailSrc = company.hasThumbnail && company.thumbnailUpdatedAt ? thumbnailUrl(company.thumbnailUpdatedAt) : null;
  const canRemove = canDelete(user);
  return (
    <RequireEditor>
      <div className="space-y-6">
        {/* the logo and the thumbnail beside it (owner's request, 15 October 2026): side by side on a wide screen */}
        <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
          <CompanyImageForm image="logo" name={company.nameEn} src={logoSrc} canRemove={canRemove} />
          <CompanyImageForm image="thumbnail" name={company.nameEn} src={thumbnailSrc} canRemove={canRemove} />
        </div>
        <CompanyForm company={company} />
      </div>
    </RequireEditor>
  );
}

export default function EditCompanyPage() {
  return (
    <div className="space-y-4">
      <BackLink href="/organization/company">Company</BackLink>
      <h2 className="text-lg font-semibold">Edit Company Details</h2>
      <Suspense fallback={<Loading />}>
        <EditCompany />
      </Suspense>
    </div>
  );
}
