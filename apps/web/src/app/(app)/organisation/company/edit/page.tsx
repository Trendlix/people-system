import { Suspense } from 'react';
import { logoUrl } from '@/components/brand';
import { apiGet } from '@/lib/api';
import type { Company } from '@/lib/types';
import { BackLink, Loading, RequireEditor } from '../../ui';
import { CompanyForm } from './company-form';
import { LogoForm } from './logo-form';

async function EditCompany() {
  const company = await apiGet<Company>('/company');
  const logoSrc = company.hasLogo && company.logoUpdatedAt ? logoUrl(company.logoUpdatedAt) : null;
  return (
    <RequireEditor>
      <div className="space-y-6">
        <LogoForm name={company.nameEn} logoSrc={logoSrc} />
        <CompanyForm company={company} />
      </div>
    </RequireEditor>
  );
}

export default function EditCompanyPage() {
  return (
    <div className="space-y-4">
      <BackLink href="/organisation/company">Company</BackLink>
      <h2 className="text-lg font-semibold">Edit company details</h2>
      <Suspense fallback={<Loading />}>
        <EditCompany />
      </Suspense>
    </div>
  );
}
