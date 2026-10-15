import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { TemplateLanguage, TemplateSlot } from '@trendlix/shared';
import { fromDateOnly, toDateOnly, todayInCairo } from '../common/date-only.js';
import { fillTemplate } from '../documents/engine/index.js';
import { documentStem } from '../documents/format.js';
import { missingTags, resolveValues, restrictedTags, type MissingTag, type ValueSources } from '../documents/values.js';
import { Prisma } from '../generated/prisma/client.js';
import { PdfService } from '../pdf/pdf.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { templateFileName } from '../templates/template-file.js';
import { offerMissing, offerSlot, termDates } from './rules.js';
import { offerPay, type OfferContext, type OfferRow } from './views.js';

/** The message of the 422 when the template prints values the offer doesn't have. */
export const FILL_IN = 'Fill in the missing details first.';

/** The published version an offer is filled in from. */
const PUBLISHED = { id: true, version: true, language: true, tags: true } satisfies Prisma.TemplateVersionSelect;

/** A filled job offer: the .docx, its name, and the version it was filled in from. */
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
 * name and mobile (a former employee's code); the position as the employment, with the selected role's duties
 * (`jdDuties`, its job title's, as saved: owner's request, 15 October 2026); the terms as contract version 1, numbered
 * with the offer's number, starting on the join date; the offer's number and last day; the company's details.
 */
export function offerSources(
  o: OfferRow,
  company: ValueSources['company'],
  language: TemplateLanguage,
  documentDate: string,
  jdDuties: string | null = null,
): ValueSources {
  const joinDate = fromDateOnly(o.joinDate);
  const { endDate, probationEnd } = termDates(joinDate, o.durationMonths, o.probationMonths);
  const pay = offerPay(o);
  return {
    language,
    employee: {
      employeeCode: o.employee?.employeeCode ?? '',
      fullNameEn: o.fullNameEn,
      fullNameAr: o.fullNameAr,
      displayName: null,
      nationality: null,
      dateOfBirth: null,
      addressAr: null,
      city: null,
      governorate: null,
      mobile: o.mobile,
      workEmail: null,
      qualificationAr: null,
      insuranceNo: null,
    },
    identity: null,
    bank: null,
    employment: {
      employmentType: o.employmentType,
      joinDate: o.joinDate,
      jobTitle: o.jobTitle && { titleEn: o.jobTitle.titleEn, titleAr: o.jobTitle.titleAr, jdDuties },
      department: o.department && { nameEn: o.department.nameEn, nameAr: o.department.nameAr },
      grade: o.grade && { code: o.grade.code },
    },
    contract: {
      number: o.number,
      form: 'fixed',
      status: 'draft',
      startDate: o.joinDate,
      endDate: toDateOnly(endDate),
      durationMonths: o.durationMonths,
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
      daysPerWeek: o.daysPerWeek,
      allowances: o.allowances,
    },
    ending: null,
    offer: { number: o.number, expiresOn: o.expiresOn },
    company,
    documentDate,
    inputs: {},
  };
}

// The job offer document (owner's request, 15 October 2026): the employment type's published job offer template,
// filled in with the offer's values by the same engine as an employee's documents. A draft is filled in afresh each
// time it is previewed; sending keeps the copy sent (and its PDF, when the converter answers).
@Injectable()
export class OfferDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
  ) {}

  /** The employment type's job offer template as the library has it now: published (with its version), a draft only, or missing. */
  async template(employmentType: string): Promise<OfferContext['template']> {
    const slot = offerSlot(employmentType);
    const versions = await this.prisma.templateVersion.findMany({
      where: { slotKey: slot.key, status: { in: ['draft', 'published'] } },
      select: { version: true, status: true },
    });
    const published = versions.find((v) => v.status === 'published') ?? null;
    return { slotKey: slot.key, name: slot.name, status: published ? 'published' : versions.length ? 'draft' : 'missing', version: published?.version ?? null };
  }

  /** A draft's empty values (none without a published template: `template.status` says so). */
  async missing(o: OfferRow): Promise<MissingTag[]> {
    const slot = offerSlot(o.employmentType);
    const template = await this.published(slot);
    if (!template) return [];
    return (await this.check(o, slot, template, todayInCairo())).missing;
  }

  /**
   * The offer filled in on `documentDate`. Refused (409) without a published template for its employment type, and
   * (422, with what is missing and where to fill it in) while the template prints a value the offer doesn't have.
   */
  async fill(o: OfferRow, documentDate: string): Promise<FilledOffer> {
    const slot = offerSlot(o.employmentType);
    const template = await this.published(slot, true);
    if (!template) throw new ConflictException(`Publish the ${slot.name} template first (Templates).`);
    const { values, missing } = await this.check(o, slot, template, documentDate);
    if (missing.length) throw new UnprocessableEntityException({ statusCode: 422, message: FILL_IN, missing });
    return {
      data: fillTemplate(Buffer.from(template.data), values),
      fileName: this.fileName(o),
      templateVersionId: template.id,
      templateVersion: template.version,
      restricted: restrictedTags(template.tags, slot.overrides),
    };
  }

  /** "<Slot name> - <OFF number> - <full name>.docx", cleaned as documents' names are. */
  fileName(o: Pick<OfferRow, 'employmentType' | 'number' | 'fullNameEn'>): string {
    return templateFileName(`${documentStem(offerSlot(o.employmentType).name, o.number, o.fullNameEn)}.docx`);
  }

  /** A Word file's PDF name. */
  pdfName(docxName: string): string {
    return docxName.replace(/\.docx$/i, '.pdf');
  }

  /** The .docx as PDF; null without a converter. Refused (503) when the converter fails. */
  toPdf(docx: Uint8Array, fileName: string): Promise<Buffer | null> {
    return this.pdf.fromDocx(docx, fileName);
  }

  get pdfAvailable(): boolean {
    return this.pdf.available;
  }

  private async check(o: OfferRow, slot: TemplateSlot, template: { language: string; tags: string[] }, documentDate: string) {
    const [company, role] = await Promise.all([
      this.prisma.company.findUnique({ where: { id: 1 } }),
      // the selected role's duties, read here rather than with every offer (the offer's view doesn't show them)
      o.jobTitleId ? this.prisma.jobTitle.findUnique({ where: { id: o.jobTitleId }, select: { jdDuties: true } }) : null,
    ]);
    const sources = offerSources(o, company, template.language as TemplateLanguage, documentDate, role?.jdDuties ?? null);
    const values = resolveValues(sources, template.tags, slot.overrides);
    return { values, missing: offerMissing(missingTags(values, template.tags, slot.overrides, true), slot.overrides) };
  }

  private published(slot: TemplateSlot): Promise<{ id: string; version: number; language: string; tags: string[] } | null>;
  private published(slot: TemplateSlot, withFile: true): Promise<{ id: string; version: number; language: string; tags: string[]; data: Uint8Array } | null>;
  private published(slot: TemplateSlot, withFile = false) {
    return this.prisma.templateVersion.findFirst({ where: { slotKey: slot.copyOf ?? slot.key, status: 'published' }, select: { ...PUBLISHED, data: withFile } });
  }
}
