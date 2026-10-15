import { employmentView } from './employees.service.js';

// The employee profile's employment as the API sends it: here, its job title, which no longer carries the social
// insurance occupation (owner's decision, 16 October 2026: the employee's own, on the Social Insurance tab).

type Row = Parameters<typeof employmentView>[0];

const CONTEXT = { seesSalary: true, seesEndings: true, nonRenewal: null };

function row(jobTitle: object | null): Row {
  return {
    id: 'emp-1',
    employeeId: 'e-1',
    employmentType: 'full_time',
    status: 'active',
    joinDate: new Date('2026-01-15T00:00:00.000Z'),
    probationEnd: null,
    jdAcknowledgedAt: null,
    endDate: null,
    officeDays: [],
    shift: null,
    contracts: [],
    endings: [],
    jobTitle,
  } as unknown as Row;
}

describe('a profile’s employment', () => {
  it('names its job title as it is, with no occupation of its own', () => {
    const job = { id: 'j1', titleEn: 'Sales Manager', titleAr: 'مدير مبيعات', jdVersion: 2 };
    const view = employmentView(row(job), CONTEXT);
    expect(view.jobTitle).toEqual(job);
    expect(view.joinDate).toBe('2026-01-15');
  });

  it('an employment without a job title stays without', () => {
    expect(employmentView(row(null), CONTEXT).jobTitle).toBeNull();
  });
});
