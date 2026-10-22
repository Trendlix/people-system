import {
  DEVELOPER_AGGREGATE_KEYS,
  DEVELOPER_COMPANY_PATHS,
  DEVELOPER_EMPLOYMENT_DATE_FIELDS,
  DEVELOPER_JOB_DATE_FIELDS,
  DEVELOPER_JOB_FLAG_FIELDS,
  DEVELOPER_JOB_ID_FIELDS,
  DEVELOPER_JOB_PARAMS,
  DEVELOPER_JOB_TAG_FIELDS,
  DEVELOPER_JOB_TEXT_FIELDS,
  DEVELOPER_NO_MATCH,
  developerPeople,
  developerQuery,
  HIDDEN,
  hideJobForDeveloper,
  isDeveloperCompanyPath,
  maskForDeveloper,
} from '@trendlix/shared';

// The Developer role sees no per-person employment or social insurance details (owner, 22 October 2026: "why is the
// employment data can be viewed by developer access"; chose "Hide per-person details", then "and the social
// insurance"): a job title, a department and a hire date can point to one real person in a small company, even under a
// pseudonym. On a page about people they are hidden; the company's setup pages stay readable, their people cut off;
// aggregates stay. Every name and place here is invented.

const OMAR = {
  id: '0e0e0e0e-1111-4222-8333-444455556666',
  employeeCode: 'EMP-0182',
  fullNameEn: 'Omar Khaled Mahmoud',
  fullNameAr: 'عمر خالد محمود',
  displayName: null,
  workEmail: 'omar@trendlix.test',
  personalEmail: null,
  emergencyName: null,
};
const people = developerPeople({ employees: [OMAR], users: [], applicants: [], offers: [] });
const DEPT = { id: '1d1d1d1d-1111-4222-8333-444455556666', nameEn: 'Production', nameAr: 'الإنتاج', parent: null };
const TEAM = { id: '2d2d2d2d-1111-4222-8333-444455556666', nameEn: 'Video Team', nameAr: null, parent: { id: DEPT.id, nameEn: 'Production', nameAr: 'الإنتاج' } };
const JOB = { id: '3d3d3d3d-1111-4222-8333-444455556666', titleEn: 'Video Editor', titleAr: 'محرر فيديو', jdVersion: 2 };
const GRADE = { id: '4d4d4d4d-1111-4222-8333-444455556666', code: 'G3', rank: 3, levelEn: 'Intermediate', levelAr: null };
const HIDDEN_TEAM = { id: null, nameEn: HIDDEN, nameAr: null, parent: { id: null, nameEn: HIDDEN, nameAr: HIDDEN } };
const HIDDEN_JOB = { id: null, titleEn: HIDDEN, titleAr: HIDDEN, jdVersion: null };
const HIDDEN_GRADE = { id: null, code: HIDDEN, rank: null, levelEn: HIDDEN, levelAr: null };

