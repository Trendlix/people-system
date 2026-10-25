import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { seesEmailSettings } from '../../../lib/email-setup';
import { seesCalendarSettings } from '../../../lib/calendars';
import { seesMeetingSettings } from '../../../lib/meetings';
import { seesWhatsAppSettings } from '../../../lib/whatsapp';
import { isSelfService } from '../../../lib/roles';
import { buildsKpiTemplates } from '../kpis/templates/templates';
import { managesOffboarding } from '../offboarding/offboarding';
import { managesOnboarding } from '../onboarding/onboarding';
import { readsRecruitment } from '../recruitment/recruitment';
import { seesCheckInSetup } from './check-in-setup/setup';
import { firstSetupPage, SETUP_GROUPS, SETUP_PATHS, seesSetupPage, setupGroupsFor, setupPage, type SetupKey, type SetupViewer } from './setup-pages';
import { seesTemplates } from './templates/wording';

// Organization's setup menu (owner, 23 October 2026: "lets perform a regorganization of this menu. we can perform
// groupings to related items"; "Side menu with headings"; brought in: "Check-in Setup, KPI Pillars and deadlines,
// Recruitment and checklists, Templates"): its groups and pages, and who sees which.

const as = (...roles: Role[]): { roles: Role[] } => ({ roles });
/** What a user sees, as "Group: Page, Page". */
const menu = (user: SetupViewer | null) => setupGroupsFor(user).map((g) => `${g.label}: ${g.pages.map((p) => p.label).join(', ')}`);

const NINE = ['Company Details', 'Departments & Job Titles', 'Grades', 'Shifts', 'Holidays', 'Leave', 'Allowances', 'Contracts & Endings', 'Payroll Setup'];

describe('the setup menu', () => {
  it('has the six groups in the owner’s order, each with its pages', () => {
    expect(SETUP_GROUPS.map((g) => [g.label, g.pages.map((p) => [p.label, p.href])])).toEqual([
      [
        'Company',
        [
          ['Company Details', '/organization/company'],
          ['Email Settings', '/organization/email'],
          ['Meetings', '/organization/meetings'],
          ['Calendars', '/organization/calendars'],
          ['WhatsApp', '/organization/whatsapp'],
          ['Templates', '/organization/templates'],
        ],
      ],
      [
        'Structure',
        [
          ['Departments & Job Titles', '/organization/departments'],
          ['Grades', '/organization/grades'],
        ],
      ],
      [
        'Time & Leave',
        [
          ['Shifts', '/organization/shifts'],
          ['Holidays', '/organization/holidays'],
          ['Leave', '/organization/leave'],
          ['Check-in Setup', '/organization/check-in-setup'],
        ],
      ],
      [
        'Pay & Contracts',
        [
          ['Allowances', '/organization/allowances'],
          ['Contracts & Endings', '/organization/contracts'],
          ['Payroll Setup', '/organization/payroll'],
        ],
      ],
      [
        'Performance',
        [
          ['KPI Pillars', '/organization/kpi-pillars'],
          ['KPI Deadlines', '/organization/kpi-deadlines'],
        ],
      ],
      [
        'Hiring & Leaving',
        [
          ['Recruitment Settings', '/organization/recruitment'],
          ['Interview Hours', '/organization/interview-hours'],
          ['Onboarding Checklist', '/organization/onboarding-checklist'],
          ['Clearance Checklist', '/organization/clearance-checklist'],
        ],
      ],
    ]);
    // every page once, each under /organization, each key its own
    const pages = SETUP_GROUPS.flatMap((g) => g.pages);
    expect(new Set(pages.map((p) => p.key)).size).toBe(pages.length);
    expect(new Set(pages.map((p) => p.href)).size).toBe(pages.length);
    expect(pages.every((p) => p.href.startsWith('/organization/'))).toBe(true);
    expect(Object.values(SETUP_PATHS).sort()).toEqual(pages.map((p) => p.href).sort());
    expect(setupPage('kpi-deadlines' as SetupKey).label).toBe('KPI Deadlines');
  });

  it('shows a Super Admin every page, Email Settings, Meetings, Calendars, WhatsApp and Templates included', () => {
    expect(menu(as('super_admin'))).toEqual([
      'Company: Company Details, Email Settings, Meetings, Calendars, WhatsApp, Templates',
      'Structure: Departments & Job Titles, Grades',
      'Time & Leave: Shifts, Holidays, Leave, Check-in Setup',
      'Pay & Contracts: Allowances, Contracts & Endings, Payroll Setup',
      'Performance: KPI Pillars, KPI Deadlines',
      'Hiring & Leaving: Recruitment Settings, Interview Hours, Onboarding Checklist, Clearance Checklist',
    ]);
  });

  it('shows a developer a Super Admin’s pages but Email Settings, Meetings, Calendars and WhatsApp', () => {
    const developer = { roles: ['super_admin'] as Role[], developer: true };
    expect(menu(developer)[0]).toBe('Company: Company Details, Templates');
    expect(menu(developer).slice(1)).toEqual(menu(as('super_admin')).slice(1));
  });

  it('shows HR the nine, Check-in Setup, the KPI pages and Hiring & Leaving, not Email Settings or Templates', () => {
    expect(menu(as('hr'))).toEqual([
      'Company: Company Details',
      'Structure: Departments & Job Titles, Grades',
      'Time & Leave: Shifts, Holidays, Leave, Check-in Setup',
      'Pay & Contracts: Allowances, Contracts & Endings, Payroll Setup',
      'Performance: KPI Pillars, KPI Deadlines',
      'Hiring & Leaving: Recruitment Settings, Interview Hours, Onboarding Checklist, Clearance Checklist',
    ]);
  });

  it('shows the CEO the nine and Hiring & Leaving: no Check-in Setup, no Performance heading', () => {
    expect(menu(as('ceo'))).toEqual([
      'Company: Company Details',
      'Structure: Departments & Job Titles, Grades',
      'Time & Leave: Shifts, Holidays, Leave',
      'Pay & Contracts: Allowances, Contracts & Endings, Payroll Setup',
      'Hiring & Leaving: Recruitment Settings, Interview Hours, Onboarding Checklist, Clearance Checklist',
    ]);
  });

  it('shows Finance the nine alone', () => {
    expect(menu(as('finance'))).toEqual([
      'Company: Company Details',
      'Structure: Departments & Job Titles, Grades',
      'Time & Leave: Shifts, Holidays, Leave',
      'Pay & Contracts: Allowances, Contracts & Endings, Payroll Setup',
    ]);
  });

  it('shows an Admin the nine and Check-in Setup', () => {
    expect(menu(as('admin'))).toEqual([
      'Company: Company Details',
      'Structure: Departments & Job Titles, Grades',
      'Time & Leave: Shifts, Holidays, Leave, Check-in Setup',
      'Pay & Contracts: Allowances, Contracts & Endings, Payroll Setup',
    ]);
  });

  it('shows an employee or a manager nothing, and no heading', () => {
    for (const roles of [['employee'], ['manager'], ['employee', 'manager']] as Role[][]) {
      expect(setupGroupsFor(as(...roles))).toEqual([]);
      expect(firstSetupPage(as(...roles))).toBeNull();
    }
  });

  it('adds up the roles of someone holding several', () => {
    expect(menu(as('finance', 'ceo'))).toEqual(menu(as('ceo')));
    expect(menu(as('admin', 'hr'))).toEqual(menu(as('hr')));
    expect(menu(as('employee', 'manager', 'admin'))).toEqual(menu(as('admin')));
  });

  it('shows the pages everyone who had the tabs saw while who it is can’t be read', () => {
    expect(setupGroupsFor(null).flatMap((g) => g.pages.map((p) => p.label))).toEqual(NINE);
  });

  it('starts everyone who sees a page on Company Details', () => {
    for (const roles of [['hr'], ['finance'], ['ceo'], ['admin'], ['super_admin']] as Role[][]) expect(firstSetupPage(as(...roles))?.href).toBe('/organization/company');
  });
});

