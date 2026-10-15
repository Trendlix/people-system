import { insuredWageOf, type OfferShownStatus } from '@trendlix/shared';
import { ALLOWANCE_ORDER, allowancesTotal, allowanceView } from '../allowances/rows.js';
import { fromDateOnly } from '../common/date-only.js';
import { departmentName } from '../contracts/views.js';
import type { MissingTag } from '../documents/values.js';
import type { Prisma } from '../generated/prisma/client.js';
import { shownStatus } from './rules.js';

// Job offers as the API sends them (dates as YYYY-MM-DD, timestamps as ISO, money as numbers): never the files, which
// have their own endpoints, nor the link's secret. The terms are restricted like a contract's: null for anyone but HR,
// Finance and the CEO, with `salaryHidden: true`.

/** An employee as an offer names them. */
const PERSON = { select: { id: true, employeeCode: true, fullNameEn: true } } as const;

/** Everything an offer is shown with, besides its own columns. */
export const OFFER_INCLUDE = {
  employee: PERSON,
  department: { select: { id: true, nameEn: true, nameAr: true, parent: { select: { id: true, nameEn: true, nameAr: true } } } },
  jobTitle: { select: { id: true, titleEn: true, titleAr: true } },
  // the grade's Arabic level, the manager's Arabic name and the shift's times are for the document's tags (owner's
  // request, 15 October 2026)
  grade: { select: { id: true, code: true, levelEn: true, levelAr: true } },
  manager: { select: { id: true, employeeCode: true, fullNameEn: true, fullNameAr: true } },
  shift: { select: { id: true, code: true, workingDays: true, startTime: true, endTime: true } },
  allowances: { orderBy: ALLOWANCE_ORDER },
  templateVersion: { select: { version: true, tags: true } },
  sentBy: { select: { email: true } },
  answeredBy: { select: { email: true } },
  createdBy: { select: { email: true } },
} satisfies Prisma.JobOfferInclude;

/** The filled document is loaded only when it is sent or copied. */
export const WITHOUT_FILES = { data: true, pdf: true } satisfies Prisma.JobOfferOmit;

export type OfferRow = Prisma.JobOfferGetPayload<{ include: typeof OFFER_INCLUDE; omit: typeof WITHOUT_FILES }>;

/** What an offer is shown with, besides its row. */
export interface OfferContext {
  /** HR, Finance and the CEO see the terms' amounts (see seesSalary). */
  seesSalary: boolean;
  /** The employment type's job offer template, as the template library has it now. */
  template: { slotKey: string; name: string; status: 'published' | 'draft' | 'missing'; version: number | null };
  /**
   * While the template has no published version, the newest draft's: a draft offer is previewed with it meanwhile (its
   * document only: sending needs a published one). Shown as `template.previewVersion`.
   */
  previewVersion: number | null;
  /** A draft's: what its template prints that the offer has no value for; [] otherwise. */
  missing: MissingTag[];
  /** Whether the stored document has its PDF. */
  hasPdf: boolean;
  emailConfigured: boolean;
  pdfAvailable: boolean;
}