describe('a person’s employment, on a page about people', () => {
  it('a profile: job title, team, grade, type and arrangement "••••"; hire, probation and contract dates null; their ids null', () => {
    const profile = {
      id: OMAR.id,
      employeeCode: 'EMP-0182',
      fullNameEn: OMAR.fullNameEn,
      confidential: false,
      employment: {
        id: '5e5e5e5e-1111-4222-8333-444455556666',
        employeeId: OMAR.id,
        status: 'probation',
        employmentType: 'full_time',
        workArrangement: 'hybrid',
        workNature: 'regular',
        workPattern: 'partly_remote',
        paidByCommission: false,
        underLabourLaw: true,
        hazardousWork: false,
        officeDays: [0, 1],
        departmentId: TEAM.id,
        department: TEAM,
        jobTitleId: JOB.id,
        jobTitle: JOB,
        gradeId: GRADE.id,
        grade: GRADE,
        joinDate: '2026-07-13',
        probationEnd: '2026-10-12',
        endDate: null,
        endReason: null,
        shift: { id: 's', code: 'A', startTime: '09:00', endTime: '18:00' },
        createdAt: '2026-07-13T09:00:00.000Z',
        contract: {
          id: '6e6e6e6e-1111-4222-8333-444455556666',
          number: 'CON-2026-0001',
          status: 'active',
          form: 'fixed',
          payBasis: 'monthly',
          startDate: '2026-07-13',
          endDate: '2027-07-12',
          signedOn: '2026-07-13',
          probationEnd: '2026-10-12',
          jobTitleEn: 'Video Editor',
          jobTitleAr: 'محرر فيديو',
          gradeCode: 'G3',
          departmentName: 'Production › Video Team',
          insuranceFiledOn: '2026-07-16',
          labourOfficeFiledOn: null,
          nonRenewalNoticeBy: '2027-04-12',
          durationMonths: 12,
        },
      },
      reports: [{ id: 'r', employeeCode: 'EMP-0007', fullNameEn: 'Sara Adel', status: 'active', jobTitle: { titleEn: 'Editor' } }],
    };
    expect(maskForDeveloper(profile, '/api/employees/1', people)).toEqual({
      id: OMAR.id,
      employeeCode: 'EMP-0182',
      fullNameEn: 'Employee EMP-0182',
      // C-level or not: a grade's mark
      confidential: null,
      employment: {
        id: '5e5e5e5e-1111-4222-8333-444455556666',
        employeeId: OMAR.id,
        // statuses stay
        status: 'probation',
        employmentType: HIDDEN,
        workArrangement: HIDDEN,
        workNature: HIDDEN,
        workPattern: HIDDEN,
        paidByCommission: null,
        underLabourLaw: null,
        hazardousWork: null,
        officeDays: [],
        departmentId: null,
        department: HIDDEN_TEAM,
        jobTitleId: null,
        jobTitle: HIDDEN_JOB,
        gradeId: null,
        grade: HIDDEN_GRADE,
        joinDate: null,
        probationEnd: null,
        endDate: null,
        endReason: null,
        shift: { id: 's', code: 'A', startTime: '09:00', endTime: '18:00' },
        createdAt: '2026-07-13T09:00:00.000Z',
        contract: {
          id: '6e6e6e6e-1111-4222-8333-444455556666',
          number: 'CON-2026-0001',
          status: 'active',
          form: 'fixed',
          payBasis: HIDDEN,
          startDate: null,
          endDate: null,
          signedOn: null,
          probationEnd: null,
          jobTitleEn: HIDDEN,
          jobTitleAr: HIDDEN,
          gradeCode: HIDDEN,
          departmentName: HIDDEN,
          insuranceFiledOn: null,
          labourOfficeFiledOn: null,
          nonRenewalNoticeBy: null,
          durationMonths: 12,
        },
      },
      reports: [{ id: 'r', employeeCode: 'EMP-0007', fullNameEn: 'Employee EMP-0007', status: 'active', jobTitle: { titleEn: HIDDEN } }],
    });
    // the answer itself is never changed
    expect(profile.employment.jobTitle.titleEn).toBe('Video Editor');
  });

  it('social insurance per person: occupation, start, registration and number hidden', () => {
    expect(
      maskForDeveloper(
        { employeeCode: 'EMP-0182', insuranceNo: '98765432', occupationCode: '194200', occupationName: 'اخصائي موارد بشريه', insuranceStartDate: '2026-07-14', socialInsured: true, documentNo: '123456' },
        '/api/employees/1',
        people,
      ),
    ).toEqual({ employeeCode: 'EMP-0182', insuranceNo: HIDDEN, occupationCode: HIDDEN, occupationName: HIDDEN, insuranceStartDate: null, socialInsured: null, documentNo: HIDDEN });
  });

  it('a leave request: its days stay, where the person works hidden', () => {
    const leave = { id: 'l', employeeId: OMAR.id, startDate: '2026-10-05', endDate: '2026-10-06', days: 2, status: 'approved', employee: { id: OMAR.id, fullNameEn: OMAR.fullNameEn, department: 'Production', team: 'Video Team' } };
    expect(maskForDeveloper([leave], '/api/leave/requests', people)).toEqual([
      { ...leave, employee: { id: OMAR.id, fullNameEn: 'Employee EMP-0182', department: HIDDEN, team: HIDDEN } },
    ]);
  });

  it('a payroll line: job title, department, type and pay basis hidden; registered with social insurance null', () => {
    const line = {
      id: 'p',
      employeeId: OMAR.id,
      employeeCode: 'EMP-0182',
      name: OMAR.fullNameEn,
      department: 'Production › Video Team',
      jobTitle: 'Video Editor',
      employmentType: 'full_time',
      payBasis: 'monthly',
      terms: { paidDays: 30, insured: true, insuredWage: 16700, segments: [{ from: '2026-09-01', to: '2026-09-30', days: 30 }] },
    };
    expect(maskForDeveloper(line, '/api/payroll/runs/1', people)).toEqual({
      id: 'p',
      employeeId: OMAR.id,
      employeeCode: 'EMP-0182',
      name: 'Employee EMP-0182',
      department: HIDDEN,
      jobTitle: HIDDEN,
      employmentType: HIDDEN,
      payBasis: HIDDEN,
      // the month's days are activity
      terms: { paidDays: 30, insured: null, insuredWage: 0, segments: [{ from: '2026-09-01', to: '2026-09-30', days: 30 }] },
    });
  });

  it('a contract’s law warning: its end date and the dates written in its message hidden', () => {
    const warning = {
      kind: 'became_open_ended',
      employee: { id: OMAR.id, employeeCode: 'EMP-0182', fullNameEn: OMAR.fullNameEn },
      employmentId: 'e',
      contractNumber: 'CON-2026-0001',
      since: '2026-07-12',
      message: 'CON-2026-0001 ended on 12/07/2026 and the work goes on without a signed renewal.',
    };
    expect(hideJobForDeveloper(warning, '/api/contracts/law-warnings')).toEqual({
      ...warning,
      since: null,
      message: `CON-2026-0001 ended on ${HIDDEN} and the work goes on without a signed renewal.`,
    });
  });

  it('a raise request: the pay in force’s contract dates null, the date asked from stays', () => {
    expect(hideJobForDeveloper({ effectiveFrom: '2026-11-01', pay: { startDate: '2026-07-13', endDate: '2027-07-12', gross: 0 } }, '/api/employees/1/raise-requests')).toEqual({
      effectiveFrom: '2026-11-01',
      pay: { startDate: null, endDate: null, gross: 0 },
    });
  });

  it('a document’s tag values: the job, the terms and the social insurance hidden; the manager and the shift stay', () => {
    expect(
      hideJobForDeveloper(
        { values: { job_title: 'Video Editor', department_ar: 'الإنتاج', join_date: '13/07/2026', insurance_office: 'مكتب الدقي', occupation_code: '194200', manager_name: 'Employee EMP-0007', shift_en: '9:00 AM – 6:00 PM' } },
        '/api/documents/check',
      ),
    ).toEqual({ values: { job_title: HIDDEN, department_ar: HIDDEN, join_date: HIDDEN, insurance_office: HIDDEN, occupation_code: HIDDEN, manager_name: 'Employee EMP-0007', shift_en: '9:00 AM – 6:00 PM' } });
  });

  it('a count under a job’s name stays; nothing else is touched', () => {
    expect(hideJobForDeveloper({ self: 2, team: 3, hr: 0, month: '2026-09' }, '/api/kpis/counts')).toEqual({ self: 2, team: 3, hr: 0, month: '2026-09' });
  });
});

