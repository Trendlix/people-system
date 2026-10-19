import Link from 'next/link';
import { Suspense } from 'react';
import { profileBack } from '@/components/nav';
import { decidesChangeOfDetails, isRestricted } from '@/lib/confidential';
import { formatDate, formatDateTime } from '@/lib/format';
import { hasRole } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { canSeeAuditLog, historyHref } from '../../audit/audit';
import { loadProfileOrCard } from '../data';
import { askedTab, BackLink, Loading, PROFILE_TABS, profileHref, seesEveryone, todayInCairo, type ProfileTabKey } from '../ui';
import { BasicTab, EducationTab } from './details-tabs';
import { EmployeeCardView } from './employee-card';
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
// separate records: someone who leaves keeps their profile. A C-level person (owner, 19 October 2026: "make C level
// Employees details not visible to HR") is their directory card alone for those who may not see them, with no tabs and
// no actions; the CEO, the Super Admin and the person themself get the profile, marked C-level, and the CEO or a Super
// Admin (not HR) decides their change requests.

type Query = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

async function Profile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const [user, p, query] = await Promise.all([getCurrentUser(), loadProfileOrCard(params), searchParams]);
  if (isRestricted(p)) {
    const back = profileBack(user, p);
    return (
      <div className="space-y-4">
        {back && <BackLink href={back.href}>{back.label}</BackLink>}
        <EmployeeCardView card={p} />
      </div>
    );
  }
  const today = todayInCairo();
  // The employee file is HR's and the CEO's, exactly those who may see the national ID. Social Insurance is HR's and
  // Admin's (owner, 17 October 2026: "Social Insurance tab to be by HR - Admin users"; a Super Admin counts as an Admin);
  // what is restricted on it (the wages) is still left out for those who don't see salaries.
  const tabs = PROFILE_TABS.filter((t) => (t.key !== 'documents' || p.access.identity) && (t.key !== 'insurance' || hasRole(user, 'hr', 'admin')));
  const visible = new Set<ProfileTabKey>(tabs.map((t) => t.key));
  const asked = askedTab(one(query.tab));
  const tab: ProfileTabKey = asked && visible.has(asked) ? asked : 'basic';
  // Only people who can open every profile get links to others (e.g. the manager); others may not be allowed to see them.
  const linkPeople = seesEveryone(user);
  // back to the Employees list; an employee's own profile is in their sidebar (My Profile), and a manager's direct
  // report's goes back to My Team (owner's decisions, 17 October 2026)
  const back = profileBack(user, p);
  // everything changed about them, in the Audit Log: the Super Admin's and the CEO's (owner, 19 October 2026: "an Audit
  // Log page showing who changed what and when")
  const history = canSeeAuditLog(user) ? historyHref(p.id) : null;

  return (
    <div className="space-y-4">
      {(back || history) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {back ? <BackLink href={back.href}>{back.label}</BackLink> : <span />}
          {history && (
            <Link href={history} prefetch={false} title={`Everything changed about ${p.fullNameEn}, in the Audit Log`} className="text-sm font-semibold">
              History
            </Link>
          )}
        </div>
      )}
      <div className="space-y-6">
        <ProfileHeader profile={p} tabs={visible} linkPeople={linkPeople} decidesRequests={decidesChangeOfDetails(user, p.confidential)} />

        <ProfileTabs tabs={tabs.map((t) => ({ key: t.key, label: t.label, href: profileHref(p.id, t.key) }))} active={tab} label={`Profile of ${p.fullNameEn}`}>
          {tab === 'employment' ? (
            <EmploymentTab profile={p} linkPeople={linkPeople} sub={one(query.sub)} justAdded={one(query.added) === '1'} leaveYear={one(query.leaveYear)} />
          ) : tab === 'insurance' ? (
            <InsuranceTab profile={p} />
          ) : tab === 'documents' ? (
            // loads on its own, so a slow file list doesn't hold up the profile
            <Suspense fallback={<EmployeeFileLoading />}>
              <EmployeeFile employee={p} today={today} />
            </Suspense>
          ) : (
            // Education under Basic Data's other sections (owner, 17 October 2026)
            <BasicTab profile={p} show={one(query.show)} today={today} education={<EducationTab profile={p} />} />
          )}
        </ProfileTabs>

        <p className="text-xs text-muted">
          Added {formatDate(p.createdAt)} · last updated {formatDateTime(p.updatedAt)}.
        </p>
      </div>
    </div>
  );
}

export default function EmployeePage({ params, searchParams }: PageProps<'/employees/[id]'>) {
  return (
    <Suspense fallback={<Loading />}>
      <Profile params={params} searchParams={searchParams} />
    </Suspense>
  );
}
