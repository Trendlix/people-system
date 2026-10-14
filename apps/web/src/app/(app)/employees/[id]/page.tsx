import { Suspense } from 'react';
import { formatDate, formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { loadEmployee } from '../data';
import { BackLink, Loading, PROFILE_TABS, profileHref, seesEveryone, todayInCairo, type ProfileTabKey } from '../ui';
import { BasicTab, EducationTab } from './details-tabs';
import { EmployeeFile, EmployeeFileLoading } from './employee-file';
import { EmploymentTab } from './employment-tab';
import { ProfileHeader } from './profile-header';
import { ProfileTabs } from './profile-tabs';

// An employee's profile (after Prime ERP's owner profile): who they are and how complete the profile is above the tabs
// Basic Data, Education, Employment and Documents. The open tab is in the address (?tab=), so it survives a reload, and
// only it is rendered. The profile and the employment are separate records: someone who leaves keeps their profile.

type Query = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

async function Profile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const [user, p, query] = await Promise.all([getCurrentUser(), loadEmployee(params), searchParams]);
  const today = todayInCairo();
  // The employee file is HR's and the CEO's, exactly those who may see the national ID.
  const tabs = PROFILE_TABS.filter((t) => t.key !== 'documents' || p.access.identity);
  const visible = new Set<ProfileTabKey>(tabs.map((t) => t.key));
  const asked = one(query.tab) as ProfileTabKey;
  const tab: ProfileTabKey = visible.has(asked) ? asked : 'basic';
  // Only people who can open every profile get links to others (e.g. the manager); others may not be allowed to see them.
  const linkPeople = seesEveryone(user);

  return (
    <div className="space-y-6">
      <ProfileHeader profile={p} tabs={visible} linkPeople={linkPeople} />

      <ProfileTabs tabs={tabs.map((t) => ({ key: t.key, label: t.label, href: profileHref(p.id, t.key) }))} active={tab} label={`Profile of ${p.fullNameEn}`}>
        {tab === 'education' ? (
          <EducationTab profile={p} />
        ) : tab === 'employment' ? (
          <EmploymentTab profile={p} linkPeople={linkPeople} justAdded={one(query.added) === '1'} />
        ) : tab === 'documents' ? (
          // loads on its own, so a slow file list doesn't hold up the profile
          <Suspense fallback={<EmployeeFileLoading />}>
            <EmployeeFile employee={p} today={today} />
          </Suspense>
        ) : (
          <BasicTab profile={p} show={one(query.show)} today={today} />
        )}
      </ProfileTabs>

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
