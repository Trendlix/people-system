import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  accountLengthOk,
  accountLengthText,
  bankNamed,
  CONFIDENTIAL_NOTE,
  employmentStanding,
  insurableWageLimits,
  lastTrainingEnd,
  trainingAgainFrom,
  underLabourLaw,
  workPatternOf,
  type PhotoCrop,
  type Standing,
} from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import { actsAs, assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, toDateOnly, todayInCairo } from '../common/date-only.js';
import { fromTimeOfDay } from '../common/time-of-day.js';
import { changeRequestView, CONFIRMATION_INCLUDE, confirmationView, REQUEST_INCLUDE } from '../confirmations/views.js';
import { INSURANCE_BASIC_DEFAULT } from '../contracts/contract-settings.service.js';
import { TRAINING_HISTORY, trainingHistoryOf } from '../contracts/training.js';
import {
  agreementVersions,
  CONTRACT_INCLUDE,
  contractBecameOpenEnded,
  contractView,
  employmentCasualTooLong,
  ENDING_INCLUDE,
  endingView,
  type ContractContext,
} from '../contracts/views.js';
import type { Employee, EmployeeBank, EmployeeIdentity, Prisma } from '../generated/prisma/client.js';
import { leadsOf, NO_LEADS } from '../organisation/departments/leads.js';
import { storedCrop } from '../paperwork/photo-crop.js';
import { LawRatesService } from '../payroll/law-rates/law-rates.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { accessStates } from '../employee-access/access-state.js';
import {
  deletesEmployees,
  editsEmployees,
  isSelf,
  seesBank,
  seesChangeRequests,
  seesEmployeeFile,
  seesEndings,
  seesEveryone,
  seesIdentity,
  seesSalary,
} from './access.js';
import { birthDateFromNationalId, maskTail } from './checks.js';
import { completeness, papersOf, topGradeRank } from './completeness.js';
import { ConfidentialService } from './confidential.service.js';
import { contractFactsOf, STATUS_CONTRACTS, STATUS_ENDING } from './contract-facts.js';
import type { CreateEmployeeDto, UpdateBankDto, UpdateEmployeeDto, UpdateIdentityDto } from './employee.dto.js';
import { INSURED_VERSION, insuredContractPay, insuredVersionOf, insuredWageOfEmployee } from './insured-wage.js';
import { withOccupation } from './occupation-view.js';

const ENTITY = 'employee';
const DATE_FIELDS = ['dateOfBirth', 'insuranceStartDate'] as const;
/**
 * The social insurance wages Form 1 prints that are the employee's own (owner, 16 October 2026): salary data, so seen
 * and set only by those who see salaries, and never written to the audit log, only the fact that they changed (as a
 * contract's salary). The insured wage is not one of them: it is worked out from the comprehensive wage (owner's
 * decision, 16 October 2026).
 */
const WAGE_FIELDS = ['insuranceBasicWage', 'insuranceComprehensiveWage'] as const;

/** A grade as employments name it. */
const GRADE = { select: { id: true, code: true, rank: true, levelEn: true, levelAr: true } } as const;

/**
 * Where an employment places someone: their department, or their team with its department; their job title, and their
 * own grade (owner's decision, 15 October 2026: no longer the job title's).
 */
export const PLACE = {
  department: { select: { id: true, nameEn: true, nameAr: true, parent: { select: { id: true, nameEn: true, nameAr: true } } } },
  jobTitle: { select: { id: true, titleEn: true, titleAr: true, jdVersion: true } },
  grade: GRADE,
} satisfies Prisma.EmploymentInclude;

const EMPLOYMENT = {
  ...PLACE,
  manager: { select: { id: true, employeeCode: true, fullNameEn: true } },
  shift: { select: { id: true, code: true, startTime: true, endTime: true, hoursPerDay: true, workingDays: true } },
  // the newest signed contract (contracts module, 15 October 2026), and the newest ending whatever its status
  // (contracts review, 15 October 2026): a rejected one stays, with the CEO's note, until a new ending is started
  contracts: { where: { status: 'active' }, orderBy: { version: 'desc' }, take: 1, include: CONTRACT_INCLUDE },
  endings: { orderBy: { createdAt: 'desc' }, take: 1, include: ENDING_INCLUDE },
} satisfies Prisma.EmploymentInclude;

/** Newest first, the current employment (no end date) before all ended ones. */
export const NEWEST_FIRST = [{ endDate: { sort: 'desc', nulls: 'first' } }, { joinDate: 'desc' }] satisfies Prisma.EmploymentOrderByWithRelationInput[];

/** The papers a profile's picture can be: a personal photo in the employee file, uploaded as an image (not a PDF). */
const PHOTO = { kind: 'personal_photo', mimeType: { in: ['image/jpeg', 'image/png', 'image/webp'] } } satisfies Prisma.PaperworkItemWhereInput;

type EmploymentRow = Prisma.EmploymentGetPayload<{ include: typeof EMPLOYMENT }>;

/** What an employment is shown with, besides its own row. */
interface EmploymentContext extends Omit<ContractContext, 'workingDays'> {
  /** HR, Admin and the CEO see how it ends (see seesEndings); everyone else gets `ending: null`. */
  seesEndings: boolean;
}

