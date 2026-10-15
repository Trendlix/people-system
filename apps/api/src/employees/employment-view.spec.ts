import { employmentView } from './employees.service.js';

// The employee profile's employment as the API sends it: here, its job title with the social insurance occupation the
// Social Insurance tab shows (owner, 16 October 2026).

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
  it('names its job title’s occupation and the department the title is under', () => {
    const job = { id: 'j1', departmentId: 'd1', titleEn: 'Sales Manager', titleAr: 'مدير مبيعات', jdVersion: 2, occupationCode: '212300' };
    const view = employmentView(row(job), CONTEXT);
    expect(view.jobTitle).toEqual({ ...job, occupationName: 'مدير مبيعات' });
    expect(view.joinDate).toBe('2026-01-15');
  });

  it('a job title without an occupation has none, and an employment without a job title stays without', () => {
    const job = { id: 'j2', departmentId: 'd1', titleEn: 'Clerk', titleAr: null, jdVersion: 1, occupationCode: null };
    expect(employmentView(row(job), CONTEXT).jobTitle).toMatchObject({ occupationCode: null, occupationName: null });
    expect(employmentView(row(null), CONTEXT).jobTitle).toBeNull();
  });
});
