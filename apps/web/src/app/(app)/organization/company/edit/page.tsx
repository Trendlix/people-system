import { Suspense } from 'react';
import { logoUrl } from '@/components/brand';
import { apiGet } from '@/lib/api';
import { canDelete } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { Company } from '@/lib/types';
import { BackLink, Loading, RequireEditor } from '../../ui';
import { CompanyForm } from './company-form';
import { LogoForm } from './logo-form';

async function EditCompany() {
  const [user, company] = await Promise.all([getCurrentUser(), apiGet<Company>('/company')]);
  const logoSrc = company.hasLogo && company.logoUpdatedAt ? logoUrl(company.logoUpdatedAt) : null;
  return (
    <RequireEditor>
      <div className="space-y-6">
        <LogoForm name={company.nameEn} logoSrc={logoSrc} canRemove={canDelete(user)} />
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