describe('aggregates stay, as long as no row is a person', () => {
  it('turnover by department kept, its leavers list hidden', () => {
    const report = {
      leavers: 1,
      byDepartment: [{ key: 'Production', label: 'Production', leavers: 1, voluntary: 1 }],
      leaversList: [{ employee: { id: OMAR.id, fullNameEn: 'Employee EMP-0182' }, endDate: '2026-09-30', endReason: 'resigned', leaverKind: 'voluntary', department: 'Production', tenureMonths: 14 }],
    };
    expect(hideJobForDeveloper(report, '/api/offboarding/turnover')).toEqual({
      leavers: 1,
      byDepartment: report.byDepartment,
      leaversList: [{ employee: { id: OMAR.id, fullNameEn: 'Employee EMP-0182' }, endDate: null, endReason: 'resigned', leaverKind: 'voluntary', department: HIDDEN, tenureMonths: null }],
    });
  });

  it('raises by department kept; a department row with people in it hidden', () => {
    expect(hideJobForDeveloper({ byDepartment: [{ department: { id: DEPT.id, nameEn: 'Production' }, raises: 2 }] }, '/api/reports/salary-raises')).toEqual({
      byDepartment: [{ department: { id: DEPT.id, nameEn: 'Production' }, raises: 2 }],
    });
    expect(hideJobForDeveloper({ departments: [{ id: DEPT.id, name: 'Production', average: 81 }] }, '/api/kpis/overview')).toEqual({ departments: [{ id: DEPT.id, name: 'Production', average: 81 }] });
    expect(
      hideJobForDeveloper({ departments: [{ department: { id: DEPT.id, nameEn: 'Production' }, people: [{ id: OMAR.id, employeeCode: 'EMP-0182', fullNameEn: 'Employee EMP-0182' }] }] }, '/api/x'),
    ).toEqual({ departments: [{ department: { id: null, nameEn: HIDDEN }, people: [{ id: OMAR.id, employeeCode: 'EMP-0182', fullNameEn: 'Employee EMP-0182' }] }] });
  });
});

