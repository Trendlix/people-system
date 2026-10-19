import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import type { OfferShownStatus, TemplateSlot } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { seesBank, seesIdentity, seesSalary } from '../employees/access.js';
import type { Prisma } from '../generated/prisma/client.js';
import { OfferDocumentsService } from '../offers/offer-documents.service.js';
import { shownStatus } from '../offers/rules.js';
import { OFFER_INCLUDE, WITHOUT_FILES, type OfferRow } from '../offers/views.js';
import { PdfService } from '../pdf/pdf.service.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentsService } from './documents.service.js';
import { filledFileName } from './fill-version.js';
import { SLOTS } from './offer.js';
import { isOfferSlot } from './preview.js';

// A template version previewed with a real employee's data (owner's request, 15 October 2026: "When previewing a
// template, fetch any demo data already uploaded"): any version, a draft too, filled in for someone already in the
// system, as a protected PDF to look at (owner's request, 15 October 2026: "No doc file export, just a protected
// PDF"), nothing saved. The people to choose from are those whose employment
// type the template is for, those with the most of its tags filled in first; a document the Employment tab wouldn't
// offer them yet (a resignation request before any ending) is previewed all the same, its empty tags showing as
// "[Label]". The filling is DocumentsService.previewFill, from what generation reads.
//
// A job offer template is previewed with a job offer's data instead (owner's request, 15 October 2026: "Job offer
// preview should call data from the offer tab, even if not published yet"): the offers of the employment type it is
// for, a draft too, filled in as sending fills them (OfferDocumentsService.previewFill); with no offer of that type
// yet, the employees as for any other template.

/** At most this many people to choose from. */
const PEOPLE_MAX = 50;

/** How many people's values are worked out at once. */
const AT_ONCE = 8;

export const NO_ONE = 'There is no one to preview this template with yet: add an employee first.';
export const NO_OFFER = 'There is nothing to preview this template with yet: draft a job offer first.';

/** Newest first, the current employment (no end date) before all ended ones (as the profile orders them). */
const NEWEST_FIRST = [{ endDate: { sort: 'desc', nulls: 'first' } }, { joinDate: 'desc' }] satisfies Prisma.EmploymentOrderByWithRelationInput[];

const VERSION = { id: true, slotKey: true, version: true, language: true, tags: true } satisfies Prisma.TemplateVersionSelect;
type VersionRow = Prisma.TemplateVersionGetPayload<{ select: typeof VERSION }>;

/** Someone to preview a version with, and how many of the tags it prints have a value for them. */
export interface PreviewPerson {
  kind: 'employee';
  id: string;
  employeeCode: string;
  fullNameEn: string;
  /** Their current employment's type, else their latest's. */
  employmentType: string | null;
  filled: number;
  total: number;
}

/** A job offer to preview a job offer template with, and how many of the tags it prints have a value on it. */
export interface PreviewOffer {
  kind: 'offer';
  id: string;
  /** OFF-2026-0001 */
  number: string;
  fullNameEn: string;
  employmentType: string;
  /** As shown: a sent offer past its last day is expired. */
  status: OfferShownStatus;
  filled: number;
  total: number;
}

/** Whose data a version can be previewed with: an employee's, or a job offer's for a job offer template. */
export type PreviewChoice = PreviewPerson | PreviewOffer;

/** Whose data a preview was filled in with (X-Preview-Employee or X-Preview-Offer). */
export interface PreviewUsed {
  kind: PreviewChoice['kind'];
  id: string;
}

/** The most tags filled in first, then by name. */
export function bestFirst(a: PreviewPerson, b: PreviewPerson): number {
  return b.filled - a.filled || a.fullNameEn.localeCompare(b.fullNameEn) || a.employeeCode.localeCompare(b.employeeCode);
}

/** `fn` for each item, `limit` at a time, the results in the items' order. */
async function inTurns<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** The restricted data the caller may see printed (the rest prints as ••••). */
const rights = (user: SessionUser) => ({ identity: seesIdentity(user), salary: seesSalary(user), bank: seesBank(user) });

