import { changesOf, changeText, employeeOf, entryView, idsIn, linkOf, recordKey, referenceOf, shownMoment, valueText, whoOf, type AuditRefs, type AuditRow } from './audit-view.js';

// The Audit Log's entries in words (owner, 19 October 2026: "an Audit Log page showing who changed what and when").

const MONA = { id: '0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e', employeeCode: 'EMP-0007', fullNameEn: 'Mona Hassan' };
const AHMED = { id: '1c9f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5f', employeeCode: 'EMP-0008', fullNameEn: 'Ahmed Ali' };
const HR_USER = { id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'mona@trendlix.com', name: 'Mona Hassan' };
const SUPER = { id: 'aaaaaaaa-0000-4000-8000-000000000002', email: 'hazem@trendlix.com', name: 'Hazem Magdy' };
const BARE = { id: 'aaaaaaaa-0000-4000-8000-000000000003', email: 'finance@trendlix.com', name: null };
const EMPLOYMENT = 'bbbbbbbb-0000-4000-8000-000000000001';
const CONTRACT = 'bbbbbbbb-0000-4000-8000-000000000002';
const RUN = 'bbbbbbbb-0000-4000-8000-000000000003';
const LINE = 'bbbbbbbb-0000-4000-8000-000000000004';
const DEPT = 'bbbbbbbb-0000-4000-8000-000000000005';
const GONE = 'bbbbbbbb-0000-4000-8000-000000000099';

function refs(more: Partial<AuditRefs> = {}): AuditRefs {
  return {
    users: new Map([HR_USER, SUPER, BARE].map((u) => [u.id, u])),
    employees: new Map([MONA, AHMED].map((e) => [e.id, e])),
    employeesByCode: new Map([MONA, AHMED].map((e) => [e.employeeCode, e])),
    records: new Map([
      [recordKey('employment', EMPLOYMENT), { employeeId: MONA.id }],
      [recordKey('contract', CONTRACT), { employeeId: MONA.id, reference: 'CON-2026-0007' }],
      [recordKey('payroll_run', RUN), { reference: 'October 2026' }],
      [recordKey('payroll_line', LINE), { employeeId: AHMED.id, runId: RUN, reference: 'October 2026' }],
      [recordKey('department', DEPT), { reference: 'Engineering' }],
    ]),
    names: new Map([
      [MONA.id, 'Mona Hassan (EMP-0007)'],
      [AHMED.id, 'Ahmed Ali (EMP-0008)'],
      [DEPT, 'Engineering'],
    ]),
    ...more,
  };
}

const row = (r: Partial<AuditRow>): AuditRow => ({
  id: 41n,
  userId: HR_USER.id,
  onBehalfById: null,
  action: 'update',
  entityType: 'employee',
  entityId: MONA.id,
  diff: null,
  at: new Date('2026-10-19T14:42:00.000Z'),
  ...r,
});

describe('who did it', () => {
  it('names the user by their employee profile, else their email', () => {
    expect(whoOf(row({}), refs().users).text).toBe('Mona Hassan');
    expect(whoOf(row({ userId: BARE.id }), refs().users).text).toBe('finance@trendlix.com');
  });

  it('says "Super Admin X as Y" for what a Super Admin did viewing as someone', () => {
    const who = whoOf(row({ onBehalfById: SUPER.id }), refs().users);
    expect(who.text).toBe('Super Admin Hazem Magdy as Mona Hassan');
    expect(who.by?.email).toBe('hazem@trendlix.com');
    expect(who.user?.email).toBe('mona@trendlix.com');
  });

  it('says "Y via Claude connector" for what the user’s Claude did through the connector (21 October 2026)', () => {
    const who = whoOf(row({ via: 'claude_connector' }), refs().users);
    expect(who.text).toBe('Mona Hassan via Claude connector');
    expect(who.via).toBe('claude_connector');
    expect(whoOf(row({}), refs().users).via).toBeNull();
    // anything else the column might hold is not shown as the connector
    expect(whoOf(row({ via: 'something' }), refs().users).text).toBe('Mona Hassan');
  });

  it('says who it was when nobody signed in did it', () => {
    expect(whoOf(row({ userId: null }), refs().users).text).toBe('System');
    expect(whoOf(row({ userId: null, action: 'login_failed', entityType: 'user' }), refs().users).text).toBe('Not signed in');
    expect(whoOf(row({ userId: null, action: 'answer', entityType: 'job_offer' }), refs().users).text).toBe('The candidate, online');
  });
});

describe('the moment', () => {
  it('is Cairo time, DD/MM/YYYY and 12-hour', () => {
    // 14:42 UTC is 5:42 PM in Cairo in summer time (UTC+3)
    expect(shownMoment(new Date('2026-10-19T14:42:00.000Z'))).toBe('19/10/2026, 5:42 PM');
    // and 2 hours ahead in winter (UTC+2): just after midnight
    expect(shownMoment(new Date('2026-12-31T22:05:00.000Z'))).toBe('01/01/2027, 12:05 AM');
  });
});