/** The money an offer's terms come to: its allowances, their total, the total a month, and the insured wage. */
export function offerPay(o: Pick<OfferRow, 'grossSalary' | 'joinDate' | 'allowances'>) {
  const allowances = o.allowances.map(allowanceView);
  const gross = o.grossSalary.toNumber();
  const total = allowancesTotal(allowances);
  return {
    allowances,
    allowancesTotal: total,
    totalSalary: Math.round((gross + total) * 100) / 100,
    insuredSalary: insuredWageOf(gross, allowances, Number(fromDateOnly(o.joinDate).slice(0, 4))),
  };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function offerView(o: OfferRow, ctx: OfferContext) {
  const pay = offerPay(o);
  const sees = ctx.seesSalary;
  return {
    id: o.id,
    number: o.number,
    status: shownStatus(o) as OfferShownStatus,
    fullNameEn: o.fullNameEn,
    fullNameAr: o.fullNameAr,
    email: o.email,
    mobile: o.mobile,
    employeeId: o.employeeId,
    employee: o.employee,
    employmentType: o.employmentType,
    department: o.department,
    jobTitle: o.jobTitle,
    grade: o.grade,
    manager: o.manager,
    shift: o.shift && { id: o.shift.id, code: o.shift.code, workingDays: o.shift.workingDays },
    workArrangement: o.workArrangement,
    officeDays: [...o.officeDays].sort((a, b) => a - b),
    joinDate: fromDateOnly(o.joinDate),
    payBasis: o.payBasis,
    grossSalary: sees ? o.grossSalary.toNumber() : null,
    hourlyRate: sees ? (o.hourlyRate?.toNumber() ?? null) : null,
    hoursPerWeek: o.hoursPerWeek?.toNumber() ?? null,
    daysPerWeek: o.daysPerWeek,
    basicPercent: o.basicPercent,
    netSalary: sees ? (o.netSalary?.toNumber() ?? null) : null,
    insuredSalary: sees ? pay.insuredSalary : null,
    allowances: sees ? pay.allowances : null,
    allowancesTotal: sees ? pay.allowancesTotal : null,
    totalSalary: sees ? pay.totalSalary : null,
    salaryHidden: !sees,
    probationMonths: o.probationMonths,
    durationMonths: o.durationMonths,
    expiresOn: fromDateOnly(o.expiresOn),
    message: o.message,
    note: o.note,
    template: { ...ctx.template, previewVersion: ctx.previewVersion },
    missing: ctx.missing,
    document: o.fileName ? { fileName: o.fileName, hasPdf: ctx.hasPdf, documentDate: fromDateOnly(o.documentDate) } : null,
    sentVia: o.sentVia,
    sentTo: o.sentTo,
    sentAt: iso(o.sentAt),
    sentBy: o.sentBy,
    sentCount: o.sentCount,
    viewedAt: iso(o.viewedAt),
    respondedAt: iso(o.respondedAt),
    answeredBy: o.answeredBy,
    acceptedName: o.acceptedName,
    declineReason: o.declineReason,
    withdrawnAt: iso(o.withdrawnAt),
    withdrawReason: o.withdrawReason,
    hiredAt: iso(o.hiredAt),
    emailConfigured: ctx.emailConfigured,
    pdfAvailable: ctx.pdfAvailable,
    createdAt: o.createdAt.toISOString(),
    createdBy: o.createdBy,
  };
}

export type OfferView = ReturnType<typeof offerView>;

/** What the offers list loads with each offer. */
export const OFFER_LIST_SELECT = {
  id: true,
  number: true,
  status: true,
  fullNameEn: true,
  fullNameAr: true,
  email: true,
  employmentType: true,
  jobTitle: { select: { titleEn: true, titleAr: true } },
  department: { select: { nameEn: true, parent: { select: { nameEn: true } } } },
  joinDate: true,
  grossSalary: true,
  allowances: { select: { amount: true } },
  expiresOn: true,
  sentAt: true,
  respondedAt: true,
  employeeId: true,
} satisfies Prisma.JobOfferSelect;

type OfferListRow = Prisma.JobOfferGetPayload<{ select: typeof OFFER_LIST_SELECT }>;

/** An offer in the list (GET /offers): a team as "Department › Team". */
export function offerListView(o: OfferListRow, seesSalary: boolean) {
  const gross = o.grossSalary.toNumber();
  const total = allowancesTotal(o.allowances.map((a) => ({ amount: a.amount.toNumber() })));
  return {
    id: o.id,
    number: o.number,
    status: shownStatus(o) as OfferShownStatus,
    fullNameEn: o.fullNameEn,
    fullNameAr: o.fullNameAr,
    email: o.email,
    employmentType: o.employmentType,
    jobTitle: o.jobTitle,
    departmentName: departmentName(o.department),
    joinDate: fromDateOnly(o.joinDate),
    grossSalary: seesSalary ? gross : null,
    totalSalary: seesSalary ? Math.round((gross + total) * 100) / 100 : null,
    salaryHidden: !seesSalary,
    expiresOn: fromDateOnly(o.expiresOn),
    sentAt: iso(o.sentAt),
    respondedAt: iso(o.respondedAt),
    employeeId: o.employeeId,
  };
}

/**
 * The offer as the candidate sees it on the offer's page, by the link: no amounts (the document has them), nothing
 * for HR only.
 */
export function publicOfferView(
  o: Pick<OfferRow, 'number' | 'status' | 'fullNameEn' | 'fullNameAr' | 'employmentType' | 'joinDate' | 'expiresOn' | 'message' | 'fileName' | 'respondedAt' | 'acceptedName'> & {
    jobTitle: { titleEn: string; titleAr: string | null } | null;
  },
  ctx: { company: { nameEn: string; nameAr: string | null } | null; hasPdf: boolean },
) {
  return {
    number: o.number,
    status: shownStatus(o) as OfferShownStatus,
    fullNameEn: o.fullNameEn,
    fullNameAr: o.fullNameAr,
    jobTitleEn: o.jobTitle?.titleEn ?? null,
    jobTitleAr: o.jobTitle?.titleAr ?? null,
    employmentType: o.employmentType,
    joinDate: fromDateOnly(o.joinDate),
    expiresOn: fromDateOnly(o.expiresOn),
    companyNameEn: ctx.company?.nameEn ?? null,
    companyNameAr: ctx.company?.nameAr ?? null,
    message: o.message,
    document: o.fileName ? { hasPdf: ctx.hasPdf } : null,
    respondedAt: iso(o.respondedAt),
    acceptedName: o.acceptedName,
  };
}
