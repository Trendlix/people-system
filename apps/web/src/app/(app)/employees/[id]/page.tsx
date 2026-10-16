import { Suspense } from 'react';
import { formatDate, formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { decidesChangeRequests } from '../../approvals/data';
import { loadEmployee } from '../data';
import { askedTab, BackLink, Loading, PROFILE_TABS, profileHref, seesEveryone, todayInCairo, type ProfileTabKey } from '../ui';
import { BasicTab, EducationTab } from './details-tabs';
import { EmployeeFile, EmployeeFileLoading } from './employee-file';
import { EmploymentTab } from './employment-tab';
import { InsuranceTab } from './insurance/insurance-tab';
import { ProfileHeader } from './profile-header';
import { ProfileTabs } from './profile-tabs';

// An employee's profile (after Prime ERP's owner profile): who they are and how complete the profile is above the tabs
// Basic Data, Education, Employment, Social Insurance and Documents. Employment holds the job and everything the company
// issues for it (the Contracts tab was merged into it, owner's request, 16 October 2026), in sub-tabs (17 October
// 2026): Details (the job and its contract), Salary (the salary history, the raise requests, the pay received and the
// payslips) and Issued Documents (the documents generated from templates); Social Insurance, all the social insurance
// work (16 October 2026); Documents, the papers the employee brings. The open tab is in the address (?tab=, and &sub=
// for a sub-tab), so it survives a reload, and only it is rendered; an old ?tab=contracts address opens Employment,
// and a link naming only an anchor (#payslips) is moved to the sub-tab holding it. The profile and the employment are
// separate records: someone who leaves keeps their profile.

type Query = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

async function Profile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const [user, p, query] = await Promise.all([getCurrentUser(), loadEmployee(params), searchParams]);
  const today = todayInCairo();
  // The employee file is HR's and the CEO's, exactly those who may see the national ID. Social Insurance is everyone's
  // who sees Employment (everyone who sees the profile); what is restricted on it is left out or masked there.
  const tabs = PROFILE_TABS.filter((t) => t.key !== 'documents' || p.access.identity);
  const visible = new Set<ProfileTabKey>(tabs.map((t) => t.key));
  const asked = askedTab(one(query.tab));
  const tab: ProfileTabKey = asked && visible.has(asked) ? asked : 'basic';
  // Only people who can open every profile get links to others (e.g. the manager); others may not be allowed to see them.
  const linkPeople = seesEveryone(user);

  return (
    <div className="space-y-6">
      <ProfileHeader profile={p} tabs={visible} linkPeople={linkPeople} decidesRequests={decidesChangeRequests(user)} />

      <ProfileTabs tabs={tabs.map((t) => ({ key: t.key, label: t.label, href: profileHref(p.id, t.key) }))} active={tab} label={`Profile of ${p.fullNameEn}`}>
        {tab === 'education' ? (
          <EducationTab profile={p} />
        ) : tab === 'employment' ? (
          <EmploymentTab profile={p} linkPeople={linkPeople} sub={one(query.sub)} justAdded={one(query.added) === '1'} />
        ) : tab === 'insurance' ? (
          <InsuranceTab profile={p} />
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
