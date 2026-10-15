import Link from 'next/link';
import { bankNamed, LABELS } from '@trendlix/shared';
import { DeleteForm } from '@/components/form';
import { apiGet } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { EmployeeBank, EmployeeIdentity, EmployeeProfile } from '@/lib/types';
import { deleteEmployee } from '../actions';
import { ExpiryChip, FieldGrid, ProfileSection } from '../ui';
import { bankShown } from './edit/bank/bank-rules';

// The Basic Data and Education tabs: the profile's fields in a grid, label above value. Fields counted in the profile's
// completeness are tagged Required and shown as not captured while empty (the same list as the API's completeness);
// the restricted numbers are tagged Protected and shown masked, with Show for the full number.

/** Edit links go to the edit pages, for HR only (the API checks this again). */
const editLink = (p: EmployeeProfile, part: string) => (p.access.edit ? `/employees/${p.id}/edit/${part}` : undefined);

/**
 * Show / Hide for the full restricted numbers. Never prefetched: opening them is written to the audit log, so it must
 * only happen when someone clicks.
 */
function Reveal({ href, shown, what }: { href: string; shown: boolean; what: string }) {
  return (
    <Link href={href} prefetch={false} scroll={false} className="ml-3 text-sm font-semibold">
      {shown ? 'Hide' : 'Show'}
      <span className="sr-only"> the full {what}</span>
    </Link>
  );
}

const number = (value: string | null | undefined) => value && <span className="tabular-nums">{value}</span>;