describe('the company’s setup pages stay readable, their people cut off', () => {
  it('the departments and teams: names kept, their head or lead cut off', () => {
    const departments = [
      { id: DEPT.id, nameEn: 'Production', nameAr: 'الإنتاج', parentId: null, headId: OMAR.id, head: { id: OMAR.id, fullNameEn: OMAR.fullNameEn, employeeCode: 'EMP-0182' }, _count: { jobTitles: 2 } },
      { id: TEAM.id, nameEn: 'Video Team', nameAr: null, parentId: DEPT.id, headId: null, head: null, parent: { id: DEPT.id, nameEn: 'Production', nameAr: 'الإنتاج' }, _count: { jobTitles: 1 } },
    ];
    expect(maskForDeveloper(departments, '/api/departments', people)).toEqual([
      { id: DEPT.id, nameEn: 'Production', nameAr: 'الإنتاج', parentId: null, headId: null, head: { id: null, fullNameEn: HIDDEN, employeeCode: HIDDEN }, _count: { jobTitles: 2 } },
      departments[1],
    ]);
  });

  it('job titles, grades and the org chart as they are', () => {
    const titles = [{ ...JOB, departmentId: TEAM.id, department: TEAM, minGradeId: GRADE.id, minGrade: GRADE }];
    expect(maskForDeveloper(titles, '/api/job-titles', people)).toEqual(titles);
    expect(maskForDeveloper([GRADE], '/api/grades', people)).toEqual([GRADE]);
    const chart = { showsPeople: false, departments: [{ id: DEPT.id, nameEn: 'Production', nameAr: null, head: { id: OMAR.id, employeeCode: 'EMP-0182', fullNameEn: OMAR.fullNameEn, fullNameAr: OMAR.fullNameAr }, jobTitles: [{ ...JOB, headcount: 3 }], teams: [] }] };
    expect(maskForDeveloper(chart, '/api/org-chart', people)).toEqual({
      showsPeople: false,
      departments: [{ id: DEPT.id, nameEn: 'Production', nameAr: null, head: { id: null, employeeCode: HIDDEN, fullNameEn: HIDDEN, fullNameAr: HIDDEN }, jobTitles: [{ ...JOB, headcount: 3 }], teams: [] }],
    });
  });

  it('a KPI template keeps its job title; who changed it and any pseudonym in a text cut off', () => {
    expect(
      maskForDeveloper(
        { jobTitle: { ...JOB, department: { id: TEAM.id, nameEn: 'Video Team', parentName: 'Production' } }, updatedBy: { id: 'u', email: 'omar@trendlix.test', name: 'Omar Khaled' }, updatedById: 'u', note: 'Agreed with Omar Khaled Mahmoud' },
        '/api/kpis/templates',
        people,
      ),
    ).toEqual({ jobTitle: { ...JOB, department: { id: TEAM.id, nameEn: 'Video Team', parentName: 'Production' } }, updatedBy: { id: null, email: HIDDEN, name: HIDDEN }, updatedById: null, note: HIDDEN });
  });

  it('the company’s own social insurance registration stays', () => {
    expect(maskForDeveloper({ nameEn: 'TrendLIX', insuranceEmployerNo: '1234567', insuranceOffice: 'مكتب الدقي', insuranceSectorCode: '7' }, '/api/company', people)).toEqual({
      nameEn: 'TrendLIX',
      insuranceEmployerNo: '1234567',
      insuranceOffice: 'مكتب الدقي',
      insuranceSectorCode: '7',
    });
  });

  it('the list of company paths: setup pages in, pages about people out', () => {
    for (const path of [
      '/api/company',
      '/api/departments',
      '/api/departments/1d1d1d1d-1111-4222-8333-444455556666',
      '/api/job-titles',
      '/api/grades/1',
      '/api/org-chart',
      '/api/kpis/templates',
      '/api/kpis/templates/job-titles/1',
      '/api/kpis/framework',
      '/api/payroll/settings',
      '/api/payroll/law-rates',
      '/api/leave/types',
      '/api/attendance/check-in-setup/locations',
      '/api/recruitment/vacancies',
      '/api/recruitment/vacancies/1',
      '/api/templates/tags',
      '/api/reimbursement-types',
    ]) {
      expect(isDeveloperCompanyPath(path), path).toBe(true);
    }
    for (const path of [
      '/api/employees',
      '/api/employees/1',
      '/api/companyx',
      '/api/attendance/check-in-setup/people',
      '/api/recruitment/vacancies/1/board',
      '/api/recruitment/applications',
      '/api/templates/versions/1/preview-people',
      '/api/kpis/scorecards',
      '/api/payroll/runs/1',
      '/api/audit',
      '/api/me/reimbursement-types',
    ]) {
      expect(isDeveloperCompanyPath(path), path).toBe(false);
    }
    expect(DEVELOPER_COMPANY_PATHS.length).toBeGreaterThan(5);
  });
});

