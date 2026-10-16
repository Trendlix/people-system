import { lawRatesFor } from '@trendlix/shared';
import { loadLawRateViews } from '@/lib/law-rates';
import type { SessionUser } from '@/lib/types';
import { todayInCairo } from '../../employees/ui';
import { changesLawRates, seesLawRates } from './law-rates';
import { LawRatesEditor } from './law-rates-editor';
import { LawRatesTable } from './law-rates-table';
import { NotLoaded, SetupSection } from './section';

// Payroll Setup, 2 Rates Set by Law (owner's request, 16 October 2026: "creating a setup page for payroll to enter the
// variables that might affect the sheet", the tax brackets "editable by superadmin, to modify it if the law changed"):
// by year, the social insurance shares and the insurable wage's limits, the personal exemption, the Martyrs' Fund,
// health insurance and the salary tax's tiers and bands (GET /payroll/law-rates). HR, Finance, the CEO and Admin read
// them; the Super Admin adds, changes and deletes years (PUT and DELETE /payroll/law-rates/:year; the API checks this
// again). A payroll run keeps a copy of the year's rates it is worked out with.

const INTRO =
  'The rates the law sets, by the year they apply from: a year without its own uses the latest earlier one. Payroll, the contract and offer forms and the salary calculator work the pay out with them; only the Super Admin changes them. Runs made from now on use their year’s rates, and a draft run takes changed rates when it is refreshed; approved runs keep the rates they were worked out with.';

export async function LawRatesSection({ user }: { user: SessionUser }) {
  if (!seesLawRates(user)) return null;
  const loaded = await loadLawRateViews();
  const thisYear = Number(todayInCairo().slice(0, 4));

  let body: React.ReactNode;
  if (loaded.kind === 'unavailable' || loaded.kind === 'failed') {
    body = <NotLoaded what="the rates set by law" loaded={loaded} />;
  } else if (loaded.kind === 'forbidden') {
    body = <NotLoaded what="the rates set by law" loaded={{ kind: 'failed', message: 'Only HR, Finance, the CEO and Admin can see them.' }} />;
  } else {
    const { views } = loaded;
    // the year whose rates apply today: this year's, else the latest earlier one's
    const currentYear = views.length ? lawRatesFor(thisYear, views).year : null;
    body = changesLawRates(user) ? (
      <LawRatesEditor views={views} currentYear={currentYear} thisYear={thisYear} />
    ) : views.length ? (
      <LawRatesTable views={views} currentYear={currentYear} />
    ) : (
      <p className="text-sm text-muted">No years are kept yet.</p>
    );
  }

  return (
    <SetupSection id="law-rates" title="Rates Set by Law" intro={INTRO}>
      {body}
    </SetupSection>
  );
}