/** Basic Data: personal, contact and address, emergency contact, then (for those allowed) the national ID and bank details. */
export async function BasicTab({ profile: p, show, today }: { profile: EmployeeProfile; show: string; today: string }) {
  // The full national ID and bank numbers are only fetched (and audited) when asked for with ?show=.
  const [identity, bank] = await Promise.all([
    show === 'national-id' && p.access.identity && p.identity ? apiGet<EmployeeIdentity>(`/employees/${p.id}/identity`) : null,
    show === 'bank' && p.access.bank && p.bank ? apiGet<EmployeeBank>(`/employees/${p.id}/bank`) : null,
  ]);
  const base = `/employees/${p.id}`;
  const recorded = 'Viewing the full number is recorded.';
  // the numbers as shown: full when asked for, else masked; Show (or Hide) goes with the first one there is
  const idNumber = identity ? identity.nationalId : p.identity?.nationalIdMasked;
  const printedNo = identity ? identity.printedNo : p.identity?.printedNoMasked;
  const revealId = <Reveal href={identity ? base : `${base}?show=national-id`} shown={Boolean(identity)} what="national ID numbers" />;
  const accountNo = bank ? bank.accountNo : p.bank?.accountNoMasked;
  const iban = bank ? bank.iban : p.bank?.ibanMasked;
  const revealBank = <Reveal href={bank ? base : `${base}?show=bank`} shown={Boolean(bank)} what="bank account number and IBAN" />;

  return (
    <div className="space-y-8">
      <ProfileSection title="Personal" editHref={editLink(p, 'personal')}>
        <FieldGrid
          fields={[
            { key: 'fullNameEn', label: 'Full name (English)', value: p.fullNameEn, required: true },
            { key: 'fullNameAr', label: 'Full name (Arabic)', value: p.fullNameAr, required: true, ar: true },
            { key: 'displayName', label: 'Display name', value: p.displayName, required: true },
            { key: 'employeeCode', label: 'Employee code', value: number(p.employeeCode) },
            {
              key: 'insuranceNo',
              label: 'Social insurance number',
              value: p.insuranceNo && number(p.insuranceNo),
              // needed once insured, i.e. hired full time (Form 1)
              required: p.employment?.employmentType === 'full_time',
            },
            { key: 'dateOfBirth', label: 'Date of birth', value: formatDate(p.dateOfBirth), required: true },
            { key: 'gender', label: 'Gender', value: p.gender && LABELS.gender[p.gender], required: true },
            { key: 'nationality', label: 'Nationality', value: p.nationality, required: true },
            { key: 'maritalStatus', label: 'Marital status', value: p.maritalStatus && LABELS.maritalStatus[p.maritalStatus], required: true },
            {
              key: 'militaryStatus',
              label: 'Military status',
              // military service does not apply to women, whatever was recorded before
              value: p.gender === 'female' ? LABELS.militaryStatus.not_applicable : p.militaryStatus && LABELS.militaryStatus[p.militaryStatus],
              required: true,
            },
          ]}
        />
      </ProfileSection>

      <ProfileSection title="Contact & Address" editHref={editLink(p, 'personal')}>
        <FieldGrid
          fields={[
            {
              key: 'workEmail',
              label: 'Work email',
              value: p.workEmail && <a href={`mailto:${p.workEmail}`}>{p.workEmail}</a>,
              // needed while employed
              required: Boolean(p.employment),
            },
            {
              key: 'personalEmail',
              label: 'Personal email',
              value: p.personalEmail && <a href={`mailto:${p.personalEmail}`}>{p.personalEmail}</a>,
              required: true,
            },
            { key: 'mobile', label: 'Mobile', value: number(p.mobile), required: true },
            { key: 'mobile2', label: 'Second mobile', value: number(p.mobile2) },
            { key: 'governorate', label: 'Governorate', value: p.governorate, required: true },
            { key: 'city', label: 'City', value: p.city, required: true, ar: true },
            { key: 'addressAr', label: 'Address (Arabic)', value: p.addressAr, required: true, ar: true },
          ]}
        />
      </ProfileSection>

      {/* not counted in the profile's completeness (owner's decision, 15 October 2026), nor is the second mobile */}
      <ProfileSection title="Emergency Contact" editHref={editLink(p, 'personal')}>
        <FieldGrid
          fields={[
            { key: 'emergencyName', label: 'Name', value: p.emergencyName },
            { key: 'emergencyRelation', label: 'Relation', value: p.emergencyRelation },
            { key: 'emergencyMobile', label: 'Mobile', value: number(p.emergencyMobile) },
          ]}
        />
      </ProfileSection>

      {p.access.identity && (
        <ProfileSection title="National ID" restricted editHref={editLink(p, 'national-id')}>
          <FieldGrid
            fields={[
              {
                key: 'nationalId',
                label: 'National ID number',
                value: idNumber && (
                  <>
                    {number(idNumber)}
                    {revealId}
                  </>
                ),
                required: true,
                protected: true,
                note: idNumber && recorded,
              },
              {
                key: 'printedNo',
                label: 'Printed number',
                value: printedNo && (
                  <>
                    {number(printedNo)}
                    {!idNumber && revealId}
                  </>
                ),
                required: true,
                protected: true,
                note: !idNumber && printedNo && recorded,
              },
              { key: 'idIssueDate', label: 'Issue date', value: formatDate(p.identity?.issueDate), required: true },
              {
                key: 'idExpiry',
                label: 'Expiry date',
                value: p.identity?.expiryDate && (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {formatDate(p.identity.expiryDate)}
                    <ExpiryChip expiry={p.identity.expiryDate} today={today} />
                  </span>
                ),
                required: true,
              },
            ]}
          />
        </ProfileSection>
      )}

      {p.access.bank && (
        <ProfileSection title="Bank & Payment" restricted editHref={editLink(p, 'bank')}>
          <FieldGrid
            fields={[
              { key: 'bankName', label: 'Bank', value: bankShown(p.bank?.bankName), required: true },
              { key: 'bankBic', label: 'SWIFT/BIC', value: bankNamed(p.bank?.bankName)?.bic },
              {
                key: 'accountNo',
                label: 'Account number',
                value: accountNo && (
                  <>
                    {number(accountNo)}
                    {revealBank}
                  </>
                ),
                required: true,
                protected: true,
                note: accountNo && recorded,
              },
              {
                key: 'iban',
                label: 'IBAN',
                value: iban && (
                  <>
                    {number(iban)}
                    {!accountNo && revealBank}
                  </>
                ),
                required: true,
                protected: true,
                note: !accountNo && iban && recorded,
              },
              { key: 'holderName', label: 'Account holder', value: p.bank?.holderName, required: true },
            ]}
          />
        </ProfileSection>
      )}

      {/* HR and Admin. The API refuses (409) while this person is anyone's manager on record; the form shows its reason. */}
      {p.access.delete && (
        <section className="card space-y-3 p-6">
          <h2 className="font-semibold">Delete Profile</h2>
          <p className="text-sm text-muted">
            Only for a profile added by mistake. When someone leaves, end their employment on the Employment tab instead: the profile and their
            employment history are kept, and they are listed as a former employee.
          </p>
          <DeleteForm
            action={deleteEmployee.bind(null, p.id)}
            confirmText={`Delete ${p.fullNameEn} (${p.employeeCode}) with their national ID, bank details, employment history and employee file? This cannot be undone.`}
            label="Delete profile"
          />
        </section>
      )}
    </div>
  );
}

/** Education: what the profile records of the employee's studies. Changed on the Personal Details page. */
export function EducationTab({ profile: p }: { profile: EmployeeProfile }) {
  // university, faculty and major are not asked of a high-school degree
  const studied = p.degree !== 'high_school';
  return (
    <ProfileSection title="Education" editHref={editLink(p, 'education')}>
      <FieldGrid
        fields={[
          { key: 'university', label: 'University', value: p.university, required: studied },
          { key: 'faculty', label: 'Faculty', value: p.faculty, required: studied },
          { key: 'degree', label: 'Degree', value: p.degree && LABELS.degree[p.degree], required: true },
          { key: 'major', label: 'Major', value: p.major, required: studied },
          { key: 'graduationYear', label: 'Graduation year', value: p.graduationYear && String(p.graduationYear), required: true },
          { key: 'educationGrade', label: 'Grade', value: p.educationGrade && LABELS.educationGrade[p.educationGrade], required: true },
          { key: 'qualificationAr', label: 'Qualification (Arabic)', value: p.qualificationAr, required: true, ar: true },
        ]}
      />
    </ProfileSection>
  );
}