describe('the audit log', () => {
  it('a person’s job, terms and employment dates changed: from and to hidden; a leave’s dates and a department’s name stay', () => {
    const entries = [
      {
        entityType: 'employment',
        changes: [
          { field: 'departmentId', from: null, to: 'Video Team' },
          { field: 'joinDate', from: null, to: '13/07/2026' },
          { field: 'officeDays', from: null, to: '0, 1' },
          { field: 'status', from: 'probation', to: 'active' },
        ],
      },
      { entityType: 'contract', changes: [{ field: 'startDate', from: null, to: '13/07/2026' }, { field: 'gradeCode', from: null, to: 'G3' }, { field: 'version', from: null, to: '1' }] },
      { entityType: 'employee', changes: [{ field: 'socialInsured', from: 'No', to: 'Yes' }, { field: 'occupationCode', from: null, to: '194200' }] },
      { entityType: 'leave_request', changes: [{ field: 'startDate', from: null, to: '05/10/2026' }] },
      { entityType: 'department', changes: [{ field: 'nameEn', from: null, to: 'Video Team' }, { field: 'headId', from: null, to: 'Employee EMP-0182 (EMP-0182)' }] },
      { entityType: 'company', changes: [{ field: 'insuranceOffice', from: null, to: 'مكتب الدقي' }] },
    ];
    expect(hideJobForDeveloper({ entries }, '/api/audit')).toEqual({
      entries: [
        {
          entityType: 'employment',
          changes: [
            { field: 'departmentId', from: null, to: HIDDEN },
            { field: 'joinDate', from: null, to: HIDDEN },
            { field: 'officeDays', from: null, to: HIDDEN },
            { field: 'status', from: 'probation', to: 'active' },
          ],
        },
        { entityType: 'contract', changes: [{ field: 'startDate', from: null, to: HIDDEN }, { field: 'gradeCode', from: null, to: HIDDEN }, { field: 'version', from: null, to: '1' }] },
        { entityType: 'employee', changes: [{ field: 'socialInsured', from: HIDDEN, to: HIDDEN }, { field: 'occupationCode', from: null, to: HIDDEN }] },
        { entityType: 'leave_request', changes: [{ field: 'startDate', from: null, to: '05/10/2026' }] },
        { entityType: 'department', changes: [{ field: 'nameEn', from: null, to: 'Video Team' }, { field: 'headId', from: null, to: HIDDEN }] },
        { entityType: 'company', changes: [{ field: 'insuranceOffice', from: null, to: 'مكتب الدقي' }] },
      ],
    });
  });
});

