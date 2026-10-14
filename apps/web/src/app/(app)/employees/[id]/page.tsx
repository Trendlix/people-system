import Link from 'next/link';
import { Suspense } from 'react';
import { LABELS } from '@trendlix/shared';
import { apiGet } from '@/lib/api';
import { departmentName } from '@/lib/departments';
import { formatDate, formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import type { EmployeeBank, EmployeeIdentity } from '@/lib/types';
import { loadEmployee } from '../data';
import { Avatar, BackLink, DAY_NAMES, Loading, Row, Section, seesEveryone, shiftLabel, StatusBadge } from '../ui';
import { EmployeeFile, EmployeeFileLoading } from './employee-file';

/** National ID cards close to expiry get a warning this many days ahead. */
const EXPIRY_WARNING_DAYS = 60;

type Query = Record<string, string | string[] | undefined>;

function todayInCairo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
}

function ExpiryBadge({ expiry, today }: { expiry: string; today: string }) {
  const days = (Date.parse(expiry) - Date.parse(today)) / 86_400_000;
  if (days < 0) return <span className="badge bg-danger-soft text-danger">Expired</span>;
  if (days <= EXPIRY_WARNING_DAYS) return <span className="badge bg-warn-soft text-warn">Expires soon</span>;
  return <span className="badge bg-ok-soft text-ok">Valid</span>;
}

/**
 * Show / Hide for the full restricted numbers. Never prefetched: opening them is written to the audit log,
 * so it must only happen when someone clicks.
 */
function Reveal({ href, shown }: { href: string; shown: boolean }) {
  return (
    <>
      <Link href={href} prefetch={false} scroll={false} className="ml-3 text-sm font-semibold">
        {shown ? 'Hide' : 'Show'}
      </Link>
      <span className="mt-1 block text-xs text-muted">Viewing this is recorded.</span>
    </>
  );
}

function Masked({ value }: { value: string | null }) {
  return value ? <span className="tabular-nums">{value}</span> : <span className="text-muted">Not set</span>;
}