@Injectable()
export class TemplatePreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly offerDocuments: OfferDocumentsService,
    private readonly pdf: PdfService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
  ) {}

  /**
   * Up to 50 people to preview the version with, best first; for a job offer template, the newest 50 offers of its
   * employment type instead (the most tags filled in first), or the people while there is none.
   */
  async people(versionId: string, user: SessionUser): Promise<PreviewChoice[]> {
    const { version, slot } = await this.version(versionId);
    return this.choices(version, slot, user);
  }

  /**
   * The version filled in for the employee, or (a job offer template only) the job offer; else for the first of
   * people(). As a protected PDF (409 without a PDF converter). Restricted data printed is a view of it, written to
   * the audit log.
   */
  async file(versionId: string, chosen: { employeeId?: string; offerId?: string }, user: SessionUser) {
    const { version, slot } = await this.version(versionId);
    if (chosen.employeeId && chosen.offerId) throw new BadRequestException('Choose an employee or a job offer to preview with, not both.');
    if (chosen.offerId && !isOfferSlot(slot)) {
      throw new BadRequestException(`${slot.name} is previewed with an employee's data: only a job offer template takes a job offer.`);
    }
    const used: PreviewUsed | undefined = chosen.offerId
      ? { kind: 'offer', id: chosen.offerId }
      : chosen.employeeId
        ? { kind: 'employee', id: chosen.employeeId }
        : (await this.choices(version, slot, user))[0];
    if (!used) throw new ConflictException(isOfferSlot(slot) ? NO_OFFER : NO_ONE);

    // the file, and a PDF form's fields (owner's decision, 15 October 2026)
    const { data, format, pdfFields } = await this.prisma.templateVersion.findUniqueOrThrow({ where: { id: versionId }, select: { data: true, format: true, pdfFields: true } });
    const template = { language: version.language, tags: version.tags, data, format, pdfFields };
    let filled: { data: Buffer | null; shown: string[] };
    let whose: string;
    if (used.kind === 'offer') {
      await this.confidential.assertOfferVisible(user, used.id);
      const o = await this.offer(used.id);
      filled = await this.offerDocuments.previewFill(o, slot, template, rights(user));
      whose = `${o.number} - ${o.fullNameEn}`;
    } else {
      const forEmployee = await this.documents.previewFill(used.id, slot.key, template, user);
      filled = forEmployee;
      whose = forEmployee.employee.fullNameEn;
    }
    const file = await this.pdf.protectedFile({ data: filled.data!, fileName: filledFileName(`${slot.name} v${version.version} - preview - ${whose}`, format) });
    if (filled.shown.length) {
      await this.audit.record({
        userId: user.id,
        action: 'view_restricted',
        entityType: 'template_version',
        entityId: version.id,
        diff: { [used.kind === 'offer' ? 'offerId' : 'employeeId']: used.id, slot: slot.key, version: version.version, fields: filled.shown, seen: 'preview' },
      });
    }
    return { ...file, used: { kind: used.kind, id: used.id } satisfies PreviewUsed };
  }

  // ---------- helpers ----------

  /** A job offer template's offers, else (and for any other template) the people. */
  private async choices(version: VersionRow, slot: TemplateSlot, user: SessionUser): Promise<PreviewChoice[]> {
    if (isOfferSlot(slot)) {
      const offers = await this.rankedOffers(version, slot, user);
      if (offers.length) return offers;
    }
    return this.ranked(version, slot, user);
  }

  private async version(id: string): Promise<{ version: VersionRow; slot: TemplateSlot }> {
    const version = await this.prisma.templateVersion.findUnique({ where: { id }, select: VERSION });
    const slot = version && SLOTS.get(version.slotKey);
    if (!version || !slot) throw new NotFoundException('Template version not found.');
    return { version, slot };
  }

  /** Everyone whose current employment (else latest) is of a type the template is for, best first, at most 50. */
  private async ranked(version: VersionRow, slot: TemplateSlot, user: SessionUser): Promise<PreviewPerson[]> {
    const employees = await this.prisma.employee.findMany({
      // never a C-level person's data for anyone but the CEO and a Super Admin (owner, 19 October 2026)
      where: { employments: { some: {} }, ...(await this.confidential.employeeWhere(user)) },
      select: { id: true, employeeCode: true, fullNameEn: true, employments: { select: { employmentType: true, paidByCommission: true }, orderBy: NEWEST_FIRST, take: 1 } },
    });
    // a commission slot's previews are those paid by commission (owner, 18 October 2026)
    const candidates = employees.filter(
      (e) => e.employments[0] && slot.appliesTo.includes(e.employments[0].employmentType) && (!slot.paidByCommission || e.employments[0].paidByCommission),
    );
    const people = await inTurns(candidates, AT_ONCE, async (e): Promise<PreviewPerson | null> => {
      try {
        const { filled, total } = await this.documents.previewFill(e.id, slot.key, { language: version.language, tags: version.tags }, user);
        return { kind: 'employee', id: e.id, employeeCode: e.employeeCode, fullNameEn: e.fullNameEn, employmentType: e.employments[0]?.employmentType ?? null, filled, total };
      } catch (err) {
        if (err instanceof HttpException) return null; // deleted, or their employment, since the list was read
        throw err;
      }
    });
    return people
      .filter((p): p is PreviewPerson => p !== null)
      .sort(bestFirst)
      .slice(0, PEOPLE_MAX);
  }

  /** The newest 50 offers of the employment type the job offer template is for, the most of its tags filled in first. */
  private async rankedOffers(version: VersionRow, slot: TemplateSlot, user: SessionUser): Promise<PreviewOffer[]> {
    const offers = await this.prisma.jobOffer.findMany({
      // not a C-level offer for anyone but the CEO and a Super Admin (owner, 19 October 2026)
      where: { AND: [{ employmentType: { in: [...slot.appliesTo] }, ...(slot.paidByCommission && { paidByCommission: true }) }, await this.confidential.offerWhere(user)] },
      include: OFFER_INCLUDE,
      omit: WITHOUT_FILES,
      orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
      take: PEOPLE_MAX,
    });
    const may = rights(user);
    const ranked = await inTurns(offers, AT_ONCE, async (o): Promise<PreviewOffer> => {
      const { filled, total } = await this.offerDocuments.previewFill(o, slot, { language: version.language, tags: version.tags }, may);
      return { kind: 'offer', id: o.id, number: o.number, fullNameEn: o.fullNameEn, employmentType: o.employmentType, status: shownStatus(o), filled, total };
    });
    // a stable sort: the newest first among those with as many filled in
    return ranked.sort((a, b) => b.filled - a.filled);
  }

  private async offer(id: string): Promise<OfferRow> {
    const o = await this.prisma.jobOffer.findUnique({ where: { id }, include: OFFER_INCLUDE, omit: WITHOUT_FILES });
    if (!o) throw new NotFoundException('Job offer not found.');
    return o;
  }
}
