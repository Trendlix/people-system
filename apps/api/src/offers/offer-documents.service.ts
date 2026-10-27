import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { offerSlotFor, TEMPLATE_SLOTS, type LawRates, type TemplateLanguage, type TemplateSlot } from '@trendlix/shared';
import { fromDateOnly, toDateOnly, todayInCairo } from '../common/date-only.js';
import { INSURANCE_BASIC_DEFAULT } from '../contracts/contract-settings.service.js';
import { isBlankValue } from '../documents/engine/index.js';
import { filledFileName, FILLED_FROM, fillVersion, requiredTags } from '../documents/fill-version.js';
import { documentStem } from '../documents/format.js';
import { TYPED_TAGS } from '../documents/offer.js';
import { previewValues } from '../documents/preview.js';
import { missingTags, resolveValues, restrictedTags, type MissingTag, type RestrictedRight, type ValueSources } from '../documents/values.js';
import { Prisma } from '../generated/prisma/client.js';
import { LawRatesService } from '../payroll/law-rates/law-rates.service.js';
import { pdfName, PdfService } from '../pdf/pdf.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { offerMissing, offerSlot, termDates } from './rules.js';
import { offerPay, type OfferContext, type OfferRow } from './views.js';

/** The message of the 422 when the template prints values the offer doesn't have. */
export const FILL_IN = 'Fill in the missing details first.';

/** The published version an offer is filled in from; a PDF form's fields say which tags may be left blank. */
const PUBLISHED = { id: true, version: true, language: true, tags: true, format: true, pdfFields: true } satisfies Prisma.TemplateVersionSelect;

/** A filled job offer: the .docx (or, from a PDF form, the PDF), its name, and the version it was filled in from. */
export interface FilledOffer {
  data: Buffer;
  fileName: string;
  templateVersionId: string;
  templateVersion: number;
  /** The restricted tags it prints (the terms' amounts): every view of it by HR or the CEO is audited. */
  restricted: string[];
}

/**
 * A ValueSources for an offer, as if the candidate were an employee with a draft contract made from it: the candidate's
 * name, mobile and email (as the personal email; a former employee's code); no address, and none of what an
 * employee's Social Insurance tab holds (the occupation, the subscription start and the wages: owner, 16 October 2026;
 * the basic wage is then the contract settings' default, `insuranceBasicDefault`); the position as the employment, with
 * the selected role's duties (`jdDuties`, its job title's, as saved: owner's request, 15 October 2026), the manager, the
 * shift and the work arrangement; the terms as contract version 1, numbered with the offer's number, starting on the
 * join date; the offer's number and last day; the company's details.
 */
export function offerSources(
  o: OfferRow,
  company: ValueSources['company'],
  language: TemplateLanguage,
  documentDate: string,
  lawYears: readonly LawRates[],
  jdDuties: string | null = null,
  insuranceBasicDefault = INSURANCE_BASIC_DEFAULT,
): ValueSources {
  const joinDate = fromDateOnly(o.joinDate);
  const { endDate, probationEnd } = termDates(joinDate, o.durationMonths, o.probationMonths);
  const pay = offerPay(o, lawYears);
  return {
    language,
    employee: {
      employeeCode: o.employee?.employeeCode ?? '',
      fullNameEn: o.fullNameEn,
      fullNameAr: o.fullNameAr,
      displayName: null,
      nationality: null,
      gender: null,
      dateOfBirth: null,
      addressAr: null,
      city: null,
      governorate: null,
      buildingNo: null,
      mobile: o.mobile,
      workEmail: null,
      personalEmail: o.email,
      qualificationAr: null,
      insuranceNo: null,
      occupationCode: null,
      insuranceStartDate: null,
      insuranceBasicWage: null,
      insuranceComprehensiveWage: null,
    },
    identity: null,
    bank: null,
    employment: {
      employmentType: o.employmentType,
      joinDate: o.joinDate,
      jobTitle: o.jobTitle && { titleEn: o.jobTitle.titleEn, titleAr: o.jobTitle.titleAr, jdDuties },
      department: o.department && { nameEn: o.department.nameEn, nameAr: o.department.nameAr },
      grade: o.grade && { code: o.grade.code, levelEn: o.grade.levelEn, levelAr: o.grade.levelAr },
      manager: o.manager && { fullNameEn: o.manager.fullNameEn, fullNameAr: o.manager.fullNameAr },
      shift: o.shift && { startTime: o.shift.startTime, endTime: o.shift.endTime, hoursPerDay: o.shift.hoursPerDay, workingDays: o.shift.workingDays },
      workArrangement: o.workArrangement,
      paidByCommission: o.paidByCommission,
      workNature: o.workNature,
    },
    contract: {
      number: o.number,
      form: 'fixed',
      status: 'draft',
      startDate: o.joinDate,
      endDate: toDateOnly(endDate),
      durationMonths: o.durationMonths,
      probationMonths: o.probationMonths,
      probationEnd: probationEnd ? toDateOnly(probationEnd) : null,
      grossSalary: o.grossSalary,
      basicPercent: o.basicPercent,
      netSalary: o.netSalary,
      insuredSalary: new Prisma.Decimal(pay.insuredSalary),
      jobTitleEn: null,
      jobTitleAr: null,
      gradeCode: null,
      payBasis: o.payBasis,
      hourlyRate: o.hourlyRate,
      hoursPerWeek: o.hoursPerWeek,
      hourlyMinimum: o.hourlyMinimum,
      daysPerWeek: o.daysPerWeek,
      allowances: o.allowances,
    },
    ending: null,
    offer: { number: o.number, expiresOn: o.expiresOn },
    company,
    insuranceBasicDefault,
    lawYears,
    documentDate,
    inputs: {},
  };
}