describe('what changed', () => {
  it('shows each { from, to } as a change, dates as DD/MM/YYYY, yes or no, months by name', () => {
    const changes = changesOf({
      status: { from: 'draft', to: 'sent' },
      joinDate: { from: '2026-01-01', to: '2026-02-15' },
      remote: { from: false, to: true },
      month: '2026-10',
      reason: null,
    });
    expect(changes.map(changeText)).toEqual([
      'Status: draft → sent',
      'Join date: 01/01/2026 → 15/02/2026',
      'Remote: No → Yes',
      'Month: October 2026',
      'Reason: —',
    ]);
    expect(changes[0]).toEqual({ field: 'status', label: 'Status', kind: 'change', from: 'draft', to: 'sent', masked: null });
  });

  it('keeps a restricted value masked: changed or set, never a value', () => {
    const changes = changesOf({ employeeCode: 'EMP-0007', grossSalary: 'changed', amount: 'set', bank: { accountNo: 'changed', bankName: { from: 'CIB', to: 'NBE' } } });
    expect(changes.find((c) => c.field === 'grossSalary')).toEqual({ field: 'grossSalary', label: 'Gross salary', kind: 'change', from: null, to: null, masked: 'changed' });
    expect(changes.find((c) => c.field === 'amount')).toMatchObject({ kind: 'value', from: null, to: null, masked: 'set' });
    expect(changes.find((c) => c.field === 'bank.accountNo')).toMatchObject({ label: 'Bank · Account number', from: null, to: null, masked: 'changed' });
    expect(changes.map(changeText)).toEqual([
      'Employee code: EMP-0007',
      'Gross salary: changed (not shown)',
      'Amount: set (not shown)',
      'Bank · Account number: changed (not shown)',
      'Bank · Bank name: CIB → NBE',
    ]);
  });

  it('names the ids it knows, and lists arrays', () => {
    const changes = changesOf({ managerId: { from: AHMED.id, to: MONA.id }, departmentId: DEPT, fields: ['accountNo', 'iban'], tags: [] }, refs().names);
    expect(changes.map(changeText)).toEqual([
      'Direct manager: Ahmed Ali (EMP-0008) → Mona Hassan (EMP-0007)',
      'Department: Engineering',
      'Fields: accountNo, iban',
      'Tags: None',
    ]);
  });

  it('reads moments in Cairo and cuts long text', () => {
    expect(valueText('2026-10-19T14:42:00.000Z')).toBe('19/10/2026, 5:42 PM');
    expect(valueText('x'.repeat(400))).toHaveLength(301);
    expect(valueText(GONE)).toBe(GONE);
  });

  it('has nothing to show for an entry without a diff', () => {
    expect(changesOf(null)).toEqual([]);
    expect(changesOf(undefined)).toEqual([]);
  });

  it('collects the ids a diff holds, at any depth', () => {
    expect([...idsIn({ a: MONA.id, b: { c: [DEPT.toUpperCase()] }, d: 'not an id' })]).toEqual([MONA.id, DEPT]);
  });
});

describe('whom it is about', () => {
  it('is the employee it is on, or the owner of the record it is on', () => {
    expect(employeeOf(row({}), refs())?.fullNameEn).toBe('Mona Hassan');
    expect(employeeOf(row({ entityType: 'contract', entityId: CONTRACT }), refs())?.id).toBe(MONA.id);
    expect(employeeOf(row({ entityType: 'payroll_line', entityId: LINE }), refs())?.id).toBe(AHMED.id);
  });

  it('is the person its diff names when the record is gone', () => {
    expect(employeeOf(row({ entityType: 'contract', entityId: GONE, diff: { employmentId: EMPLOYMENT } }), refs())?.id).toBe(MONA.id);
    expect(employeeOf(row({ entityType: 'generated_document', entityId: GONE, diff: { employeeId: AHMED.id } }), refs())?.id).toBe(AHMED.id);
    // never by the code alone: a deleted person's code is given to the next one hired (19 October 2026)
    expect(employeeOf(row({ entityType: 'payroll_line', entityId: GONE, diff: { employeeCode: 'EMP-0008' } }), refs())).toBeNull();
    expect(employeeOf(row({ entityType: 'department', entityId: DEPT, diff: { nameEn: 'Engineering' } }), refs())).toBeNull();
  });
});

describe('the record in words', () => {
  it('is its own words from the database, else from its diff', () => {
    expect(referenceOf(row({ entityType: 'contract', entityId: CONTRACT }), refs(), null)).toBe('CON-2026-0007');
    expect(referenceOf(row({ entityType: 'contract', entityId: GONE, diff: { number: 'CON-2026-0001' } }), refs(), null)).toBe('CON-2026-0001');
    expect(referenceOf(row({ entityType: 'department', entityId: GONE, diff: { nameEn: { from: 'Eng', to: 'Engineering' } } }), refs(), null)).toBe('Engineering');
    expect(referenceOf(row({ entityType: 'payroll_adjustment', entityId: GONE, diff: { month: '2026-10', amount: 'set' } }), refs(), null)).toBe('October 2026');
  });

  it('leaves the person out of an entry on their own profile: they are shown apart', () => {
    expect(referenceOf(row({ diff: { fullNameEn: 'Mona Hassan' } }), refs(), MONA)).toBeNull();
    // a profile deleted since: its diff names it
    expect(referenceOf(row({ entityId: GONE, action: 'delete', diff: { employeeCode: 'EMP-0100', fullNameEn: 'Gone Person' } }), refs(), null)).toBe('Gone Person');
  });
});

