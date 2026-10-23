import { getRedirectUrl, unstable_getResponseFromNextConfig } from 'next/experimental/testing/server';
import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';
import { MOVED_PAGES, movedPagesRedirects, movedTo } from './moved-pages';

// The pages brought into Organization (owner, 23 October 2026: "Check-in Setup, KPI Pillars and deadlines, Recruitment
// and checklists, Templates", "with their old links redirecting"): every old address, and every page under it, goes
// permanently to the same place under the new one, the query kept. Checked against next.config.ts itself.

const SITE = 'https://people.trendlix.com';
const ID = '0b8f2c1e-1111-4222-8333-444455556666';

/** Where next.config.ts sends this address: [status, new address]; [200, null] when it isn't redirected. */
async function redirected(path: string): Promise<[number, string | null]> {
  const response = await unstable_getResponseFromNextConfig({ url: `${SITE}${path}`, nextConfig });
  const to = getRedirectUrl(response);
  return [response.status, to ? to.replace(SITE, '') : null];
}

describe('the moved pages', () => {
  it('are the six the owner brought in, each now under /organization', () => {
    expect(MOVED_PAGES.map((m) => [m.from, m.to])).toEqual([
      ['/templates', '/organization/templates'],
      ['/attendance/check-in-setup', '/organization/check-in-setup'],
      ['/kpis/pillars', '/organization/kpi-pillars'],
      ['/recruitment/settings', '/organization/recruitment'],
      ['/onboarding/checklist', '/organization/onboarding-checklist'],
      ['/offboarding/checklist', '/organization/clearance-checklist'],
    ]);
    expect(movedPagesRedirects()).toHaveLength(MOVED_PAGES.length);
  });

  it('knows where each old address is now, and leaves the others', () => {
    expect(movedTo('/templates')).toBe('/organization/templates');
    expect(movedTo('/templates/nda')).toBe('/organization/templates/nda');
    expect(movedTo(`/kpis/pillars/${ID}`)).toBe(`/organization/kpi-pillars/${ID}`);
    for (const path of ['/templatesx', '/kpis/templates', '/kpis', '/recruitment', '/recruitment/settingsx', '/onboarding', '/offboarding', `/onboarding/${ID}`, '/attendance']) {
      expect(movedTo(path)).toBeNull();
    }
  });
});

describe('next.config.ts redirects', () => {
  const MAP: [string, string][] = [
    ['/templates', '/organization/templates'],
    ['/templates/tags', '/organization/templates/tags'],
    ['/templates/nda', '/organization/templates/nda'],
    [`/templates/insurance_form_1/versions/${ID}/fields`, `/organization/templates/insurance_form_1/versions/${ID}/fields`],
    [`/templates/versions/${ID}/file?format=pdf`, `/organization/templates/versions/${ID}/file?format=pdf`],
    [`/templates/versions/${ID}/preview?employeeId=${ID}&download=1`, `/organization/templates/versions/${ID}/preview?employeeId=${ID}&download=1`],
    ['/templates/fields-guide?format=pdf', '/organization/templates/fields-guide?format=pdf'],
    ['/attendance/check-in-setup', '/organization/check-in-setup'],
    ['/kpis/pillars', '/organization/kpi-pillars'],
    [`/kpis/pillars/${ID}`, `/organization/kpi-pillars/${ID}`],
    ['/recruitment/settings', '/organization/recruitment'],
    ['/onboarding/checklist', '/organization/onboarding-checklist'],
    ['/onboarding/checklist?saved=1', '/organization/onboarding-checklist?saved=1'],
    ['/offboarding/checklist', '/organization/clearance-checklist'],
    ['/offboarding/checklist?saved=1', '/organization/clearance-checklist?saved=1'],
  ];

  it('sends every old address permanently to its new one, with what follows and the query', async () => {
    for (const [from, to] of MAP) expect([from, ...(await redirected(from))]).toEqual([from, 308, to]);
  });

  it('leaves the pages that stayed, and the new ones, alone', async () => {
    for (const path of ['/kpis/templates', '/kpis', '/recruitment/vacancies', '/onboarding', `/onboarding/${ID}`, '/offboarding', '/attendance', '/organization/templates', '/organization/kpi-pillars']) {
      expect([path, ...(await redirected(path))]).toEqual([path, 200, null]);
    }
  });

  it('keeps the older redirects working', async () => {
    expect(await redirected('/organisation/company')).toEqual([308, '/organization/company']);
    expect(await redirected('/employees/raises')).toEqual([308, '/payroll/reports/salary-raises']);
  });
});
