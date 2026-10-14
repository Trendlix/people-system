import Image from 'next/image';
import Link from 'next/link';
import { Suspense } from 'react';
import { logoUrl } from '@/components/brand';
import { apiGet } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { canEditOrganisation, getCurrentUser } from '@/lib/session';
import type { Company } from '@/lib/types';
import { Loading } from '../ui';

function Row({ label, children, ar = false }: { label: string; children: React.ReactNode; ar?: boolean }) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className="grid gap-1 border-b border-line-soft py-3 last:border-0 sm:grid-cols-[13rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-sm break-words">
        {empty ? (
          <span className="text-muted">Not set</span>
        ) : ar ? (
          <span lang="ar" dir="rtl" className="inline-block">
            {children}
          </span>
        ) : (
          children
        )}
      </dd>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card p-6">
      <h3 className="font-semibold">{title}</h3>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      <dl className="mt-3">{children}</dl>
    </section>
  );
}

function websiteHref(site: string): string {
  return /^https?:\/\//i.test(site) ? site : `https://${site}`;
}

async function CompanyProfile() {
  const [user, company] = await Promise.all([getCurrentUser(), apiGet<Company>('/company')]);
  const canEdit = canEditOrganisation(user);

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-5 p-6">
        <span className="relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-white">
          {company.hasLogo && company.logoUpdatedAt ? (
            <Image src={logoUrl(company.logoUpdatedAt)} alt={`${company.nameEn} logo`} fill unoptimized className="object-contain p-2" />
          ) : (
            <span className="text-3xl font-bold text-muted">{company.nameEn.charAt(0).toUpperCase()}</span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">{company.nameEn}</h2>
          {company.nameAr && (
            <p lang="ar" dir="rtl" className="w-fit text-lg">
              {company.nameAr}
            </p>
          )}
          {!company.hasLogo && canEdit && <p className="mt-1 text-sm text-muted">No logo yet.</p>}
        </div>
        {canEdit && (
          <Link href="/organization/company/edit" className="btn btn-primary">
            Edit company details
          </Link>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Registration">
          <Row label="Commercial registration">{company.commercialRegNo}</Row>
          <Row label="Tax registration number">{company.taxRegNo}</Row>
          <Row label="Social insurance employer no.">{company.insuranceEmployerNo}</Row>
          <Row label="Business activity" ar>
            {company.activity}
          </Row>
        </Section>

        <Section title="Address & Contact">
          <Row label="Address (Arabic)" ar>
            {company.addressAr}
          </Row>
          <Row label="Address (English)">{company.addressEn}</Row>
          <Row label="City">{company.city}</Row>
          <Row label="Phone">{company.phone}</Row>
          <Row label="Email">{company.email && <a href={`mailto:${company.email}`}>{company.email}</a>}</Row>
          <Row label="Website">
            {company.website && (
              <a href={websiteHref(company.website)} target="_blank" rel="noopener noreferrer">
                {company.website}
              </a>
            )}
          </Row>
        </Section>

        <Section title="Company Representative" hint="Signs documents on the company's behalf, such as the clearance form.">
          <Row label="Name" ar>
            {company.repName}
          </Row>
          <Row label="Job title">{company.repTitle}</Row>
          <Row label="National ID">{company.repNationalIdMasked}</Row>
        </Section>
      </div>

      <p className="text-xs text-muted">Last updated {formatDate(company.updatedAt)}. Names and the Arabic address are printed on contracts and other documents.</p>
    </div>
  );
}

export default function CompanyPage() {
  return (
    <Suspense fallback={<Loading />}>
      <CompanyProfile />
    </Suspense>
  );
}
