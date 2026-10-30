import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import { LEAVE_SETUP_HREF } from '../../../organization/leave/setup';
import { BackLink, Empty, Loading } from '../../../organization/ui';
import { notLoadedText } from '../../../payroll/load';
import { StaffOnly } from '../../../staff-only';
import { saveCompensatorySettings } from '../actions';
import { COMPENSATORY_PATH, compensatoryRulesOf, compensatoryWindowText, editsCompensatorySetup, seesAllCompensatory } from '../compensatory';
import { CompensatorySetupForm } from '../compensatory-forms';
import { loadCompensatorySettings } from '../data';

// The Compensatory Setup, under Attendance → Compensatory Days (owner, 27 October 2026: "i need a setup dashboard for the
// compensatory leaves", "minimum working hours"; asked which settings, he chose all four: "Minimum hours to qualify",
// "Hours for a full day", "Cash rate" (moved here from the Leave Setup) and "When the day off is taken"; and "up to 4
// hours to be compensated by hours - minimum 6 hours can be compensated by a day", between them "Capped at 4 hours"): the
// five numbers with a hint each, the window a choice (the same calendar month, or within N days after the day worked), and
// a table of what they give with the numbers as typed. HR changes them (PATCH /compensatory/settings, audited); the other
// staff read them, the fields off. Requests already made keep what they earned.

export const metadata: Metadata = { title: 'Compensatory Setup · People System' };

function Heading({ back }: { back: { href: string; label: string } | null }) {
  return (
    <div className="space-y-2">
      {back && <BackLink href={back.href}>{back.label}</BackLink>}
      <h1 className="page-title">Compensatory Setup</h1>
      <p className="max-w-3xl text-muted">
        What working a rest day or an official holiday earns: a whole day off, or for part of the day the same hours off on a working day, with no
        deduction; or, rarely, cash instead. The day off is taken in the window below.
      </p>
    </div>
  );
}

async function Setup() {
  const [user, loaded] = await Promise.all([getCurrentUser(), loadCompensatorySettings()]);
  // back to the requests for those who see them (HR and the CEO), else to the Leave Setup that points here
  const back = seesAllCompensatory(user) ? { href: COMPENSATORY_PATH, label: 'Compensatory Days' } : { href: `${LEAVE_SETUP_HREF}#compensatory-days`, label: 'Leave Setup' };
  let body: React.ReactNode;
  if (loaded.kind === 'unavailable') body = <Empty>Not available yet: the server does not have the Compensatory Setup yet.</Empty>;
  else if (loaded.kind === 'forbidden') body = <Empty>Only staff see the Compensatory Setup.</Empty>;
  else if (loaded.kind === 'failed') body = <Empty>{notLoadedText(loaded, 'Compensatory Setup')}</Empty>;
  else {
    const rules = compensatoryRulesOf(loaded.value);
    const edits = editsCompensatorySetup(user);
    body = (
      <section aria-labelledby="compensatory-rules-heading" className="card p-6">
        <h2 id="compensatory-rules-heading" className="text-lg font-semibold">
          The Rules
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          {edits
            ? 'Each request is checked against them when it is sent, recorded and decided; the employee’s form says live what their hours earn.'
            : `Only HR changes them. The day off is taken ${compensatoryWindowText(rules.offWithinDays)}.`}
        </p>
        <div className="mt-5">
          <CompensatorySetupForm action={saveCompensatorySettings} settings={rules} canEdit={edits} />
        </div>
      </section>
    );
  }
  return (
    <>
      <Heading back={back} />
      {body}
    </>
  );
}

export default function CompensatorySetupPage() {
  return (
    <StaffOnly>
      <div className="max-w-4xl space-y-6">
        <Suspense
          fallback={
            <>
              <Heading back={null} />
              <Loading />
            </>
          }
        >
          <Setup />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