/**
 * An employment as the API sends it: dates as YYYY-MM-DD, office days in order, shift times as HH:mm; its signed
 * contract (salary restricted to HR, Finance and the CEO) and its newest ending (HR, Admin and the CEO), or null.
 */
export function employmentView(e: EmploymentRow, { seesEndings, ...ctx }: EmploymentContext) {
  const { shift, joinDate, probationEnd, jdAcknowledgedAt, endDate, officeDays, contracts, endings, ...rest } = e;
  const [contract] = contracts;
  const [ending] = endings;
  const contractShown = contract
    ? contractView(contract, { ...ctx, workingDays: shift?.workingDays ?? null, employmentEndDate: endDate, casualTooLong: employmentCasualTooLong(e) })
    : null;
  return {
    ...rest,
    joinDate: fromDateOnly(joinDate),
    probationEnd: fromDateOnly(probationEnd),
    jdAcknowledgedAt: fromDateOnly(jdAcknowledgedAt),
    endDate: fromDateOnly(endDate),
    officeDays: [...officeDays].sort((a, b) => a - b),
    // its hours to work a day: null for the whole window (owner, 16 October 2026: flexible shifts)
    shift: shift && {
      id: shift.id,
      code: shift.code,
      startTime: fromTimeOfDay(shift.startTime),
      endTime: fromTimeOfDay(shift.endTime),
      hoursPerDay: shift.hoursPerDay?.toNumber() ?? null,
    },
    contract: contractShown,
    ending: ending && seesEndings ? endingView(ending, ctx.seesSalary) : null,
    // by the labour law (owner, 18 October 2026): under it or not (freelance isn't, Art. 1(1)), remote work (Art. 96(1)),
    // and the warnings: casual work past 6 months (Art. 1(7)), the fixed term become open-ended (Art. 88(3))
    underLabourLaw: underLabourLaw(e.employmentType),
    workPattern: workPatternOf(e.workArrangement),
    casualTooLong: employmentCasualTooLong(e),
    // a trainee's or an intern's agreement never becomes open-ended: it isn't an employment contract (19 October 2026)
    becameOpenEnded: contract && !contractShown?.training ? contractBecameOpenEnded(contract, endDate) : false,
  };
}

type DateField = (typeof DATE_FIELDS)[number];
type WageField = (typeof WAGE_FIELDS)[number];
type EmployeeFields = Omit<Employee, DateField | WageField> & Record<DateField, string | null> & Record<WageField, number | null>;

/** The profile's own columns as the API sends them: dates as YYYY-MM-DD, amounts as numbers. */
function fields(e: Employee): EmployeeFields {
  return {
    ...e,
    dateOfBirth: fromDateOnly(e.dateOfBirth),
    insuranceStartDate: fromDateOnly(e.insuranceStartDate),
    insuranceBasicWage: e.insuranceBasicWage?.toNumber() ?? null,
    insuranceComprehensiveWage: e.insuranceComprehensiveWage?.toNumber() ?? null,
  };
}

/** The wages in an audit diff, a profile's as created or what changed: only that they were set or changed. */
function wagesMasked<T extends Record<string, unknown>>(diff: T): T {
  const out: Record<string, unknown> = { ...diff };
  for (const key of WAGE_FIELDS) if (out[key] !== undefined && out[key] !== null) out[key] = 'changed';
  return out as T;
}

/** The wages are set only by those who see salaries; today HR alone changes a profile, and HR sees them. */
function assertSetsWages(user: SessionUser, dto: CreateEmployeeDto | UpdateEmployeeDto) {
  if (WAGE_FIELDS.some((key) => dto[key] !== undefined) && !seesSalary(user)) {
    throw new ForbiddenException('Only HR, Finance and the CEO see salaries, so only they set the social insurance wages.');
  }
}

/** What Prisma writes: YYYY-MM-DD strings become dates. */
function toData<T extends Record<string, unknown>>(values: T): T {
  const data: Record<string, unknown> = { ...values };
  for (const key of DATE_FIELDS) {
    if (typeof data[key] === 'string') data[key] = toDateOnly(data[key]);
  }
  return data as T;
}

function identityView(row: EmployeeIdentity | null) {
  return {
    nationalId: row?.nationalId ?? null,
    printedNo: row?.printedNo ?? null,
    issueDate: fromDateOnly(row?.issueDate ?? null),
    expiryDate: fromDateOnly(row?.expiryDate ?? null),
  };
}

function bankView(row: EmployeeBank | null) {
  return {
    bankName: row?.bankName ?? null,
    branch: row?.branch ?? null,
    accountNo: row?.accountNo ?? null,
    iban: row?.iban ?? null,
    holderName: row?.holderName ?? null,
  };
}

/** The identity with its numbers masked, as the profile shows it. Null when nothing is recorded. */
function maskedIdentity(row: EmployeeIdentity | null) {
  if (!row) return null;
  const { nationalId, printedNo, ...rest } = identityView(row);
  return { nationalIdMasked: maskTail(nationalId), printedNoMasked: maskTail(printedNo), ...rest };
}

function maskedBank(row: EmployeeBank | null) {
  if (!row) return null;
  const { accountNo, iban, ...rest } = bankView(row);
  return { ...rest, accountNoMasked: maskTail(accountNo), ibanMasked: maskTail(iban) };
}