async function Profile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const [user, p, query] = await Promise.all([getCurrentUser(), loadEmployee(params), searchParams]);
  const id = p.id;

  // The full national ID and bank numbers are only fetched (and audited) when asked for with ?show=.
  const show = query.show;
  const [identity, bank] = await Promise.all([
    show === 'national-id' && p.access.identity && p.identity ? apiGet<EmployeeIdentity>(`/employees/${id}/identity`) : null,
    show === 'bank' && p.access.bank && p.bank ? apiGet<EmployeeBank>(`/employees/${id}/bank`) : null,
  ]);
  const today = todayInCairo();

  const base = `/employees/${id}`;
  const edit = (part: string) => (p.access.edit ? `${base}/edit/${part}` : undefined);
  const department = p.department && departmentName(p.department); // "Marketing › Content Team" for a team
  const role = [p.jobTitle?.titleEn, department].filter(Boolean).join(' · ');
  const emergency = p.emergencyName
    ? `${p.emergencyName}${p.emergencyRelation ? ` (${p.emergencyRelation})` : ''}${p.emergencyMobile ? ` · ${p.emergencyMobile}` : ''}`
    : p.emergencyMobile;
  const arrangement =
    p.workArrangement === 'hybrid' && p.officeDays.length > 0
      ? `${LABELS.workArrangement.hybrid} · in the office on ${[...p.officeDays]
          .sort()
          .map((d) => DAY_NAMES[d])
          .join(', ')}`
      : LABELS.workArrangement[p.workArrangement];
  // Only people who can open every profile get a link; others may not be allowed to see the manager's profile.
  const linkManager = seesEveryone(user);

  return (
    <div className="space-y-4">
      <section className="card flex flex-wrap items-center gap-6 p-6">
        <Avatar name={p.fullNameEn} size="lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold">{p.fullNameEn}</h1>
            <span lang="ar" dir="rtl" className="text-lg text-muted">
              {p.fullNameAr}
            </span>
            <StatusBadge status={p.status} />
            <span className="badge bg-line-soft text-ink">{LABELS.employmentType[p.employmentType]}</span>
          </div>
          <p className="text-muted">{role || 'No job title yet'}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
            <span className="rounded-md bg-ink px-2.5 py-1 font-semibold text-white tabular-nums">{p.employeeCode}</span>
            {p.manager && <span>Reports to {p.manager.fullNameEn}</span>}
            <span>Joined {formatDate(p.joinDate)}</span>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section title="Personal" editHref={edit('personal')}>
          <Row label="Employee code">{p.employeeCode}</Row>
          <Row label="Full name (English)">{p.fullNameEn}</Row>
          <Row label="Full name (Arabic)" ar>
            {p.fullNameAr}
          </Row>
          <Row label="Date of birth">{formatDate(p.dateOfBirth)}</Row>
          <Row label="Gender">{p.gender && LABELS.gender[p.gender]}</Row>
          <Row label="Nationality">{p.nationality}</Row>
          <Row label="Marital status">{p.maritalStatus && LABELS.maritalStatus[p.maritalStatus]}</Row>
          <Row label="Military status">
            {/* Military service does not apply to women, whatever was recorded before. */}
            {p.gender === 'female' ? LABELS.militaryStatus.not_applicable : p.militaryStatus && LABELS.militaryStatus[p.militaryStatus]}
          </Row>
        </Section>

        <Section title="Contact & Address" editHref={edit('personal')}>
          <Row label="Work email">{p.workEmail && <a href={`mailto:${p.workEmail}`}>{p.workEmail}</a>}</Row>
          <Row label="Personal email">{p.personalEmail && <a href={`mailto:${p.personalEmail}`}>{p.personalEmail}</a>}</Row>
          <Row label="Mobile">{p.mobile}</Row>
          <Row label="Address (Arabic)" ar>
            {p.addressAr}
          </Row>
          <Row label="Governorate">{p.governorate}</Row>
          <Row label="Emergency contact">{emergency}</Row>
        </Section>

        <Section title="Education" editHref={edit('personal')}>
          <Row label="University">{p.university}</Row>
          <Row label="Faculty">{p.faculty}</Row>
          <Row label="Degree">{p.degree && LABELS.degree[p.degree]}</Row>
          <Row label="Major">{p.major}</Row>
          <Row label="Graduation year">{p.graduationYear}</Row>
          <Row label="Grade">{p.educationGrade && LABELS.educationGrade[p.educationGrade]}</Row>
          <Row label="Qualification (Arabic)" ar>
            {p.qualificationAr}
          </Row>
        </Section>

        <Section title="Employment" editHref={edit('employment')}>
          <Row label="Employment type">{LABELS.employmentType[p.employmentType]}</Row>
          <Row label="Status">
            <StatusBadge status={p.status} />
          </Row>
          <Row label="Department">{department}</Row>
          <Row label="Job title">{p.jobTitle?.titleEn}</Row>
          <Row label="Job title (Arabic)" ar>
            {p.jobTitle?.titleAr}
          </Row>
          <Row label="Grade">{p.jobTitle?.grade}</Row>
          <Row label="Direct manager">
            {p.manager && (linkManager ? <Link href={`/employees/${p.manager.id}`}>{p.manager.fullNameEn}</Link> : p.manager.fullNameEn)}
          </Row>
          <Row label="Join date">{formatDate(p.joinDate)}</Row>
          <Row label="Probation end date">{formatDate(p.probationEnd)}</Row>
          <Row label="Work arrangement">{arrangement}</Row>
          <Row label="Shift">{p.shift && shiftLabel(p.shift)}</Row>
          <Row label="Job description acknowledged">
            {p.jdAcknowledgedAt ? formatDate(p.jdAcknowledgedAt) : <span className="text-muted">Not yet</span>}
          </Row>
        </Section>

        {p.reports.length > 0 && (
          <section className="card p-6">
            <h2 className="font-semibold">Direct Reports</h2>
            <p className="mt-1 text-sm text-muted">
              {p.reports.length} direct {p.reports.length === 1 ? 'report' : 'reports'}
            </p>
            <ul className="mt-3">
              {p.reports.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft py-3 last:border-0">
                  <div className="min-w-0">
                    <Link href={`/employees/${r.id}`} className="text-sm font-semibold">
                      {r.fullNameEn}
                    </Link>
                    <p className="text-xs text-muted">
                      {r.employeeCode}
                      {r.jobTitle && ` · ${r.jobTitle.titleEn}`}
                    </p>
                  </div>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {p.access.identity && (
          <Section
            title="National ID"
            restricted
            editHref={edit('national-id')}
            emptyText={p.identity ? undefined : 'No national ID details recorded yet.'}
          >
            {p.identity && (
              <>
                <Row label="National ID number">
                  {identity ? (
                    <span className="tabular-nums">{identity.nationalId ?? 'Not set'}</span>
                  ) : (
                    <Masked value={p.identity.nationalIdMasked} />
                  )}
                  {(p.identity.nationalIdMasked || p.identity.printedNoMasked) && (
                    <Reveal href={identity ? base : `${base}?show=national-id`} shown={Boolean(identity)} />
                  )}
                </Row>
                <Row label="Printed number">{identity ? identity.printedNo : p.identity.printedNoMasked}</Row>
                <Row label="Issue date">{formatDate(p.identity.issueDate)}</Row>
                <Row label="Expiry date">
                  {p.identity.expiryDate && (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      {formatDate(p.identity.expiryDate)}
                      <ExpiryBadge expiry={p.identity.expiryDate} today={today} />
                    </span>
                  )}
                </Row>
                <Row label="Issuing office" ar>
                  {p.identity.issuingOffice}
                </Row>
              </>
            )}
          </Section>
        )}

        {p.access.bank && (
          <Section title="Bank & Payment" restricted editHref={edit('bank')} emptyText={p.bank ? undefined : 'No bank details recorded yet.'}>
            {p.bank && (
              <>
                <Row label="Bank">{p.bank.bankName}</Row>
                <Row label="Branch">{p.bank.branch}</Row>
                <Row label="Account number">
                  {bank ? <span className="tabular-nums">{bank.accountNo ?? 'Not set'}</span> : <Masked value={p.bank.accountNoMasked} />}
                  {(p.bank.accountNoMasked || p.bank.ibanMasked) && <Reveal href={bank ? base : `${base}?show=bank`} shown={Boolean(bank)} />}
                </Row>
                <Row label="IBAN">{bank ? bank.iban : p.bank.ibanMasked}</Row>
                <Row label="Account holder">{p.bank.holderName}</Row>
              </>
            )}
          </Section>
        )}
      </div>

      {/* HR and CEO, exactly those who may see the national ID. Loads on its own, so a slow file list doesn't hold up the profile. */}
      {p.access.identity && (
        <Suspense fallback={<EmployeeFileLoading />}>
          <EmployeeFile employee={p} />
        </Suspense>
      )}

      <p className="text-xs text-muted">
        Added {formatDate(p.createdAt)} · last updated {formatDateTime(p.updatedAt)}.
      </p>
    </div>
  );
}

export default function EmployeePage({ params, searchParams }: PageProps<'/employees/[id]'>) {
  return (
    <div className="space-y-4">
      <BackLink href="/employees">Employees</BackLink>
      <Suspense fallback={<Loading />}>
        <Profile params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