describe('filters that would say who is where', () => {
  it('dropped from a list of people, kept on a company page; a name search still finds nothing', () => {
    expect(developerQuery({ departmentId: DEPT.id, month: '2026-09' }, '/api/attendance')).toEqual({ month: '2026-09' });
    expect(developerQuery({ departmentId: DEPT.id, jobTitleId: JOB.id, gradeId: GRADE.id, teamId: TEAM.id, employmentType: 'full_time' }, '/api/kpis/scorecards')).toEqual({});
    expect(developerQuery({ departmentIds: [DEPT.id] }, '/api/wfh')).toEqual({});
    expect(developerQuery({ departmentId: DEPT.id }, '/api/job-titles')).toBeNull();
    expect(developerQuery({ departmentId: DEPT.id }, '/api/kpis/templates')).toBeNull();
    // `type` is the employment type on the contracts list, an adjustment's kind elsewhere
    expect(developerQuery({ type: 'full_time' }, '/api/contracts')).toEqual({});
    expect(developerQuery({ type: 'bonus' }, '/api/payroll/adjustments')).toBeNull();
    expect(developerQuery({ q: 'Omar', departmentId: DEPT.id }, '/api/offboarding/former')).toEqual({ q: DEVELOPER_NO_MATCH });
    // without the path: as before
    expect(developerQuery({ departmentId: DEPT.id })).toBeNull();
  });
});

describe('the lists', () => {
  it('name what they hide', () => {
    for (const k of ['jobTitle', 'jobTitleEn', 'jobTitleAr', 'department', 'departmentName', 'team', 'grade', 'gradeCode', 'employmentType', 'workArrangement', 'workNature', 'occupationCode', 'insuranceOffice', 'insuranceSectorCode']) {
      expect(DEVELOPER_JOB_TEXT_FIELDS.has(k), k).toBe(true);
    }
    for (const k of ['joinDate', 'probationEnd', 'lastWorkingDay', 'insuranceStartDate', 'insuranceFiledOn', 'serviceMonths', 'tenureMonths']) expect(DEVELOPER_JOB_DATE_FIELDS.has(k), k).toBe(true);
    for (const k of ['departmentId', 'teamId', 'jobTitleId', 'gradeId']) {
      expect(DEVELOPER_JOB_ID_FIELDS.has(k), k).toBe(true);
      expect(DEVELOPER_JOB_PARAMS.has(k), k).toBe(true);
    }
    expect(DEVELOPER_JOB_FLAG_FIELDS.has('socialInsured')).toBe(true);
    for (const k of ['startDate', 'endDate', 'signedOn']) expect(DEVELOPER_EMPLOYMENT_DATE_FIELDS.has(k), k).toBe(true);
    for (const k of ['byDepartment', 'departments']) expect(DEVELOPER_AGGREGATE_KEYS.has(k), k).toBe(true);
    for (const tag of ['job_title', 'department', 'grade', 'employment_type_ar', 'join_date', 'start_date', 'end_date', 'probation_end', 'insurance_start_date', 'occupation_code', 'insurance_office', 'last_working_day']) {
      expect(DEVELOPER_JOB_TAG_FIELDS.has(tag), tag).toBe(true);
    }
    for (const tag of ['manager_name', 'shift', 'contract_number']) expect(DEVELOPER_JOB_TAG_FIELDS.has(tag), tag).toBe(false);
    // a leave's dates are activity, never hidden by name alone
    expect(DEVELOPER_JOB_DATE_FIELDS.has('startDate')).toBe(false);
  });
});