describe('each page keeps the roles it had', () => {
  const ROLES: Role[][] = [['employee'], ['manager'], ['hr'], ['finance'], ['ceo'], ['admin'], ['super_admin'], ['employee', 'manager'], ['admin', 'finance'], ['hr', 'ceo']];
  const sees = (key: SetupKey, user: SetupViewer) => seesSetupPage(user, setupPage(key));

  it('the nine tabs: everyone but an employee or a direct manager alone', () => {
    for (const roles of ROLES) {
      for (const key of ['company', 'departments', 'grades', 'shifts', 'holidays', 'leave', 'allowances', 'contracts', 'payroll'] as SetupKey[]) {
        expect(sees(key, as(...roles))).toBe(!isSelfService(as(...roles)));
      }
    }
  });

  it('Email Settings as lib/email-setup.ts, a developer never', () => {
    for (const roles of ROLES) expect(sees('email', as(...roles))).toBe(seesEmailSettings(as(...roles)));
    expect(sees('email', { roles: ['super_admin'], developer: true })).toBe(false);
  });

  // online interview meetings (owner, 24 October 2026: "make it both"): the company's, a Super Admin's
  it('Meetings as lib/meetings.ts, a developer never', () => {
    for (const roles of ROLES) expect(sees('meetings', as(...roles))).toBe(seesMeetingSettings(as(...roles)));
    expect(sees('meetings', { roles: ['super_admin'], developer: true })).toBe(false);
  });

  // the calendars read for busy times (owner, 25 October 2026: "its zoho mails"): the company's Zoho, a Super Admin's
  it('Calendars as lib/calendars.ts, a developer never', () => {
    for (const roles of ROLES) expect(sees('calendars', as(...roles))).toBe(seesCalendarSettings(as(...roles)));
    expect(sees('calendars', { roles: ['super_admin'], developer: true })).toBe(false);
  });

  // WhatsApp notifications (owner, 24 October 2026: "Directly to Meta"): the company's number and token, a Super Admin's
  it('WhatsApp as lib/whatsapp.ts, a developer never', () => {
    for (const roles of ROLES) expect(sees('whatsapp', as(...roles))).toBe(seesWhatsAppSettings(as(...roles)));
    expect(sees('whatsapp', { roles: ['super_admin'], developer: true })).toBe(false);
  });

  it('the pages brought in, as their own modules decide', () => {
    for (const roles of ROLES) {
      const user = as(...roles);
      expect(sees('templates', user)).toBe(seesTemplates(user));
      expect(sees('check-in-setup', user)).toBe(seesCheckInSetup(user));
      // KPI Pillars, and the deadlines from KPI Templates: as the sidebar showed them, HR and the Super Admin
      expect(sees('kpi-pillars', user)).toBe(buildsKpiTemplates(user));
      expect(sees('kpi-deadlines', user)).toBe(buildsKpiTemplates(user));
      expect(sees('recruitment', user)).toBe(readsRecruitment(user));
      // interviewers' hours (25 October 2026: "Hours + calendar"), as Recruitment Settings
      expect(sees('interview-hours', user)).toBe(readsRecruitment(user));
      expect(sees('onboarding-checklist', user)).toBe(managesOnboarding(user));
      expect(sees('clearance-checklist', user)).toBe(managesOffboarding(user));
    }
  });
});