/** The same bank: by the EG-ACH list's name when on it, so "NBE" typed before the list and "National Bank of Egypt" are one. */
function sameBank(a: string | null, b: string | null): boolean {
  return (bankNamed(a)?.name ?? a) === (bankNamed(b)?.name ?? b);
}

/**
 * The account number must have a length its bank uses, when the bank is on the EG-ACH banks list (the owner's EG-ACH
 * file, 15 October 2026): 19 digits at the National Bank of Egypt, 12 or 16 at Audi Bank …, digits only. The bank and
 * the number as they will be saved (sent, else on file) are checked together, and only when either of them changes,
 * so details already on file never stop something else being saved. A bank the list gives no length for (Central
 * Bank of Egypt …) or one not on the list takes any number (UpdateBankDto checks it is 4–34 letters and digits).
 * The number is restricted, so the message never repeats it.
 */
function assertAccountFitsBank(before: EmployeeBank | null, dto: UpdateBankDto) {
  const saved = bankView(before);
  const bankChanged = dto.bankName !== undefined && !sameBank(dto.bankName, saved.bankName);
  const accountChanged = dto.accountNo !== undefined && dto.accountNo !== saved.accountNo;
  if (!bankChanged && !accountChanged) return;

  const bank = bankNamed(dto.bankName !== undefined ? dto.bankName : saved.bankName);
  const accountNo = dto.accountNo !== undefined ? dto.accountNo : saved.accountNo;
  const length = bank && accountLengthText(bank);
  if (bank && length && accountNo && !accountLengthOk(bank, accountNo)) {
    throw new BadRequestException(`${bank.name} account numbers have ${length}. Check the number against the bank's letter.`);
  }
}

/** The fields that were sent (undefined means "leave as it is"), as a plain object. */
function withoutUndefined(dto: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
}

/** Restricted values never go to the audit log: only the fact that they changed. */
function restrictedChanges(diff: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (key in diff) diff[key] = 'changed';
  return diff;
}

/** What changed in the national ID details, for the audit log: the numbers themselves only as 'changed'. */
function identityChanges(before: EmployeeIdentity | null, dto: UpdateIdentityDto): Record<string, unknown> {
  return restrictedChanges(changes(identityView(before), dto as Record<string, unknown>), ['nationalId', 'printedNo']);
}

/** The national ID columns Prisma writes: YYYY-MM-DD strings become dates; undefined leaves a column as it is. */
function identityData(dto: UpdateIdentityDto) {
  const date = (v: string | null | undefined) => (typeof v === 'string' ? toDateOnly(v) : v);
  return {
    nationalId: dto.nationalId,
    printedNo: dto.printedNo,
    issueDate: date(dto.issueDate),
    expiryDate: date(dto.expiryDate),
  };
}