// The job offer document (owner's request, 15 October 2026): the employment type's published job offer template,
// filled in with the offer's values by the same engine as an employee's documents. A draft is filled in afresh each
// time it is previewed; sending keeps the copy sent, the Word file and its protected PDF. It is given out only as
// that protected PDF (owner's request, 15 October 2026: "No doc file export, just a protected PDF").
@Injectable()
export class OfferDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly lawRates: LawRatesService,
  ) {}

  /**
   * The job offer slot an offer is filled from (owner, 18 October 2026: Sales became Full-time paid by commission): for
   * a full-time offer paid by commission, the commission one (offer_sales) while it has a published version, else the
   * employment type's (shared offerSlotFor).
   */
  async slotOf(o: Pick<OfferRow, 'employmentType' | 'paidByCommission'>): Promise<TemplateSlot> {
    const commission = o.paidByCommission && o.employmentType === 'full_time' && (await this.prisma.templateVersion.count({ where: { slotKey: 'offer_sales', status: 'published' } })) > 0;
    const key = offerSlotFor(o.employmentType, o.paidByCommission, () => commission);
    return TEMPLATE_SLOTS.find((s) => s.key === key) ?? offerSlot(o.employmentType);
  }

  /** The offer's job offer template (slotOf) as the library has it now: published (with its version), a draft only, or missing. */
  async template(o: Pick<OfferRow, 'employmentType' | 'paidByCommission'>): Promise<OfferContext['template']> {
    const slot = await this.slotOf(o);
    const versions = await this.prisma.templateVersion.findMany({
      where: { slotKey: slot.key, status: { in: ['draft', 'published'] } },
      select: { version: true, status: true },
    });
    const published = versions.find((v) => v.status === 'published') ?? null;
    return { slotKey: slot.key, name: slot.name, status: published ? 'published' : versions.length ? 'draft' : 'missing', version: published?.version ?? null };
  }

  /** A draft's empty values (none without a published template: `template.status` says so). */
  async missing(o: OfferRow): Promise<MissingTag[]> {
    const slot = await this.slotOf(o);
    const template = await this.published(slot);
    if (!template) return [];
    return (await this.check(o, slot, template, todayInCairo())).missing;
  }

  /**
   * The offer filled in on `documentDate`. Refused (409) without a published template for its employment type, and
   * (422, with what is missing and where to fill it in) while the template prints a value the offer doesn't have.
   */
  async fill(o: OfferRow, documentDate: string): Promise<FilledOffer> {
    const slot = await this.slotOf(o);
    const template = await this.published(slot, true);
    if (!template) throw new ConflictException(`Publish the ${slot.name} template first (Templates).`);
    const { values, missing } = await this.check(o, slot, template, documentDate);
    if (missing.length) throw new UnprocessableEntityException({ statusCode: 422, message: FILL_IN, missing });
    return {
      data: await fillVersion(template, values),
      fileName: this.fileName(o, template.format, slot),
      templateVersionId: template.id,
      templateVersion: template.version,
      restricted: restrictedTags(template.tags, slot.overrides),
    };
  }

  /**
   * A given template version (a draft too) filled in with the offer's values, as fill() works them out, for the
   * template library's preview (owner's request, 15 October 2026: "Job offer preview should call data from the offer
   * tab, even if not published yet"): nothing refused and nothing saved. An empty value prints as its label in square
   * brackets (in a PDF form's optional field, blank), a restricted one the caller may not see (`may`) as ••••; read through `slot`'s overrides. Without the
   * file, only how many of its tags have a value; `shown`: the restricted tags printed with their value, for the audit log.
   */
  async previewFill(
    o: OfferRow,
    slot: TemplateSlot,
    template: { language: string; tags: string[]; data?: Uint8Array; format?: string; pdfFields?: Prisma.JsonValue | null },
    may: Readonly<Record<RestrictedRight, boolean>>,
  ): Promise<{ filled: number; total: number; shown: string[]; data: Buffer | null }> {
    const { values } = await this.check(o, slot, template, todayInCairo());
    // every tag with no value, those optional fields print too; nothing is typed for a preview
    const empty = new Set([...template.tags.filter((tag) => isBlankValue(values[tag])), ...TYPED_TAGS]);
    const preview = previewValues(template.tags, values, empty, slot.overrides, may);
    // a PDF form's optional fields with no value print blank, as on the document
    const data = template.data
      ? await fillVersion({ ...template, slotKey: slot.key, format: template.format ?? 'docx', data: template.data }, preview.values, new Set(preview.placeholders))
      : null;
    return { filled: preview.filled, total: preview.total, shown: data ? preview.shown : [], data };
  }

  /** "<Slot name> - <OFF number> - <full name>.docx" (.pdf from a PDF form), cleaned as documents' names are; the slot filled (slotOf). */
  fileName(o: Pick<OfferRow, 'employmentType' | 'number' | 'fullNameEn'>, format = 'docx', slot: TemplateSlot = offerSlot(o.employmentType)): string {
    return filledFileName(documentStem(slot.name, o.number, o.fullNameEn), format);
  }

  /** A Word file's PDF name. */
  pdfName(docxName: string): string {
    return pdfName(docxName);
  }

  /** The filled .docx as a protected PDF; null without a converter. Refused (503) when the converter fails. */
  toPdf(docx: Uint8Array, fileName: string): Promise<Buffer | null> {
    return this.pdf.protectedFromDocx(docx, fileName);
  }

  /** The PDF kept with a sent offer, protected (one kept before PDFs were protected is protected now). */
  storedPdf(pdf: Uint8Array): Promise<Buffer> {
    return this.pdf.protectedCopy(pdf);
  }

  get pdfAvailable(): boolean {
    return this.pdf.available;
  }

  /**
   * The values of the tags `template` prints for the offer on `documentDate`, and those still empty with where to fill
   * each in (on a PDF form, not those only optional fields print: owner, 15 October 2026). Also how OffersService
   * previews a draft offer with a draft of its template while none is published.
   */
  async check(o: OfferRow, slot: TemplateSlot, template: { language: string; tags: string[]; pdfFields?: Prisma.JsonValue | null }, documentDate: string) {
    const [company, role, settings, lawYears] = await Promise.all([
      this.prisma.company.findUnique({ where: { id: 1 } }),
      // the selected role's duties, read here rather than with every offer (the offer's view doesn't show them)
      o.jobTitleId ? this.prisma.jobTitle.findUnique({ where: { id: o.jobTitleId }, select: { jdDuties: true } }) : null,
      // the basic wage social insurance forms print by default (owner, 16 October 2026)
      this.prisma.contractSettings.findUnique({ where: { id: 1 }, select: { insuranceBasicDefault: true } }),
      // the rates set by law: the insured salary is within the join date's year's insurable limits
      this.lawRates.years(),
    ]);
    const basic = settings?.insuranceBasicDefault.toNumber();
    const sources = offerSources(o, company, template.language as TemplateLanguage, documentDate, lawYears, role?.jdDuties ?? null, basic);
    const values = resolveValues(sources, template.tags, slot.overrides);
    return { values, missing: offerMissing(missingTags(values, requiredTags(template), slot.overrides, true), slot.overrides) };
  }

  private published(slot: TemplateSlot): Promise<{ id: string; version: number; language: string; tags: string[]; format: string; pdfFields: Prisma.JsonValue | null } | null>;
  private published(
    slot: TemplateSlot,
    withFile: true,
  ): Promise<{ id: string; version: number; language: string; tags: string[]; format: string; data: Uint8Array; pdfFields: Prisma.JsonValue | null; slotKey: string } | null>;
  private published(slot: TemplateSlot, withFile = false): Promise<unknown> {
    return this.prisma.templateVersion.findFirst({
      where: { slotKey: slot.copyOf ?? slot.key, status: 'published' },
      select: withFile ? { ...PUBLISHED, ...FILLED_FROM } : PUBLISHED,
    });
  }
}