describe('where the record is', () => {
  const ceo = ['ceo'] as const;
  const superAdmin = ['super_admin'] as const;

  it('links the CEO to a profile, a contract, a payroll run and its line', () => {
    expect(linkOf(row({}), refs(), MONA, ceo)).toEqual({ href: `/employees/${MONA.id}`, label: 'Open profile' });
    expect(linkOf(row({ entityType: 'contract', entityId: CONTRACT }), refs(), MONA, ceo)?.href).toBe(`/employees/${MONA.id}?tab=employment#contract`);
    expect(linkOf(row({ entityType: 'payroll_run', entityId: RUN }), refs(), null, ceo)?.href).toBe(`/payroll/${RUN}`);
    expect(linkOf(row({ entityType: 'payroll_line', entityId: LINE }), refs(), AHMED, ceo)?.href).toBe(`/payroll/${RUN}`);
    expect(linkOf(row({ entityType: 'raise_request', entityId: GONE, diff: { employeeId: MONA.id } }), refs(), MONA, ceo)?.href).toBe(
      `/employees/${MONA.id}?tab=employment&sub=salary#raise-requests`,
    );
  });

  it('links only to pages the caller can open', () => {
    // a Super Admin as such sees no one else's profile and no payroll, but the user accounts and the templates
    expect(linkOf(row({}), refs(), MONA, superAdmin)).toBeNull();
    expect(linkOf(row({ entityType: 'payroll_run', entityId: RUN }), refs(), null, superAdmin)).toBeNull();
    const user = row({ entityType: 'user', entityId: HR_USER.id });
    const withUser = refs({ records: new Map([[recordKey('user', HR_USER.id), { reference: HR_USER.email }]]) });
    expect(linkOf(user, withUser, null, superAdmin)?.href).toBe(`/users/${HR_USER.id}`);
    expect(linkOf(user, withUser, null, ceo)).toBeNull();
    const template = row({ entityType: 'template_version', entityId: GONE });
    const withTemplate = refs({ records: new Map([[recordKey('template_version', GONE), { slot: 'contract_full_time' }]]) });
    expect(linkOf(template, withTemplate, null, superAdmin)?.href).toBe('/organization/templates/contract_full_time');
    expect(linkOf(template, withTemplate, null, ceo)).toBeNull();
    // the organisation's pages, for both
    expect(linkOf(row({ entityType: 'department', entityId: DEPT }), refs(), null, superAdmin)?.href).toBe(`/organization/departments/${DEPT}`);
  });

  it('links the KPI settings to the page each was changed on: Attendance in the KPI to KPI Pillars, the deadlines to theirs', () => {
    // owner, 25 October 2026: "Fixed cut only", the switch on KPI Pillars
    const switched = row({ entityType: 'kpi_settings', entityId: null, diff: { attendanceInKpi: { from: true, to: false }, rescored: 2 } });
    expect(linkOf(switched, refs(), null, ceo)).toEqual({ href: '/organization/kpi-pillars', label: 'Open KPI pillars' });
    const days = row({ entityType: 'kpi_settings', entityId: null, diff: { signOffDay: { from: 10, to: 12 } } });
    expect(linkOf(days, refs(), null, ceo)).toEqual({ href: '/organization/kpi-deadlines', label: 'Open KPI deadlines' });
  });

  it('has no link to a record deleted since', () => {
    expect(linkOf(row({ entityType: 'payroll_run', entityId: GONE, action: 'delete' }), refs(), null, ceo)).toBeNull();
    expect(linkOf(row({ entityType: 'department', entityId: GONE, action: 'delete' }), refs(), null, ceo)).toBeNull();
    expect(linkOf(row({ entityType: 'employee', entityId: GONE, action: 'delete' }), refs(), null, ceo)).toBeNull();
  });
});

describe('an entry for reading', () => {
  it('has who, when, what, on what with its link, and the changes', () => {
    const view = entryView(
      row({ entityType: 'contract', entityId: CONTRACT, onBehalfById: SUPER.id, diff: { employmentId: EMPLOYMENT, number: 'CON-2026-0007', grossSalary: 'changed' } }),
      refs(),
      ['ceo'],
    );
    expect(view).toMatchObject({
      id: '41',
      at: '2026-10-19T14:42:00.000Z',
      when: '19/10/2026, 5:42 PM',
      who: { text: 'Super Admin Hazem Magdy as Mona Hassan' },
      action: 'update',
      actionLabel: 'Updated',
      entityType: 'contract',
      entityLabel: 'Contract',
      entityId: CONTRACT,
      reference: 'CON-2026-0007',
      employee: MONA,
      link: { href: `/employees/${MONA.id}?tab=employment#contract`, label: 'Open contract' },
    });
    expect(view.changes.find((c) => c.field === 'grossSalary')?.masked).toBe('changed');
  });
});
