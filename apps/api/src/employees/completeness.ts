import {
  graduationOverdueText,
  graduationPassed,
  PAPERWORK_LABELS,
  paperworkType,
  printedQualificationAr,
  requiredPaperwork,
  type EmploymentType,
  type Gender,
} from '@trendlix/shared';
import { fromDateOnly, todayInCairo } from '../common/date-only.js';
import type { Employee, EmployeeBank, EmployeeIdentity, Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// How complete a profile is: one checklist for the profile's header and for the Missing Details report (owner's
// request, 16 October 2026: "a report with the missing personal profile fields and documents"), so the report says
// exactly what each profile says. What it is worked out from is loaded here too, for one profile or for everyone at
// once.

/** One thing the profile still lacks, and the tab of the profile where it is filled in. */
export interface Missing {
  key: string;
  label: string;
  tab: 'basic' | 'education' | 'employment' | 'documents';
}

export interface Completeness {
  percent: number;
  missing: Missing[];
}

/** The current employment as completeness checks it: which of its links are set, and its grade's rank. */
export interface CurrentEmployment {
  employmentType: EmploymentType;
  departmentId: string | null;
  jobTitleId: string | null;
  gradeId: string | null;
  managerId: string | null;
  shiftId: string | null;
  grade: { rank: number } | null;
}

/** What a profile's completeness is worked out from. */
export interface ProfileOnFile {
  employee: Employee;
  identity: EmployeeIdentity | null;
  bank: EmployeeBank | null;
  /** The current employment; null when not employed. */
  employment: CurrentEmployment | null;
  /** The latest employment's type, current or past (null when never employed): which papers the file needs. */
  latestType: EmploymentType | null;
  /** The highest rank in the grades table (the CEO's grade); null when it was not needed. */
  topRank: number | null;
  /** The kinds of paper in the employee file. */
  papers: readonly string[];
  /** Today in Cairo (YYYY-MM-DD), for a student's expected graduation; none: today. */
  today?: string;
}

type Check = [boolean, Missing];

/** One item of the checklist: there when the value is (only whether it is there is read, never the value itself). */
const check = (value: unknown, key: string, label: string, tab: Missing['tab']): Check => [!!value, { key, label, tab }];

/**
 * How complete a profile is: the fields HR fills in and the papers the employee file needs (by the current
 * employment; see requiredPaperwork). Only whether each is there counts, so restricted values are never read here
 * for the result.
 *
 * Owner's decision, 15 October 2026: everything counts (employment, bank, city, faculty, the work email …) except
 * the emergency contact and the second mobile. Also never counted: the employee code (always set), the work
 * arrangement (always has a value), the probation end date, the job description acknowledgement, and the social
 * insurance occupation, subscription start and wages (HR's, on the Social Insurance tab: owner, 16 October 2026). Some
 * items count only where they apply: the work email and the employment items while employed, the university, faculty and
 * major unless the degree is high school, and the direct manager unless the grade is the top rank (the CEO has no
 * manager). The social insurance number counts for everyone (owner, 15 October 2026).
 *
 * A student (owner, 25 October 2026: "Add a Student option"; "Missing Details stops asking for a degree") is asked the
 * university, the faculty, the year and the expected graduation instead of a degree, a major, a graduation year and a
 * grade; their qualification is there when typed or when the student's wording can be made (as {{qualification}} prints
 * it). Once the expected graduation month has passed and they are still marked studying, HR is asked to update the
 * qualification: "Expected to graduate in June 2026: update the qualification".
 */
export function completeness({ employee: e, identity, bank, employment, latestType, topRank, papers, today = todayInCairo() }: ProfileOnFile): Completeness {
  const student = e.stillStudying;
  const highSchool = e.degree === 'high_school' && !student;
  const expected = fromDateOnly(e.expectedGraduation);
  const topGrade = !!employment?.grade && topRank !== null && employment.grade.rank >= topRank;
  const checks: Check[] = [
    check(e.fullNameEn, 'fullNameEn', 'Full name (English)', 'basic'),
    check(e.fullNameAr, 'fullNameAr', 'Full name (Arabic)', 'basic'),
    check(e.displayName, 'displayName', 'Display name', 'basic'),
    check(e.dateOfBirth, 'dateOfBirth', 'Date of birth', 'basic'),
    check(e.gender, 'gender', 'Gender', 'basic'),
    check(e.nationality, 'nationality', 'Nationality', 'basic'),
    check(e.maritalStatus, 'maritalStatus', 'Marital status', 'basic'),
    // a woman's military status is always Not applicable (owner's rule), which counts as filled in
    check(e.gender === 'female' ? 'not_applicable' : e.militaryStatus, 'militaryStatus', 'Military status', 'basic'),
    // every file needs it (owner, 15 October 2026): it is on the social insurance print
    check(e.insuranceNo, 'insuranceNo', 'Social insurance number', 'basic'),
    // the work email only while employed
    ...(employment ? [check(e.workEmail, 'workEmail', 'Work email', 'basic')] : []),
    check(e.personalEmail, 'personalEmail', 'Personal email', 'basic'),
    check(e.mobile, 'mobile', 'Mobile', 'basic'),
    check(e.city, 'city', 'City', 'basic'),
    check(e.governorate, 'governorate', 'Governorate', 'basic'),
    check(e.addressAr, 'addressAr', 'Address (Arabic)', 'basic'),
    check(identity?.nationalId, 'nationalId', 'National ID number', 'basic'),
    check(identity?.printedNo, 'printedNo', 'National ID printed number', 'basic'),
    check(identity?.issueDate, 'idIssueDate', 'National ID issue date', 'basic'),
    check(identity?.expiryDate, 'idExpiry', 'National ID expiry date', 'basic'),
    check(bank?.bankName, 'bankName', 'Bank', 'basic'),
    check(bank?.accountNo, 'accountNo', 'Account number', 'basic'),
    check(bank?.iban, 'iban', 'IBAN', 'basic'),
    check(bank?.holderName, 'holderName', 'Account holder', 'basic'),

    ...(student ? [] : [check(e.degree, 'degree', 'Degree', 'education')]),
    // a high school diploma has no university, faculty or major; a student is at one, their major not asked yet
    ...(highSchool
      ? []
      : [
          check(e.university, 'university', 'University', 'education'),
          check(e.faculty, 'faculty', 'Faculty', 'education'),
          ...(student ? [] : [check(e.major, 'major', 'Major', 'education')]),
        ]),
    ...(student
      ? [check(e.studyYear, 'studyYear', 'Study year', 'education'), check(expected, 'expectedGraduation', 'Expected graduation', 'education')]
      : [check(e.graduationYear, 'graduationYear', 'Graduation year', 'education'), check(e.educationGrade, 'educationGrade', 'Education grade', 'education')]),
    check(printedQualificationAr(e), 'qualificationAr', 'Qualification (Arabic)', 'education'),
    // still marked studying after the expected graduation month: the qualification to update, on the expected graduation
    ...(student && expected && graduationPassed(expected, today)
      ? [[false, { key: 'expectedGraduation', label: graduationOverdueText(expected), tab: 'education' }] satisfies Check]
      : []),

    ...(employment
      ? [
          check(employment.departmentId, 'team', 'Department or team', 'employment'),
          check(employment.jobTitleId, 'jobTitle', 'Job title', 'employment'),
          check(employment.gradeId, 'grade', 'Grade', 'employment'),
          check(employment.shiftId, 'shift', 'Shift', 'employment'),
          // the CEO has no manager: none is needed at the top rank (the highest in the grades table)
          ...(topGrade ? [] : [check(employment.managerId, 'manager', 'Direct manager', 'employment')]),
        ]
      : []),

    // the national ID's front and back are one paper: its scan counts once, when both sides are there
    ...requiredPaperwork(paperworkType(employment?.employmentType, latestType), (e.gender as Gender | null) ?? null)
      .filter((kind) => kind !== 'national_id_back')
      .map((kind): Check =>
        kind === 'national_id_front'
          ? [papers.includes('national_id_front') && papers.includes('national_id_back'), { key: 'national_id', label: 'National ID scan (front and back)', tab: 'documents' }]
          : [papers.includes(kind), { key: kind, label: PAPERWORK_LABELS[kind], tab: 'documents' }],
      ),
  ];
  const done = checks.filter(([ok]) => ok).length;
  return { percent: Math.round((done / checks.length) * 100), missing: checks.filter(([ok]) => !ok).map(([, m]) => m) };
}

/** What an employment is read with for the checklist (with Prisma's `select`): the links it checks and the grade's rank. */
export const CHECKED_EMPLOYMENT = {
  employmentType: true,
  departmentId: true,
  jobTitleId: true,
  gradeId: true,
  managerId: true,
  shiftId: true,
  grade: { select: { rank: true } },
} satisfies Prisma.EmploymentSelect;

/**
 * The kinds of paper in each employee file, by employee id: one query however many people are asked for. Someone with
 * no paper has no entry.
 */
export async function papersOf(prisma: PrismaService, employeeIds: readonly string[]): Promise<Map<string, string[]>> {
  const rows = await prisma.paperworkItem.findMany({
    where: { employeeId: { in: [...employeeIds] } },
    select: { employeeId: true, kind: true },
    distinct: ['employeeId', 'kind'],
  });
  const papers = new Map<string, string[]>();
  for (const { employeeId, kind } of rows) {
    const kinds = papers.get(employeeId);
    if (kinds) kinds.push(kind);
    else papers.set(employeeId, [kind]);
  }
  return papers;
}

/** The highest rank in the grades table (the CEO's grade), which needs no direct manager; null with no grades. */
export async function topGradeRank(prisma: PrismaService): Promise<number | null> {
  const top = await prisma.grade.aggregate({ _max: { rank: true } });
  return top._max.rank ?? null;
}
