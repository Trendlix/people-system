import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { monthlyFromHourly, OFFER_VALID_DAYS, type OfferShownStatus } from '@trendlix/shared';
import { AllowancesService } from '../allowances/allowances.service.js';
import { allowanceData, allowancesTotal, allowanceView, type AllowanceSnapshot } from '../allowances/rows.js';
import { AuditService, changes } from '../audit/audit.service.js';
import { assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { addDays, fromDateOnly, shownDate, toDateOnly, todayInCairo } from '../common/date-only.js';
import { seesSalary } from '../employees/access.js';
import type { Prisma } from '../generated/prisma/client.js';
import { gradeRange, inGradeRange } from '../organisation/grades/grade-range.js';
import { MailService } from '../mail/mail.service.js';
import { LawRatesService } from '../payroll/law-rates/law-rates.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FILLED_FROM, fillVersion } from '../documents/fill-version.js';
import { restrictedTags } from '../documents/values.js';
import { PDF_NOT_SET_UP } from '../pdf/pdf.service.js';
import { FILL_IN, OfferDocumentsService } from './offer-documents.service.js';
import { OfferHiringService, salaryMasked, type HireResult } from './offer-hiring.service.js';
import { offerEmail } from './offer-mail.js';
import type { AnswerOfferDto, CreateOfferDto, ListOffersDto, SendOfferDto, UpdateOfferDto, WithdrawOfferDto } from './offers.dto.js';
import { offerSlot, pastLastDay, shownStatus, termDates, tokenHash } from './rules.js';
import { OFFER_INCLUDE, OFFER_LIST_SELECT, offerListView, offerView, WITHOUT_FILES, type OfferRow, type OfferView } from './views.js';

const ENTITY = 'job_offer';
/** At most this many offers in the list. */
const LIST_CAP = 500;
/** An end of the range of grades a job title takes. */
const RANGE_END = { select: { code: true, rank: true } } as const;
/** As MailService says it, before anything is filled in or changed. */
const EMAIL_NOT_SET_UP = "Email isn't set up on the server yet. Send the offer's link yourself instead.";
/** Sent only as a protected PDF (owner's request, 15 October 2026: "No doc file export, just a protected PDF"). */
const NOT_SENT_WITHOUT_PDF = "The PDF converter isn't set up on the server, so the offer can't be sent: it goes as a protected PDF only.";
const PROBATION_AFTER_END = (end: string) => `The probation would end after the contract, on ${shownDate(end)}. Shorten the probation or lengthen the contract.`;

/** What a sent offer can still change; anything else needs a new offer. */
const SENT_FIELDS = ['expiresOn', 'note'];

/** Where an offer stands, in a sentence: "OFF-2026-0001 was accepted …". */
const STANDING: Record<OfferShownStatus, string> = {
  draft: 'is a draft',
  sent: 'was sent',
  expired: 'has expired',
  accepted: 'was accepted',
  declined: 'was declined',
  withdrawn: 'was withdrawn',
};

/** An offer's own columns as the API takes them (dates as YYYY-MM-DD, money as numbers), for checking, comparing and the audit log. */
function fields(o: OfferRow) {
  return {
    fullNameEn: o.fullNameEn,
    fullNameAr: o.fullNameAr,
    email: o.email,
    mobile: o.mobile,
    employeeId: o.employeeId,
    employmentType: o.employmentType,
    departmentId: o.departmentId,
    jobTitleId: o.jobTitleId,
    gradeId: o.gradeId,
    managerId: o.managerId,
    shiftId: o.shiftId,
    workArrangement: o.workArrangement,
    officeDays: [...o.officeDays].sort((a, b) => a - b),
    joinDate: fromDateOnly(o.joinDate),
    payBasis: o.payBasis,
    grossSalary: o.grossSalary.toNumber() as number | undefined,
    hourlyRate: o.hourlyRate?.toNumber() ?? null,
    hoursPerWeek: o.hoursPerWeek?.toNumber() ?? null,
    daysPerWeek: o.daysPerWeek,
    basicPercent: o.basicPercent,
    netSalary: o.netSalary?.toNumber() ?? null,
    probationMonths: o.probationMonths,
    durationMonths: o.durationMonths,
    expiresOn: fromDateOnly(o.expiresOn),
    message: o.message,
    note: o.note,
  };
}

type OfferFields = ReturnType<typeof fields>;

/** The fields that were sent (undefined means "leave as it is"), without the allowances. */
function sentFields(dto: CreateOfferDto | UpdateOfferDto): Partial<OfferFields> {
  const { allowances: _a, ...rest } = dto;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<OfferFields>;
}

/** What Prisma writes: YYYY-MM-DD strings become dates. */
function toData(v: OfferFields) {
  return { ...v, grossSalary: v.grossSalary!, joinDate: toDateOnly(v.joinDate), expiresOn: toDateOnly(v.expiresOn) };
}

/** The allowances as the audit log names them: the kinds only, never the amounts. */
const allowanceNames = (rows: readonly AllowanceSnapshot[]) => rows.map((a) => a.nameEn);

// Job offers (owner's request, 15 October 2026): HR drafts the offer (the candidate, the position and the terms with
// the allowances and pay basis), fills in the job offer template, and sends it by email from the system or as a link
// HR sends; the candidate answers on the offer's page (PublicOffersService), or HR records an answer given another
// way. Accepting makes the profile, the employment and a draft contract (OfferHiringService). HR writes; HR and the
// CEO read; the amounts only for those who see salaries; only a Super Admin deletes.
@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly allowances: AllowancesService,
    private readonly documents: OfferDocumentsService,
    private readonly hiring: OfferHiringService,
    private readonly mail: MailService,
    private readonly lawRates: LawRatesService,
  ) {}

  /**
   * The offers, newest first, filtered by a shown status (or open: drafts and sent offers not expired) and a search
   * on the candidate's names, email or the offer number. At most 500.
   */
  async list(query: ListOffersDto, user: SessionUser) {
    const today = toDateOnly(todayInCairo());
    const open = { status: 'sent', expiresOn: { gte: today } } satisfies Prisma.JobOfferWhereInput;
    const byStatus: Record<string, Prisma.JobOfferWhereInput> = {
      open: { OR: [{ status: 'draft' }, open] },
      sent: open,
      expired: { status: 'sent', expiresOn: { lt: today } },
    };
    const text = query.q ? { contains: query.q, mode: 'insensitive' as const } : null;
    const where: Prisma.JobOfferWhereInput = {
      AND: [
        query.status ? (byStatus[query.status] ?? { status: query.status }) : {},
        text ? { OR: [{ fullNameEn: text }, { fullNameAr: text }, { email: text }, { number: text }] } : {},
      ],
    };
    const rows = await this.prisma.jobOffer.findMany({ where, select: OFFER_LIST_SELECT, orderBy: [{ createdAt: 'desc' }, { number: 'desc' }], take: LIST_CAP });
    const sees = seesSalary(user);
    return rows.map((o) => offerListView(o, sees));
  }

  async get(id: string, user: SessionUser): Promise<OfferView> {
    return this.view(await this.row(id), user);
  }

  /** A new draft, numbered OFF-<year>-<4 digits> by the year it is drafted. */
  async create(dto: CreateOfferDto, user: SessionUser) {
    const { values, allowances } = await this.checked(null, dto);
    const rows = allowances ?? [];
    const created = await this.prisma.$transaction(async (tx) => {
      // one number at a time
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('people-system:offer-number'))`;
      const number = await nextNumber(tx);
      const row = await tx.jobOffer.create({ data: { ...toData(values), number, createdById: user.id }, select: { id: true, number: true } });
      if (rows.length) await tx.offerAllowance.createMany({ data: allowanceData(rows).map((a) => ({ ...a, offerId: row.id })) });
      return row;
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: ENTITY,
      entityId: created.id,
      diff: salaryMasked({ number: created.number, ...values, allowances: allowanceNames(rows) }),
    });
    return this.get(created.id, user);
  }

  /**
   * Changes an offer. A draft: any field, and what follows from them is worked out again. A sent one (expired or not):
   * only its last day (a later one opens an expired offer again) and the note; anything else is a new offer.
   */
  async update(id: string, dto: UpdateOfferDto, user: SessionUser) {
    const before = await this.row(id);
    const was = fields(before);
    let diff: Record<string, unknown>;

    if (before.status === 'draft') {
      const { values, allowances } = await this.checked(before, dto);
      await this.prisma.$transaction(async (tx) => {
        await tx.jobOffer.update({ where: { id }, data: toData(values) });
        if (allowances) {
          await tx.offerAllowance.deleteMany({ where: { offerId: id } });
          if (allowances.length) await tx.offerAllowance.createMany({ data: allowanceData(allowances).map((a) => ({ ...a, offerId: id })) });
        }
      });
      diff = salaryMasked(changes(was, values));
      const wereAllowances = before.allowances.map(allowanceView);
      if (allowances && JSON.stringify(allowances.map((a) => [a.allowanceTypeId, a.amount])) !== JSON.stringify(wereAllowances.map((a) => [a.allowanceTypeId, a.amount]))) {
        diff.allowances = { from: allowanceNames(wereAllowances), to: allowanceNames(allowances) };
      }
    } else if (before.status === 'sent') {
      const others = Object.keys(sentFields(dto)).filter((k) => !SENT_FIELDS.includes(k));
      if (others.length || dto.allowances !== undefined) {
        throw new ConflictException(`${before.number} was sent: only its last day and the note can be changed. For other changes, withdraw it and draft a new offer.`);
      }
      if (dto.expiresOn !== undefined && dto.expiresOn < todayInCairo()) throw new BadRequestException("The offer's last day can't be in the past.");
      const values = { expiresOn: dto.expiresOn, note: dto.note };
      await this.prisma.jobOffer.update({ where: { id }, data: { expiresOn: dto.expiresOn ? toDateOnly(dto.expiresOn) : undefined, note: dto.note } });
      diff = changes(was, values);
    } else {
      throw new ConflictException(`${before.number} ${STANDING[shownStatus(before)]}, so it can't be changed.`);
    }

    if (Object.keys(diff).length) await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, entityId: id, diff: { number: before.number, ...diff } });
    return this.get(id, user);
  }

  /** Deletes an offer (a Super Admin only). An accepted one stays on record with the profile made from it. */
  async remove(id: string, user: SessionUser) {
    assertDeletes(user);
    const o = await this.row(id);
    if (o.status === 'accepted') throw new ConflictException(`${o.number} was accepted, so it stays on record with the profile made from it.`);
    await this.prisma.jobOffer.delete({ where: { id } });
    await this.audit.record({ userId: user.id, action: 'delete', entityType: ENTITY, entityId: id, diff: { number: o.number, status: o.status, fullNameEn: o.fullNameEn } });
  }

  /**
   * The offer's document, as a protected PDF only (owner's request, 15 October 2026: "No doc file export, just a
   * protected PDF"): a draft filled in afresh (dated today) and converted, any other the PDF kept when it was sent (or,
   * kept without one, the copy as sent converted). Refused (409) without a PDF converter when there is no PDF to give.
   * Every view is audited, as the terms are restricted. While the employment type's template has no published version,
   * a draft offer is previewed with the newest draft of it (owner's request, 15 October 2026: "Job offer preview should
   * call data from the offer tab, even if not published yet"), whose number `templateDraft` gives (the X-Template-Draft
   * header); sending still needs a published one.
   */
  async document(id: string, user: SessionUser): Promise<{ data: Buffer; fileName: string; templateDraft: number | null }> {
    const o = await this.row(id);
    let fileName: string;
    let pdf: Buffer;
    let restricted: string[];
    let templateDraft: number | null = null;

    if (o.status === 'draft') {
      if (!this.documents.pdfAvailable) throw new ConflictException(PDF_NOT_SET_UP);
      const draft = await this.previewTemplate(o.employmentType);
      const filled = draft ? await this.fillFromDraft(o, draft) : await this.documents.fill(o, todayInCairo());
      ({ fileName, restricted } = filled);
      templateDraft = draft?.version ?? null;
      pdf = await this.protectedPdf(filled.data, fileName, PDF_NOT_SET_UP);
    } else {
      const files = await this.prisma.jobOffer.findUniqueOrThrow({ where: { id }, select: { data: true, pdf: true } });
      if (!files.data || !o.fileName) throw new NotFoundException(`${o.number} was never sent, so there is no copy of it.`);
      fileName = o.fileName;
      restricted = this.restrictedOf(o);
      pdf = files.pdf ? await this.documents.storedPdf(files.pdf) : await this.protectedPdf(files.data, fileName, PDF_NOT_SET_UP);
    }

    if (restricted.length) {
      const diff = { number: o.number, fields: restricted, seen: 'document', ...(templateDraft !== null && { templateDraft }) };
      await this.audit.record({ userId: user.id, action: 'view_restricted', entityType: ENTITY, entityId: id, diff });
    }
    return { data: pdf, fileName: this.documents.pdfName(fileName), templateDraft };
  }

  /**
   * Sends a draft, or sends a sent offer again: the document is filled in now (dated today) and kept with its protected
   * PDF; a new link replaces the one before, which stops working. By email: to the candidate, the answer going to the
   * HR user, with the protected PDF attached, never the Word file (owner's request, 15 October 2026: "No doc file
   * export, just a protected PDF"). Refused without a PDF converter (409) or when it fails (503): the offer is then left
   * as it was. Refused once the last day has passed (set a later one first), and for an answered or withdrawn offer.
   */
  async send(id: string, dto: SendOfferDto, user: SessionUser): Promise<{ offer: OfferView; link: string }> {
    const o = await this.row(id);
    if (o.status !== 'draft' && o.status !== 'sent') throw new ConflictException(`${o.number} ${STANDING[shownStatus(o)]}, so it can't be sent.`);
    if (pastLastDay(o)) {
      throw new ConflictException(`The offer's last day, ${shownDate(fromDateOnly(o.expiresOn))}, has passed. Set a later last day, then send it again.`);
    }
    if (dto.via === 'email' && !this.mail.configured) throw new ServiceUnavailableException(EMAIL_NOT_SET_UP);
    if (!this.documents.pdfAvailable) throw new ConflictException(NOT_SENT_WITHOUT_PDF);

    const documentDate = todayInCairo();
    const filled = await this.documents.fill(o, documentDate);
    // refused (503) when the converter fails: never sent with the Word file instead
    const pdf = await this.protectedPdf(filled.data, filled.fileName, NOT_SENT_WITHOUT_PDF);

    const secret = randomBytes(32).toString('base64url');
    const link = `${new URL(dto.origin).origin}/offer/${secret}`;
    const to = dto.to ?? o.email;
    if (dto.via === 'email') {
      const company = await this.prisma.company.findUnique({ where: { id: 1 }, select: { nameEn: true } });
      const mail = offerEmail({
        fullNameEn: o.fullNameEn,
        jobTitleEn: o.jobTitle?.titleEn ?? null,
        employmentType: o.employmentType,
        companyName: company?.nameEn ?? 'the company',
        joinDate: fromDateOnly(o.joinDate),
        expiresOn: fromDateOnly(o.expiresOn),
        message: o.message,
        link,
      });
      const attachment = { filename: this.documents.pdfName(filled.fileName), content: pdf, contentType: 'application/pdf' };
      // refused (503) when the provider refuses it: the offer is then left as it was
      await this.mail.send({ to, replyTo: user.email, ...mail, attachments: [attachment] });
    }

    const sentAt = new Date();
    await this.prisma.jobOffer.update({
      where: { id },
      data: {
        status: 'sent',
        templateVersionId: filled.templateVersionId,
        documentDate: toDateOnly(documentDate),
        fileName: filled.fileName,
        data: new Uint8Array(filled.data),
        pdf: new Uint8Array(pdf),
        tokenHash: tokenHash(secret),
        sentVia: dto.via,
        sentTo: to,
        sentAt,
        sentById: user.id,
        sentCount: { increment: 1 },
        // the new link hasn't been opened yet
        viewedAt: null,
      },
    });
    await this.audit.record({
      userId: user.id,
      action: 'send',
      entityType: ENTITY,
      entityId: id,
      diff: {
        number: o.number,
        ...(o.status === 'draft' && { status: { from: 'draft', to: 'sent' } }),
        via: dto.via,
        to,
        sentCount: o.sentCount + 1,
        templateVersion: filled.templateVersion,
        documentDate,
        fileName: filled.fileName,
      },
    });
    return { offer: await this.get(id, user), link };
  }

  /** A draft or sent offer withdrawn: its link stops working. */
  async withdraw(id: string, dto: WithdrawOfferDto, user: SessionUser) {
    const o = await this.row(id);
    if (o.status !== 'draft' && o.status !== 'sent') throw new ConflictException(`${o.number} ${STANDING[shownStatus(o)]}, so it can't be withdrawn.`);
    const reason = dto.reason ?? null;
    const { count } = await this.prisma.jobOffer.updateMany({
      where: { id, status: o.status },
      data: { status: 'withdrawn', withdrawnAt: new Date(), withdrawReason: reason, tokenHash: null },
    });
    if (!count) throw await this.changedMeanwhile(id);
    await this.audit.record({ userId: user.id, action: 'withdraw', entityType: ENTITY, entityId: id, diff: { number: o.number, status: { from: o.status, to: 'withdrawn' }, reason } });
    return this.get(id, user);
  }

  /**
   * Records an answer the candidate gave another way: for a sent offer, or a draft handed over on paper, while it is
   * open (its last day not passed: set a later one first if they answered in time). Accepted, the profile is made
   * (see OfferHiringService); if that fails, the acceptance stays and `hireError` says why.
   */
  async answer(id: string, dto: AnswerOfferDto, user: SessionUser): Promise<OfferView & { hireError: string | null }> {
    const o = await this.row(id);
    if (o.status !== 'draft' && o.status !== 'sent') throw new ConflictException(`${o.number} ${STANDING[shownStatus(o)]}, so its answer can't be recorded.`);
    if (pastLastDay(o)) {
      throw new ConflictException(`The offer's last day, ${shownDate(fromDateOnly(o.expiresOn))}, has passed. If the candidate answered in time, set a later last day first.`);
    }
    const accepted = dto.answer === 'accepted';
    const respondedAt = new Date();

    // a draft handed over on paper keeps the copy as accepted, when its template can be filled in
    let document: Prisma.JobOfferUncheckedUpdateManyInput = {};
    if (accepted && o.status === 'draft') {
      const today = todayInCairo();
      const filled = await this.documents.fill(o, today).catch(() => null);
      if (filled) {
        document = { templateVersionId: filled.templateVersionId, documentDate: toDateOnly(today), fileName: filled.fileName, data: new Uint8Array(filled.data), pdf: null };
      }
    }
    const { count } = await this.prisma.jobOffer.updateMany({
      where: { id, status: o.status },
      data: {
        status: dto.answer,
        respondedAt,
        answeredById: user.id,
        ...(accepted ? { acceptedName: null } : { declineReason: dto.reason ?? null }),
        ...document,
      },
    });
    if (!count) throw await this.changedMeanwhile(id);
    await this.audit.record({
      userId: user.id,
      action: 'answer',
      entityType: ENTITY,
      entityId: id,
      diff: { number: o.number, status: { from: o.status, to: dto.answer }, recordedByHr: true, ...(!accepted && { reason: dto.reason ?? null }) },
    });

    let hired: HireResult | null = null;
    if (accepted) hired = await this.hiring.tryHire(id, user.id);
    await this.hiring.notify({ ...o, respondedAt, declineReason: dto.reason ?? null }, dto.answer, { userId: user.id }, hired);
    return { ...(await this.get(id, user)), hireError: hired && 'error' in hired ? hired.error : null };
  }

  /** Makes the profile from an accepted offer whose profile wasn't made (e.g. after a failure), with the error if it fails again. */
  async hire(id: string, user: SessionUser) {
    const o = await this.row(id);
    if (o.status !== 'accepted') throw new ConflictException(`${o.number} isn't accepted, so there is no profile to make from it.`);
    if (o.hiredAt) throw new ConflictException(`The profile was already made from ${o.number}.`);
    await this.hiring.hire(id, user.id);
    return this.get(id, user);
  }

  // ---------- helpers ----------

  private async row(id: string): Promise<OfferRow> {
    const o = await this.prisma.jobOffer.findUnique({ where: { id }, include: OFFER_INCLUDE, omit: WITHOUT_FILES });
    if (!o) throw new NotFoundException('Job offer not found.');
    return o;
  }

  private async view(o: OfferRow, user: SessionUser): Promise<OfferView> {
    const [template, draft, hasPdf, lawYears] = await Promise.all([
      this.documents.template(o.employmentType),
      this.previewTemplate(o.employmentType),
      o.fileName ? this.hasPdf(o.id) : Promise.resolve(false),
      this.lawRates.years(),
    ]);
    // a draft's missing values: from the published template, else from the draft it is previewed with
    const missing =
      o.status !== 'draft'
        ? []
        : draft
          ? (await this.documents.check(o, offerSlot(o.employmentType), draft, todayInCairo())).missing
          : await this.documents.missing(o);
    return offerView(o, {
      seesSalary: seesSalary(user),
      lawYears,
      template,
      previewVersion: draft?.version ?? null,
      missing,
      hasPdf,
      emailConfigured: this.mail.configured,
      pdfAvailable: this.documents.pdfAvailable,
    });
  }

  /**
   * The newest draft of the employment type's job offer template while it has no published version: what a draft
   * offer is previewed with meanwhile. Null once one is published, or with no draft either.
   */
  private async previewTemplate(
    employmentType: string,
  ): Promise<{ id: string; version: number; language: string; tags: string[]; pdfFields: Prisma.JsonValue | null } | null> {
    const slot = offerSlot(employmentType);
    const versions = await this.prisma.templateVersion.findMany({
      where: { slotKey: slot.copyOf ?? slot.key, status: { in: ['draft', 'published'] } },
      select: { id: true, version: true, status: true, language: true, tags: true, pdfFields: true },
      orderBy: { version: 'desc' },
    });
    if (versions.some((v) => v.status === 'published')) return null;
    const draft = versions[0];
    return draft ? { id: draft.id, version: draft.version, language: draft.language, tags: draft.tags, pdfFields: draft.pdfFields } : null;
  }

  /**
   * A draft offer filled in from a draft of its template, dated today, as OfferDocumentsService.fill fills it from the
   * published one: refused (422, with what is missing and where to fill it in) while a value is missing.
   */
  private async fillFromDraft(
    o: OfferRow,
    template: { id: string; language: string; tags: string[]; pdfFields: Prisma.JsonValue | null },
  ): Promise<{ data: Buffer; fileName: string; restricted: string[] }> {
    const slot = offerSlot(o.employmentType);
    const { values, missing } = await this.documents.check(o, slot, template, todayInCairo());
    if (missing.length) throw new UnprocessableEntityException({ statusCode: 422, message: FILL_IN, missing });
    const version = await this.prisma.templateVersion.findUniqueOrThrow({ where: { id: template.id }, select: FILLED_FROM });
    return { data: await fillVersion(version, values), fileName: this.documents.fileName(o, version.format), restricted: restrictedTags(template.tags, slot.overrides) };
  }

  /** The filled .docx as a protected PDF; refused (409, `notSetUp`) without a PDF converter, (503) when it fails. */
  private async protectedPdf(docx: Uint8Array, fileName: string, notSetUp: string): Promise<Buffer> {
    const pdf = await this.documents.toPdf(docx, fileName);
    if (!pdf) throw new ConflictException(notSetUp);
    return pdf;
  }

  /** Whether the stored document has its PDF, without loading either file. */
  private async hasPdf(id: string): Promise<boolean> {
    const [row] = await this.prisma.$queryRaw<{ has: boolean }[]>`SELECT pdf IS NOT NULL AS has FROM job_offers WHERE id = ${id}::uuid`;
    return row?.has ?? false;
  }

  /** The restricted tags the document as sent prints, from its template version (read through its slot's overrides). */
  private restrictedOf(o: OfferRow): string[] {
    return o.templateVersion ? restrictedTags(o.templateVersion.tags, offerSlot(o.employmentType).overrides) : [];
  }

  /** The 409 when another request changed the offer between reading and writing it. */
  private async changedMeanwhile(id: string): Promise<ConflictException> {
    const now = await this.row(id);
    return new ConflictException(`${now.number} ${STANDING[shownStatus(now)]} in the meantime. Reload it to see where it stands.`);
  }

  /**
   * An offer's values checked, with what follows from them: the former employee (no current employment, a join date
   * after their last employment), the position as an employment's (the job title's department or team, a grade the job
   * title takes, a current manager, a shift, office days for Hybrid), the pay (by the hour, the gross is worked out),
   * the probation (once per employer, Art. 90) and the fixed term, the allowances and the last day. A draft changed is
   * checked as it will be saved; only what was sent, and what depends on it, is checked against the records again.
   * The allowances come back only when they were sent (or for a new offer).
   */
  private async checked(before: OfferRow | null, dto: CreateOfferDto | UpdateOfferDto): Promise<{ values: OfferFields; allowances: AllowanceSnapshot[] | undefined }> {
    const creating = before === null;
    const sent = sentFields(dto);
    const today = todayInCairo();
    const settings = await this.prisma.contractSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    const v: OfferFields = {
      ...(before
        ? fields(before)
        : {
            fullNameEn: '',
            fullNameAr: '',
            email: '',
            mobile: null,
            employeeId: null,
            employmentType: 'full_time' as const,
            departmentId: null,
            jobTitleId: null,
            gradeId: null,
            managerId: null,
            shiftId: null,
            workArrangement: 'office' as const,
            officeDays: [],
            joinDate: '',
            payBasis: 'monthly',
            grossSalary: undefined,
            hourlyRate: null,
            hoursPerWeek: null,
            daysPerWeek: null,
            basicPercent: settings.basicPercentDefault, // the company's default share (Payroll Setup, 16 October 2026)
            netSalary: null,
            probationMonths: settings.probationMonths,
            durationMonths: settings.durationMonths,
            expiresOn: addDays(today, OFFER_VALID_DAYS),
            message: null,
            note: null,
          }),
      ...sent,
    };

    // a former employee offered again: no current employment, and the new one after the last
    let hadEmployment = false;
    let personName = v.fullNameEn;
    if (v.employeeId) {
      const person = await this.prisma.employee.findUnique({
        where: { id: v.employeeId },
        select: { fullNameEn: true, employments: { select: { joinDate: true, endDate: true } } },
      });
      if (!person) throw new BadRequestException('Former employee not found. Choose one from the list.');
      personName = person.fullNameEn;
      hadEmployment = person.employments.length > 0;
      if (creating || dto.employeeId !== undefined || dto.joinDate !== undefined) {
        const current = person.employments.find((e) => !e.endDate);
        if (current) {
          throw new ConflictException(
            `${person.fullNameEn} has a current employment, since ${shownDate(fromDateOnly(current.joinDate))}. An offer is for someone new, or a former employee.`,
          );
        }
        const lastEnd = person.employments.map((e) => fromDateOnly(e.endDate)!).sort().at(-1);
        if (lastEnd && v.joinDate <= lastEnd) throw new BadRequestException(`${person.fullNameEn}'s last employment ended on ${shownDate(lastEnd)}: the join date must be after that.`);
      }
    }

    // the department or team follows the job title (as an employment's)
    if (creating || dto.jobTitleId !== undefined || dto.departmentId !== undefined) {
      if (v.jobTitleId) {
        const job = await this.prisma.jobTitle.findUnique({
          where: { id: v.jobTitleId },
          select: { titleEn: true, departmentId: true, department: { select: { nameEn: true, parentId: true } } },
        });
        if (!job) throw new BadRequestException('Job title not found. Choose one from the list.');
        if (dto.departmentId && dto.departmentId !== job.departmentId) {
          const place = job.department.parentId ? 'that team' : 'that department';
          throw new BadRequestException(`The job title "${job.titleEn}" belongs to ${job.department.nameEn}. Choose ${place}, or another job title.`);
        }
        v.departmentId = job.departmentId;
      } else if (v.departmentId) {
        const exists = await this.prisma.department.count({ where: { id: v.departmentId } });
        if (!exists) throw new BadRequestException('Department or team not found. Choose one from the list.');
      }
    }

    // a grade the job title takes
    const jobTitleChanged = creating || (dto.jobTitleId !== undefined && dto.jobTitleId !== before.jobTitleId);
    const gradeChanged = creating || (dto.gradeId !== undefined && dto.gradeId !== before.gradeId);
    if (v.gradeId && (jobTitleChanged || gradeChanged)) {
      const grade = await this.prisma.grade.findUnique({ where: { id: v.gradeId }, select: { rank: true } });
      if (!grade) throw new BadRequestException('Grade not found. Choose one from the list.');
      if (v.jobTitleId) {
        const job = await this.prisma.jobTitle.findUnique({ where: { id: v.jobTitleId }, select: { titleEn: true, minGrade: RANGE_END, maxGrade: RANGE_END } });
        if (job && !inGradeRange(grade.rank, job.minGrade, job.maxGrade)) {
          const only = job.minGrade && job.maxGrade && job.minGrade.rank === job.maxGrade.rank ? job.minGrade.code : null;
          throw new BadRequestException(
            only
              ? `${job.titleEn} takes grade ${only} only. Choose that grade, or widen the job title's grades.`
              : `${job.titleEn} takes grades ${gradeRange(job.minGrade, job.maxGrade)}. Choose a grade in that range.`,
          );
        }
      }
    }

    // a manager who works here now
    if (v.managerId && (creating || dto.managerId !== undefined || dto.employeeId !== undefined)) {
      if (v.managerId === v.employeeId) throw new BadRequestException('An employee cannot be their own manager.');
      const manager = await this.prisma.employee.findUnique({
        where: { id: v.managerId },
        select: { fullNameEn: true, employments: { where: { endDate: null }, select: { id: true } } },
      });
      if (!manager) throw new BadRequestException('Manager not found. Choose one from the list.');
      if (!manager.employments.length) throw new BadRequestException(`${manager.fullNameEn} has no current employment. Choose a current employee as the manager.`);
    }

    if (v.shiftId && (creating || dto.shiftId !== undefined)) {
      const exists = await this.prisma.shift.count({ where: { id: v.shiftId } });
      if (!exists) throw new BadRequestException('Shift not found. Choose one from the list.');
    }

    // office days are kept for Hybrid only
    if (creating || dto.workArrangement !== undefined || dto.officeDays !== undefined) {
      const days = [...v.officeDays].sort((a, b) => a - b);
      if (v.workArrangement === 'hybrid' && days.length === 0) throw new BadRequestException('Choose the office days for a Hybrid work arrangement.');
      v.officeDays = v.workArrangement === 'hybrid' ? days : [];
    }

    // the pay: by the hour, the gross is the monthly estimate worked out from the rate and the hours
    if (v.payBasis === 'hourly') {
      if (v.hourlyRate === null || v.hoursPerWeek === null) {
        throw new BadRequestException('Enter the hourly rate and the hours a week: by the hour, the gross salary is worked out from them.');
      }
      v.grossSalary = monthlyFromHourly(v.hourlyRate, v.hoursPerWeek);
    } else {
      if (v.grossSalary === undefined) throw new BadRequestException('Enter the gross salary.');
      v.hourlyRate = null;
      v.hoursPerWeek = null;
    }

    // probation once per employer (Art. 90): none for someone who already had an employment with the company
    if (hadEmployment) {
      if (dto.probationMonths) throw new BadRequestException(`${personName} already had a probation with the company; the law allows it once (Art. 90).`);
      if (dto.probationMonths === undefined) v.probationMonths = 0;
    }
    const { endDate, probationEnd } = termDates(v.joinDate, v.durationMonths, v.probationMonths);
    if (probationEnd && probationEnd > endDate) throw new BadRequestException(PROBATION_AFTER_END(probationEnd));

    // the allowances as their kinds are now; an inactive kind only if the offer already has it
    let allowances: AllowanceSnapshot[] | undefined;
    if (creating || dto.allowances !== undefined) {
      allowances = await this.allowances.snapshot(dto.allowances ?? [], { allowInactive: before?.allowances.map((a) => a.allowanceTypeId) ?? [] });
    }
    const total = allowancesTotal(allowances ?? before!.allowances.map(allowanceView));
    if (v.netSalary !== null && v.netSalary > Math.round((v.grossSalary + total) * 100) / 100) {
      throw new BadRequestException("The net salary can't be more than the gross salary and allowances together.");
    }

    if ((creating || dto.expiresOn !== undefined) && v.expiresOn < today) throw new BadRequestException("The offer's last day can't be in the past.");
    return { values: v, allowances };
  }
}

/** The next free number for an offer drafted this year: OFF-2026-0001, OFF-2026-0002 … */
async function nextNumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = todayInCairo().slice(0, 4);
  const [{ max }] = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT max(substring(number from 10)::int) AS max FROM job_offers WHERE number ~ ${`^OFF-${year}-[0-9]+$`}`;
  return `OFF-${year}-${String((max ?? 0) + 1).padStart(4, '0')}`;
}