/** The directory card's place: the current employment's job title and department or team, and its status. */
const CARD_EMPLOYMENT = {
  where: { endDate: null },
  take: 1,
  select: { id: true, status: true, employmentType: true, department: PLACE.department, jobTitle: { select: { id: true, titleEn: true, titleAr: true } } },
} as const;

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lawRates: LawRatesService,
    private readonly confidential: ConfidentialService,
  ) {}

  /**
   * The people this user may see, each with their current employment, or how their last one ended. A C-level person
   * hidden from the caller (owner, 19 October 2026: "make C level Employees details not visible to HR") is their
   * directory card only (`restricted`): name, photo, job title, department or team, work email, code and where they
   * stand. `confidential`: C-level, for everyone. With the current employment, what its contract status is worked out
   * from (owner, 21 October 2026: "instead of the Emp code, add contract status"): its probation end, its contract in
   * force else its latest draft (contractFactsOf), and its approved ending's last working day for those who see endings
   * (HR, Admin, the CEO; null for the others); never on a card.
   */
  async list(user: SessionUser) {
    const confidential = await this.confidential.view(user);
    const salary = seesSalary(user);
    const endings = seesEndings(user);
    const rows = await this.prisma.employee.findMany({
      where: await this.visibleTo(user),
      select: {
        id: true,
        employeeCode: true,
        fullNameEn: true,
        fullNameAr: true,
        workEmail: true,
        // their access (22 October 2026): read for the Access column, never sent on
        personalEmail: true,
        signInEmail: true,
        employments: {
          orderBy: NEWEST_FIRST,
          take: 1,
          select: {
            id: true,
            status: true,
            employmentType: true,
            joinDate: true,
            endDate: true,
            endReason: true,
            department: PLACE.department,
            jobTitle: { select: { id: true, titleEn: true } },
            gradeId: true,
            grade: GRADE,
            manager: { select: { id: true, fullNameEn: true } },
            // the contract status (21 October 2026)
            probationEnd: true,
            contracts: STATUS_CONTRACTS,
            endings: STATUS_ENDING,
          },
        },
      },
      orderBy: { employeeCode: 'asc' },
    });
    const photos = seesEmployeeFile(user) ? await this.photos(rows.map((e) => e.id)) : null;
    // the Access column (owner, 22 October 2026: "any active employee with active contract should have access"): for HR,
    // an Admin and a Super Admin, of the people whose details they see
    const access = actsAs(user.roles, ['hr', 'admin'])
      ? await accessStates(
          this.prisma,
          rows.filter((r) => !confidential.hidden.has(r.id)),
        )
      : null;
    return rows.map(({ employments: [latest], personalEmail: _personal, signInEmail: _choice, ...e }) => {
      const current = latest && !latest.endDate ? latest : null;
      const ended = latest?.endDate ? latest : null;
      const card = {
        ...e,
        photoId: photos?.get(e.id)?.id ?? null,
        photoCrop: photos?.get(e.id)?.crop ?? null,
        // a trainee's or an intern's Active is Trainee or Intern (owner, 19 October 2026: "interns to be labeled trainees
        // instead of probation")
        standing: (current ? employmentStanding(current) : ended ? 'former' : 'not_employed') as Standing,
        confidential: confidential.all.has(e.id),
      };
      if (confidential.hidden.has(e.id)) {
        // the directory card: the job title and the department or team, nothing of the employment's terms
        return {
          ...card,
          restricted: true as const,
          employment: current && { id: current.id, status: current.status, department: current.department, jobTitle: current.jobTitle },
          lastEnded: null,
        };
      }
      return {
        ...card,
        restricted: false as const,
        ...(access && { access: access.get(e.id) ?? null }),
        employment: current && {
          id: current.id,
          status: current.status,
          employmentType: current.employmentType,
          joinDate: fromDateOnly(current.joinDate),
          department: current.department,
          jobTitle: current.jobTitle,
          gradeId: current.gradeId,
          grade: current.grade,
          manager: current.manager,
          probationEnd: fromDateOnly(current.probationEnd),
          contract: contractFactsOf(current.contracts, salary),
          endingOn: endings ? fromDateOnly(current.endings[0]?.lastWorkingDay ?? null) : null,
        },
        lastEnded: ended && { endDate: fromDateOnly(ended.endDate), endReason: ended.endReason },
      };
    });
  }

  /**
   * A profile: personal details, the national ID and bank (masked, for those who may see them), the current
   * employment and the history of employments, the people who report to this person now, and how complete it is.
   * Also the employee's own confirmation of their details and their change requests (owner's decision, 15 October
   * 2026), and whether the signed-in user is this employee (`isSelf`: only they confirm or ask for a change). The social
   * insurance occupation comes with its name (owner's decision, 16 October 2026: the employee's, on the Social Insurance
   * tab); the social insurance wages and the default basic wage only for those who see salaries, with the insured wage
   * Form 1 prints as it is worked out from the comprehensive wage, and this year's insurable limits. `socialInsured`
   * (registered with social insurance, which payroll deducts insurance for) is one of the profile's own columns.
   */
  async get(id: string, user: SessionUser) {
    const identity = seesIdentity(user);
    const bank = seesBank(user);
    // a C-level person hidden from the caller: their directory card, with the note (owner, 19 October 2026)
    if (await this.confidential.isHidden(user, id)) return this.card(id, user);
    const e = await this.prisma.employee.findFirst({
      where: { AND: [{ id }, await this.visibleTo(user)] },
      include: {
        identity: true,
        bank: true,
        employments: { include: EMPLOYMENT, orderBy: NEWEST_FIRST },
        managing: {
          where: { endDate: null },
          select: {
            status: true,
            employmentType: true,
            employee: { select: { id: true, employeeCode: true, fullNameEn: true } },
            jobTitle: { select: { titleEn: true } },
          },
          orderBy: { employee: { fullNameEn: 'asc' } },
        },
        confirmations: { orderBy: { confirmedAt: 'desc' }, take: 1, include: CONFIRMATION_INCLUDE },
      },
    });
    if (!e) throw new NotFoundException('Employee not found.');

    const { identity: idRow, bank: bankRow, employments, managing, confirmations: [confirmed], ...own } = e;
    const self = isSelf(user, own);
    // the non-renewal rule's notice dates a signed fixed-term contract's last day to say it won't be renewed
    const nonRenewal = employments.some((x) => x.contracts.some((c) => c.form === 'fixed'))
      ? await this.prisma.endingRule.findUnique({ where: { key: 'non_renewal' }, select: { noticeAmount: true, noticeUnit: true } })
      : null;
    // a trainee's or an intern's agreements (19 October 2026): which one the contract in force is, and when the last one
    // ended, a new one starting 6 months after it at the earliest
    const training = await this.prisma.employment.findMany({ where: { employeeId: id }, select: TRAINING_HISTORY });
    const agreementsOf = (employmentId: string) => {
      const row = training.find((t) => t.id === employmentId);
      return row ? agreementVersions(row.employmentType, row.contracts) : null;
    };
    const lastEnded = lastTrainingEnd(trainingHistoryOf(training));
    const history = employments.map((x) => employmentView(x, { seesSalary: seesSalary(user), seesEndings: seesEndings(user), nonRenewal, agreements: agreementsOf(x.id) }));
    const current = history.find((x) => x.endDate === null) ?? null;
    const salary = seesSalary(user);
    // the top rank is only needed to know whether a graded employment needs a manager. The insured wage Form 1 prints
    // (owner's decision, 16 October 2026): the comprehensive wage, the employee's own else the gross and allowances of
    // the contract the Social Insurance tab is about (the current employment's, else the latest's), within this year's
    // insurable limits in Cairo (the year's rates set by law); worked out here as documents/values.ts prints it, and as
    // payroll deducts insurance on it for a run's year (insured-wage.ts); after a raise, the contract's pay before it
    // until the raise's insured-wage date, as payroll (owner's decision, 16 October 2026)
    // the people in charge of where the current employment places them (owner, 19 October 2026: "i want to add department
    // lead person, the person in charge"): its team's lead and its department's head, for the Employment details
    const [papers, topRank, changeRequests, settings, photos, law, insuredPay, leads] = await Promise.all([
      papersOf(this.prisma, [id]),
      current?.grade ? topGradeRank(this.prisma) : null,
      self || seesChangeRequests(user) ? this.changeRequestsOf(id) : [],
      salary ? this.prisma.contractSettings.findUnique({ where: { id: 1 }, select: { insuranceBasicDefault: true } }) : null,
      seesEmployeeFile(user) ? this.photos([id]) : null,
      this.lawRates.forYear(Number(todayInCairo().slice(0, 4))),
      salary ? this.insuredPay(current ?? history[0] ?? null) : null,
      current ? leadsOf(this.prisma, current.departmentId) : NO_LEADS,
    ]);
    const { insuranceBasicWage, insuranceComprehensiveWage, priorServiceMonths, disability, ...open } = withOccupation(fields(own));
    return {
      ...open,
      // for the annual leave (owner, 18 October 2026; Art. 124): the service with earlier employers and a disability, as
      // restricted as the national ID, for HR, the CEO and the employee themself
      ...((identity || self) && { priorServiceMonths, disability }),
      // the social insurance wages, with the default basic wage printed for an employee who has none: salary data, for
      // those who see salaries only (owner, 16 October 2026)
      ...(salary && {
        insuranceBasicWage,
        insuranceComprehensiveWage,
        insuranceBasicDefault: settings?.insuranceBasicDefault.toNumber() ?? INSURANCE_BASIC_DEFAULT,
        insuredWage: insuredWageOfEmployee(insuranceComprehensiveWage, insuredPay?.total ?? null, law),
        // as before a raise, until when and whether Form 2 was filed; the employee's own comprehensive wage stands anyway
        insuredWageAsBefore: insuranceComprehensiveWage === null ? (insuredPay?.asBefore ?? null) : null,
        insurableLimits: insurableWageLimits(law),
      }),
      photoId: photos?.get(id)?.id ?? null,
      photoCrop: photos?.get(id)?.crop ?? null,
      // `leads` on the current employment; an ended one's is null
      employment: current && { ...current, leads },
      employments: history.map((x) => ({ ...x, leads: x === current ? leads : null })),
      // with where each stands, a trainee or an intern as such (19 October 2026)
      reports: managing.map((m) => ({ ...m.employee, status: m.status, standing: employmentStanding(m), jobTitle: m.jobTitle })),
      ...(identity && { identity: maskedIdentity(idRow) }),
      ...(bank && { bank: maskedBank(bankRow) }),
      completeness: completeness({
        employee: own,
        identity: idRow,
        bank: bankRow,
        employment: current,
        latestType: history[0]?.employmentType ?? null,
        topRank,
        papers: papers.get(id) ?? [],
      }),
      confirmation: confirmationView(confirmed ?? null, own),
      changeRequests,
      // the end of the person's last training or internship agreement and the first day a new one may start (owner, 19
      // October 2026: "a new trainee contract can be issued after 6 months of the expiration of the last trainee
      // contract"); null when they never had one
      nextTraining: lastEnded && { lastEnded, from: trainingAgainFrom(lastEnded) },
      access: { edit: editsEmployees(user), delete: deletesEmployees(user), identity, bank },
      isSelf: self,
      // C-level (owner, 19 October 2026): seen in full here by the CEO, a Super Admin or the person themself
      confidential: await this.confidential.isConfidential(id),
      restricted: false as const,
    };
  }

  /**
   * A C-level person as those who may not see them get them (owner, 19 October 2026: "make C level Employees details
   * not visible to HR"): the directory card (name, photo, job title, department or team, work email, code and where
   * they stand) and the note that only the CEO and the Super Admin see the rest. Nothing to change, nothing to open.
   */
  private async card(id: string, user: SessionUser) {
    const e = await this.prisma.employee.findFirst({
      where: { AND: [{ id }, await this.visibleTo(user)] },
      select: {
        id: true,
        employeeCode: true,
        fullNameEn: true,
        fullNameAr: true,
        displayName: true,
        workEmail: true,
        employments: CARD_EMPLOYMENT,
        _count: { select: { employments: true } },
      },
    });
    if (!e) throw new NotFoundException('Employee not found.');
    const { employments: [current], _count, ...own } = e;
    const photos = seesEmployeeFile(user) ? await this.photos([id]) : null;
    return {
      ...own,
      photoId: photos?.get(id)?.id ?? null,
      photoCrop: photos?.get(id)?.crop ?? null,
      standing: (current ? employmentStanding(current) : _count.employments ? 'former' : 'not_employed') as Standing,
      employment: current ? { id: current.id, status: current.status, department: current.department, jobTitle: current.jobTitle } : null,
      confidential: true as const,
      restricted: true as const,
      note: CONFIDENTIAL_NOTE,
      access: { edit: false, delete: false, identity: false, bank: false },
      isSelf: false,
    };
  }

  /**
   * The contract pay the Social Insurance tab's insured wage stands on today, for the employment it is about: its signed
   * contract's, or after a raise the one before it until the raise's insured-wage date (owner's decision, 16 October
   * 2026: "From the next January unless amended in Form 2"), as payroll takes it.
   */
  private async insuredPay(e: { id: string; contract: { id: string } | null } | null) {
    if (!e?.contract) return insuredContractPay(null, [], todayInCairo());
    const rows = await this.prisma.contract.findMany({ where: { employmentId: e.id, status: { not: 'draft' } }, select: INSURED_VERSION });
    const versions = rows.map(insuredVersionOf);
    return insuredContractPay(versions.find((v) => v.id === e.contract!.id) ?? null, versions, todayInCairo());
  }

  /**
   * Each employee's picture, for those who see the employee file it is kept in (HR, CEO): the personal photo uploaded
   * last as an image, as its paper's id by employee, with the square of it HR chose to show in the circle (owner's
   * request, 16 October 2026), or null for the whole photo. The others see initials.
   */
  private async photos(employeeIds: string[]): Promise<Map<string, { id: string; crop: PhotoCrop | null }>> {
    const items = await this.prisma.paperworkItem.findMany({
      where: { ...PHOTO, employeeId: { in: employeeIds } },
      select: { id: true, employeeId: true, photoCrop: true },
      orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
    });
    const latest = new Map<string, { id: string; crop: PhotoCrop | null }>();
    for (const item of items) if (!latest.has(item.employeeId)) latest.set(item.employeeId, { id: item.id, crop: storedCrop(item.photoCrop) });
    return latest;
  }

  /** The full national ID (restricted): every call is written to the audit log. */
  async identity(id: string, user: SessionUser) {
    await this.row(id);
    const row = await this.prisma.employeeIdentity.findUnique({ where: { employeeId: id } });
    await this.audit.record({ userId: user.id, action: 'view_restricted', entityType: ENTITY, entityId: id, diff: { fields: ['nationalId', 'printedNo'] } });
    return identityView(row);
  }

  /**
   * The full bank details (restricted): every call is written to the audit log. With the bank's BIC code from the
   * EG-ACH list, or null for a bank not on it.
   */
  async bank(id: string, user: SessionUser) {
    await this.row(id);
    const row = await this.prisma.employeeBank.findUnique({ where: { employeeId: id } });
    await this.audit.record({ userId: user.id, action: 'view_restricted', entityType: ENTITY, entityId: id, diff: { fields: ['accountNo', 'iban'] } });
    return { ...bankView(row), bankBic: bankNamed(row?.bankName)?.bic ?? null };
  }

  /**
   * Adds a profile, with the national ID details when sent (e.g. read from the ID card first): everything is checked
   * before anything is saved, and the profile and the national ID are saved together or not at all. Employment is
   * added afterwards (EmploymentsService), so a profile can exist before a hire and stays after one ends.
   */
  async create(dto: CreateEmployeeDto, user: SessionUser) {
    const { employeeCode: code, identity: sentIdentity, ...given } = dto;
    assertSetsWages(user, dto);
    const employeeCode = code ?? (await this.nextCode());
    await this.assertCompanyDomain(dto.workEmail);
    await this.assertFree({ employeeCode, workEmail: dto.workEmail, insuranceNo: dto.insuranceNo });
    const derived = await this.checked(null, dto);
    // national ID details with nothing filled in are not saved at all
    const identity = sentIdentity && Object.values(sentIdentity).some((v) => v !== null && v !== undefined) ? sentIdentity : null;
    const dateOfBirth = identity ? await this.checkedIdentity({ id: null, dateOfBirth: dto.dateOfBirth ?? null }, null, identity) : undefined;
    const values = { ...given, employeeCode, ...derived, ...(dateOfBirth && { dateOfBirth }) };

    const e = await this.prisma.$transaction(async (tx) => {
      const row = await tx.employee.create({ data: toData(values) });
      if (identity) await tx.employeeIdentity.create({ data: { employeeId: row.id, ...identityData(identity) } });
      return row;
    });
    const { id: _id, createdAt: _c, updatedAt: _u, ...created } = wagesMasked(fields(e));
    const diff = identity ? { ...created, identity: identityChanges(null, identity) } : created;
    await this.audit.record({ userId: user.id, action: 'create', entityType: ENTITY, entityId: e.id, diff });
    return this.get(e.id, user);
  }

  async update(id: string, dto: UpdateEmployeeDto, user: SessionUser) {
    await this.edit(id, dto, user);
    return this.get(id, user);
  }

  /**
   * What update() does to the profile, checked and audited, without answering the profile. Also how an employee's
   * change request is made once HR or an Admin approves it (the confirmations module), so it is checked and audited
   * as HR's own edit; an Admin may approve without seeing the profile.
   */
  async edit(id: string, dto: UpdateEmployeeDto, user: SessionUser): Promise<void> {
    assertSetsWages(user, dto);
    const before = await this.row(id);
    const values = await this.updateValues(before, dto);

    await this.prisma.employee.update({ where: { id }, data: toData(values) });
    const diff = wagesMasked(changes(fields(before), values));
    if (Object.keys(diff).length) await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, entityId: id, diff });
  }

  async updateIdentity(id: string, dto: UpdateIdentityDto, user: SessionUser) {
    const employee = await this.row(id);
    const before = await this.prisma.employeeIdentity.findUnique({ where: { employeeId: id } });
    const dateOfBirth = await this.checkedIdentity({ id, dateOfBirth: fromDateOnly(employee.dateOfBirth) }, before, dto);

    const data = identityData(dto);
    const row = await this.prisma.$transaction(async (tx) => {
      if (dateOfBirth) await tx.employee.update({ where: { id }, data: { dateOfBirth: toDateOnly(dateOfBirth) } });
      return tx.employeeIdentity.upsert({ where: { employeeId: id }, update: data, create: { employeeId: id, ...data } });
    });

    const diff = identityChanges(before, dto);
    if (dateOfBirth) diff.dateOfBirth = { from: null, to: dateOfBirth };
    if (Object.keys(diff).length) await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, entityId: id, diff: { identity: diff } });
    return maskedIdentity(row);
  }

  async updateBank(id: string, dto: UpdateBankDto, user: SessionUser) {
    await this.row(id);
    const before = await this.prisma.employeeBank.findUnique({ where: { employeeId: id } });
    assertAccountFitsBank(before, dto);
    const data = { bankName: dto.bankName, branch: dto.branch, accountNo: dto.accountNo, iban: dto.iban, holderName: dto.holderName };
    const row = await this.prisma.employeeBank.upsert({ where: { employeeId: id }, update: data, create: { employeeId: id, ...data } });

    const diff = restrictedChanges(changes(bankView(before), dto as Record<string, unknown>), ['accountNo', 'iban']);
    if (Object.keys(diff).length) await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, entityId: id, diff: { bank: diff } });
    return maskedBank(row);
  }

  /**
   * Deletes a profile added by mistake, with its employments: a Super Admin only (owner's decision, 15 October 2026).
   * Not while it is anyone's manager on record.
   */
  async remove(id: string, user: SessionUser) {
    assertDeletes(user);
    const e = await this.row(id);
    const now = await this.prisma.employment.count({ where: { managerId: id, endDate: null } });
    if (now > 0) {
      throw new ConflictException(`${now} employee(s) report to ${e.fullNameEn}. Choose another manager for them before deleting.`);
    }
    const before = await this.prisma.employment.count({ where: { managerId: id } });
    if (before > 0) {
      throw new ConflictException(`${e.fullNameEn} is the manager on record of ${before} past employment(s), so the profile is kept.`);
    }
    await this.prisma.employee.delete({ where: { id } });
    await this.audit.record({
      userId: user.id,
      action: 'delete',
      entityType: ENTITY,
      entityId: id,
      diff: { employeeCode: e.employeeCode, fullNameEn: e.fullNameEn },
    });
  }

  /**
   * Checks a change of the profile as update() would, without saving it: for an employee's change request, checked
   * when it is sent (the work email's domain, numbers already taken, the checks across fields …).
   */
  async checkUpdate(id: string, dto: UpdateEmployeeDto): Promise<void> {
    await this.updateValues(await this.row(id), dto);
  }

  // ---------- helpers ----------

  /** A change of the profile, checked: the values to save (with those that follow from them). */
  private async updateValues(before: Employee, dto: UpdateEmployeeDto) {
    const { employeeCode, ...rest } = dto;
    // only a new work email is checked: one on file that is not changed never stops other fields being saved
    const workEmail = dto.workEmail !== before.workEmail ? dto.workEmail : undefined;
    await this.assertCompanyDomain(workEmail);
    const insuranceNo = dto.insuranceNo !== before.insuranceNo ? dto.insuranceNo : undefined;
    await this.assertFree({ employeeCode: employeeCode !== before.employeeCode ? employeeCode : undefined, workEmail, insuranceNo }, before.id);
    const derived = await this.checked(before, dto);
    return { ...rest, ...(employeeCode ? { employeeCode } : {}), ...derived }; // the code cannot be emptied
  }

  /** A profile's change requests: the one waiting first, then the 10 decided or cancelled most recently. */
  private async changeRequestsOf(employeeId: string) {
    const [waiting, closed] = await Promise.all([
      this.prisma.profileChangeRequest.findMany({ where: { employeeId, status: 'pending' }, orderBy: { requestedAt: 'desc' }, include: REQUEST_INCLUDE }),
      this.prisma.profileChangeRequest.findMany({
        where: { employeeId, status: { not: 'pending' } },
        orderBy: [{ decidedAt: { sort: 'desc', nulls: 'last' } }, { requestedAt: 'desc' }],
        take: 10,
        include: REQUEST_INCLUDE,
      }),
    ]);
    return [...waiting, ...closed].map(changeRequestView);
  }

  /** Which employees this user may see (spec §1: row-level access). Also used for their contracts. */
  async visibleTo(user: SessionUser): Promise<Prisma.EmployeeWhereInput> {
    if (seesEveryone(user)) return {};
    const me = await (user.employeeId ? this.prisma.employee.findUnique({ where: { id: user.employeeId }, select: { id: true } }) : null);
    if (!me) return { id: { in: [] } };
    if (!user.roles.includes('manager')) return { id: me.id };
    // a manager sees themself and the people whose current employment reports to them
    return { OR: [{ id: me.id }, { employments: { some: { managerId: me.id, endDate: null } } }] };
  }

  private async row(id: string): Promise<Employee> {
    const e = await this.prisma.employee.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('Employee not found.');
    return e;
  }

  /** The next free EMP-#### code: one more than the highest number in use. */
  private async nextCode(): Promise<string> {
    const [{ max }] = await this.prisma.$queryRaw<{ max: number | null }[]>`
      SELECT max(substring(employee_code from 5)::int) AS max FROM employees WHERE employee_code ~ '^EMP-[0-9]+$'`;
    return `EMP-${String((max ?? 0) + 1).padStart(4, '0')}`;
  }

  private async assertFree(values: { employeeCode?: string | null; workEmail?: string | null; insuranceNo?: string | null }, exceptId?: string) {
    const not = exceptId ? { id: { not: exceptId } } : {};
    if (values.employeeCode) {
      const taken = await this.prisma.employee.findFirst({ where: { employeeCode: values.employeeCode, ...not }, select: { fullNameEn: true } });
      if (taken) throw new ConflictException(`The code ${values.employeeCode} already belongs to ${taken.fullNameEn}.`);
    }
    if (values.workEmail) {
      const taken = await this.prisma.employee.findFirst({ where: { workEmail: values.workEmail, ...not }, select: { employeeCode: true } });
      if (taken) throw new ConflictException(`The work email ${values.workEmail} already belongs to ${taken.employeeCode}.`);
    }
    if (values.insuranceNo) {
      const taken = await this.prisma.employee.findFirst({ where: { insuranceNo: values.insuranceNo, ...not }, select: { employeeCode: true } });
      if (taken) throw new ConflictException(`The social insurance number ${values.insuranceNo} already belongs to ${taken.employeeCode}.`);
    }
  }

  /** A work email must use the company's email domain (e.g. @trendlix.com), when the company profile sets one. */
  private async assertCompanyDomain(workEmail: string | null | undefined) {
    if (!workEmail) return;
    // the company profile is the one row with id 1; no row or no domain: any domain is accepted
    const company = await this.prisma.company.findUnique({ where: { id: 1 }, select: { emailDomain: true } });
    const domain = company?.emailDomain;
    if (domain && !workEmail.endsWith(`@${domain}`)) throw new BadRequestException(`The work email must end in @${domain}.`);
  }

  /** Checks of the profile that span several fields or records, and the values that follow from them. */
  private async checked(before: Employee | null, dto: CreateEmployeeDto | UpdateEmployeeDto) {
    const derived: { militaryStatus?: string } = {};
    const current = before ? fields(before) : null;

    // a woman's military status is always Not applicable, so no military papers are needed (owner's rule)
    const gender = dto.gender !== undefined ? dto.gender : (before?.gender ?? null);
    if (gender === 'female') {
      if (dto.militaryStatus && dto.militaryStatus !== 'not_applicable') {
        throw new BadRequestException('Military status applies to men only. For a woman it is Not applicable.');
      }
      if ((dto.militaryStatus ?? before?.militaryStatus ?? null) !== 'not_applicable') derived.militaryStatus = 'not_applicable';
    }

    const dateOfBirth = dto.dateOfBirth !== undefined ? dto.dateOfBirth : current?.dateOfBirth;
    if (dateOfBirth && dateOfBirth > todayInCairo()) throw new BadRequestException('The date of birth cannot be in the future.');
    if (before && dto.dateOfBirth && dto.dateOfBirth !== current!.dateOfBirth) {
      const identity = await this.prisma.employeeIdentity.findUnique({ where: { employeeId: before.id }, select: { nationalId: true } });
      const born = identity?.nationalId ? birthDateFromNationalId(identity.nationalId) : null;
      if (born && born !== dto.dateOfBirth) {
        throw new BadRequestException(`The national ID on file gives a birth date of ${born}. Check the date of birth, or correct the national ID first.`);
      }
    }

    return derived;
  }

  /**
   * The national ID checks, for a new employee (`id` null) or one on file: the ID holds a real birth date, which must
   * match the date of birth on the profile; no other employee has the same ID; and the card expires after it was
   * issued. Returns the date of birth to fill in from the ID when the profile has none.
   */
  private async checkedIdentity(
    employee: { id: string | null; dateOfBirth: string | null },
    before: EmployeeIdentity | null,
    dto: UpdateIdentityDto,
  ): Promise<string | undefined> {
    const { issueDate, expiryDate } = { ...identityView(before), ...withoutUndefined(dto) };
    let dateOfBirth: string | undefined;

    if (dto.nationalId) {
      const born = birthDateFromNationalId(dto.nationalId);
      if (!born) throw new BadRequestException('This national ID holds no real birth date (digits 2–7 are YYMMDD). Check it against the card.');
      if (employee.dateOfBirth && employee.dateOfBirth !== born) {
        throw new BadRequestException(`The national ID gives a birth date of ${born}, but the profile says ${employee.dateOfBirth}. Check both.`);
      }
      if (!employee.dateOfBirth) dateOfBirth = born; // filled in from the ID
      const other = await this.prisma.employeeIdentity.findFirst({
        where: { nationalId: dto.nationalId, ...(employee.id && { employeeId: { not: employee.id } }) },
        select: { employee: { select: { employeeCode: true } } },
      });
      if (other) throw new ConflictException(`Another employee (${other.employee.employeeCode}) already has this national ID.`);
    }
    if (issueDate && expiryDate && expiryDate <= issueDate) {
      throw new BadRequestException('The ID must expire after it was issued.');
    }
    return dateOfBirth;
  }
}
