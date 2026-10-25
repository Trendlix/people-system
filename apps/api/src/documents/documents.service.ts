import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { advanceBalance, COMMISSION_SLOTS, LABELS, type AdjustmentStatus, type EmploymentType, type TemplateLanguage, type TemplateSlot } from '@trendlix/shared';
import { ALLOWANCE_ORDER } from '../allowances/rows.js';
import { AuditService } from '../audit/audit.service.js';
import { assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { dayInCairo, fromDateOnly, toDateOnly, todayInCairo } from '../common/date-only.js';
import { INSURANCE_BASIC_DEFAULT } from '../contracts/contract-settings.service.js';
import { seesBank, seesIdentity, seesSalary } from '../employees/access.js';
import { insuredContractPay, insuredVersionOf } from '../employees/insured-wage.js';
import type { Prisma } from '../generated/prisma/client.js';
import { LeaveSettlementService } from '../leave/leave-settlement.service.js';
import { LawRatesService } from '../payroll/law-rates/law-rates.service.js';
import { detectPaperworkType, extensionOf, PAPERWORK_MAX_BYTES, PAPERWORK_MAX_MB, safeFileName, type PaperworkType } from '../paperwork/paperwork-file.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { isPdf } from '../pdf/pdf-file.js';
import { DOCX_MIME } from '../templates/docx-tags.js';
import type { CheckDocumentDto, GenerateDocumentDto } from './documents.dto.js';
import { isBlankValue, type TagValue } from './engine/index.js';
import { filledFileName, FILLED_FROM, fillVersion, requiredTags } from './fill-version.js';
import { documentStem } from './format.js';
import {
  AMENDMENT_SLOT,
  ENDING_SLOTS,
  FORM_2_SLOT,
  isContractSlot,
  isVersionSlot,
  offered,
  offeredSlots,
  SECTION_KEYS,
  sectionOf,
  SLOTS,
  TYPED_TAGS,
  versionSlots,
  type SectionKey,
  type Situation,
} from './offer.js';
import { previewValues } from './preview.js';
import type { SettlementSource } from './settlement-values.js';
import { missingTags, resolveValues, restrictedTags, rightFor, sourceTag, type MissingTag, type RestrictedRight, type ValueSources } from './values.js';
import { DOCUMENT, documentView, type DocumentRow, type DocumentStatus } from './views.js';

const ENTITY = 'generated_document';

/** The endings that count: a rejected or withdrawn one is as if there were none. */
const LIVE_ENDINGS = ['pending_ceo', 'approved', 'completed'];

/** Newest first, the current employment (no end date) before all ended ones (as the profile orders them). */
const NEWEST_FIRST = [{ endDate: { sort: 'desc', nulls: 'first' } }, { joinDate: 'desc' }] satisfies Prisma.EmploymentOrderByWithRelationInput[];

/** The employment documents are generated under, with what their values and the tab's items need. */
const EMPLOYMENT = {
  id: true,
  employmentType: true,
  joinDate: true,
  endDate: true,
  // its duties for {{job_duties}} (owner's request, 15 October 2026)
  jobTitle: { select: { titleEn: true, titleAr: true, jdDuties: true } },
  department: { select: { nameEn: true, nameAr: true } },
  // the grade's level, the manager, the shift and the work arrangement for their tags (owner's request, 15 October 2026)
  grade: { select: { code: true, levelEn: true, levelAr: true } },
  manager: { select: { fullNameEn: true, fullNameAr: true } },
  shift: { select: { startTime: true, endTime: true, hoursPerDay: true, workingDays: true } },
  workArrangement: true,
  // employment types by the labour law (owner, 18 October 2026): the commission contract, and the nature of the work's tags
  paidByCommission: true,
  workNature: true,
  contracts: {
    orderBy: { version: 'desc' },
    include: {
      allowances: { select: { nameEn: true, nameAr: true, amount: true }, orderBy: ALLOWANCE_ORDER },
      // a raise's promotion, for its letter (owner's decisions, 16 October 2026)
      newJobTitle: { select: { titleEn: true, titleAr: true } },
      newGrade: { select: { code: true } },
    },
  },
  endings: {
    where: { status: { in: LIVE_ENDINGS } },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { id: true, initiator: true, noticeGivenOn: true, lastWorkingDay: true, reason: true },
  },
} satisfies Prisma.EmploymentSelect;

type EmploymentRow = Prisma.EmploymentGetPayload<{ select: typeof EMPLOYMENT }>;
type ContractRow = EmploymentRow['contracts'][number];

/** The published version a document is filled in from; a PDF form's fields say which tags may be left blank. */
const PUBLISHED = { id: true, version: true, language: true, tags: true, format: true, pdfFields: true } satisfies Prisma.TemplateVersionSelect;

/** Whose versions a slot stands on: its own, or its source's for a copy (as the template library). */
const fileSlot = (slot: TemplateSlot) => slot.copyOf ?? slot.key;

/** "full-time", "part-time" …: an employment type inside a sentence. */
const typeText = (t: EmploymentType) => LABELS.employmentType[t].toLowerCase();

/** What each restricted right is called in a message. */
const RIGHT_TEXT: Record<RestrictedRight, string> = { identity: 'the national ID', salary: 'salaries', bank: 'bank account details' };

/** A document's step in a sentence: "is already marked printed" … */
const STEP_DONE: Record<DocumentStatus, string> = {
  generated: 'is only generated',
  printed: 'is already marked printed',
  signed: 'already has its signed copy uploaded',
  verified: 'is already verified',
};

/** Everything a document of one slot is generated from. */
interface Context {
  slot: TemplateSlot;
  employee: { id: string; employeeCode: string; fullNameEn: string };
  employment: EmploymentRow;
  /** A contract slot's contract version, or the contract whose terms another document prints (null: none yet). */
  contract: ContractRow | null;
  ending: EmploymentRow['endings'][number] | null;
  sources: Omit<ValueSources, 'language' | 'documentDate' | 'inputs'>;
}

/**
 * A version's documents wait for the CEO when it changes the pay (owner's decisions, 16 October 2026): those of a raise
 * or a renewal with new pay are generated once approved.
 */
const awaitsCeo = (c: { approval: string | null }) => c.approval !== null && c.approval !== 'approved';

/**
 * What a raise's documents print beside its own terms (owner's decisions, 16 October 2026): the version it replaces,
 * why, the promotion, the contract an amendment adds to (back past the amendments before it), and the Form 2 date.
 * Null for a version that doesn't change the pay.
 */
function raiseSource(c: ContractRow, all: readonly ContractRow[]): ValueSources['raise'] {
  if (c.approval === null) return null;
  const before = (v: ContractRow) => all.find((x) => x.version === v.version - 1) ?? null;
  let base: ContractRow = c;
  while (base.kind === 'amendment' && before(base)) base = before(base)!;
  return {
    reason: c.raiseReason,
    previous: before(c),
    newJobTitle: c.newJobTitle,
    newGrade: c.newGrade,
    amended: c.kind === 'amendment' && base !== c ? { number: base.number, startDate: base.startDate } : null,
    form2From: c.form2From,
  };
}

/**
 * The contract pay a signed contract's insured wage stands on today, as payroll and the Social Insurance tab take it:
 * after a raise the pay before it until the raise's insured-wage date (owner's decision, 16 October 2026).
 */
function insuredTotalToday(c: ContractRow, all: readonly ContractRow[]): number | null {
  const versions = all.filter((v) => v.status !== 'draft').map(insuredVersionOf);
  return insuredContractPay(versions.find((v) => v.id === c.id) ?? null, versions, todayInCairo()).total;
}

/** The employment's contract whose terms a document other than a contract prints: the signed one, else the newest draft, else the newest. */
function termsContract(contracts: readonly ContractRow[]): ContractRow | null {
  const live = contracts.filter((c) => c.status !== 'superseded');
  return live.find((c) => c.status === 'active') ?? live.find((c) => c.status === 'draft') ?? live[0] ?? null;
}

/** Where the employment stands; `commissionPublished`: the commission slots with a published version (commissionSlots). */
function situation(e: EmploymentRow, commissionPublished: readonly string[]): Situation {
  return { employmentType: e.employmentType, paidByCommission: e.paidByCommission, commissionPublished, ending: e.endings[0] ?? null, ended: e.endDate !== null };
}

/** Why a slot isn't offered for the employment, in words HR act on. */
function notOffered(slot: TemplateSlot, s: Situation, name: string): string {
  if (!sectionOf(slot.key)) {
    return slot.folder === 'payslips' ? 'Payslips come from payroll, which isn’t available yet.' : `${slot.name} isn’t generated from the Employment tab.`;
  }
  if (!slot.appliesTo.includes(s.employmentType)) {
    const type = typeText(s.employmentType);
    // "an unpaid internship (outside the labour law) employment" (19 October 2026)
    const article = /^[aeiou]/.test(type) ? 'an' : 'a';
    return `${slot.name} is for ${slot.appliesTo.map(typeText).join(', ')} employments; ${name}’s is ${type}. Choose the document for ${article} ${type} employment.`;
  }
  // the commission contract and the full-time one stand for each other (owner, 18 October 2026)
  if (COMMISSION_SLOTS[slot.key]) {
    const instead = SLOTS.get(COMMISSION_SLOTS[slot.key])!.name;
    return s.paidByCommission
      ? `${slot.name} has no published version yet, so ${name}’s contract is ${instead}. Publish it in Templates first.`
      : `${slot.name} is for a full-time employment paid by commission; ${name}’s isn’t. Choose ${instead}.`;
  }
  const commission = Object.keys(COMMISSION_SLOTS).find((k) => COMMISSION_SLOTS[k] === slot.key);
  if (commission && s.paidByCommission && s.commissionPublished?.includes(commission)) {
    return `${name} is paid by commission: choose ${SLOTS.get(commission)!.name}.`;
  }
  // otherwise its moment hasn't come: the documents of an ending
  if (slot.key === 'insurance_form_6') return 'Form 6 is generated once the employment is ending or has ended. Record the ending on the Employment tab first.';
  if (s.ending) return 'The resignation request is only for an ending the employee started, such as a resignation.';
  return `${slot.name} is generated once an ending of the employment is recorded. Record it on the Employment tab first.`;
}

/** The 409 for a step taken in the wrong order. */
function wrongStep(status: string, wanted: string): ConflictException {
  return new ConflictException(`This document ${STEP_DONE[status as DocumentStatus] ?? `is ${status}`}: ${wanted}`);
}

/** An uploaded scan, checked by its content as paperwork is. */
function checkedScan(file: Express.Multer.File | undefined): { data: Buffer; type: PaperworkType } {
  if (!file?.buffer?.length) throw new BadRequestException('Choose the scan of the signed copy: a photo or a PDF.');
  if (file.size > PAPERWORK_MAX_BYTES) throw new BadRequestException(`The file must be ${PAPERWORK_MAX_MB} MB or smaller.`);
  const type = detectPaperworkType(file.buffer);
  if (!type) throw new BadRequestException('The scan must be a JPEG, PNG or WebP image, or a PDF.');
  return { data: file.buffer, type };
}

// Documents generated from the published templates: the profile's Employment tab (spec §8.3–8.4; owner's request, 15
// October 2026). The tab offers the documents that apply to the employment type and its situation, each with its
// generated copies; HR generates one once every tag its template prints has a value, then marks it printed, uploads
// the signed scan and verifies it. HR and the CEO view the tab and download the files; only HR generates and moves a
// document on; only a Super Admin deletes one. A document that prints restricted data (national ID, salary, bank
// account) needs the right to see it, and every view of it is written to the audit log.
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lawRates: LawRatesService,
    private readonly confidential: ConfidentialService,
    private readonly leave: LeaveSettlementService,
  ) {}

  /** The Employment tab: the documents offered for the current employment (else the latest), in sections. */
  async tab(employeeId: string) {
    await this.employee(employeeId);
    const employment = await this.employmentOf(employeeId);
    if (!employment) return { sections: SECTION_KEYS.map((key) => ({ key, items: [] })) };

    const s = situation(employment, await this.commissionSlots());
    const slots = offeredSlots(s);
    const keys = SECTION_KEYS.flatMap((k) => slots[k]);
    const [versions, rows] = await Promise.all([
      this.prisma.templateVersion.findMany({
        where: { slotKey: { in: keys.map((k) => fileSlot(SLOTS.get(k)!)) }, status: { in: ['draft', 'published'] } },
        select: { slotKey: true, version: true, status: true, tags: true },
      }),
      this.prisma.generatedDocument.findMany({
        where: { employeeId, employmentId: employment.id },
        select: DOCUMENT,
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
      }),
    ]);

    const template = (key: string) => {
      const own = versions.filter((v) => v.slotKey === fileSlot(SLOTS.get(key)!));
      const published = own.find((v) => v.status === 'published') ?? null;
      return {
        templateStatus: published ? 'published' : own.length ? 'draft' : 'missing',
        templateVersion: published?.version ?? null,
        needsInputs: published ? TYPED_TAGS.filter((t) => published.tags.includes(t)) : [],
      } as const;
    };
    // `startsOn`: a contract version's own documents are dated its start date unless HR picks another (owner, 25 October
    // 2026: "add default date the starting date and to be edited by HR if needed")
    const item = (key: string, docs: DocumentRow[], contract?: ContractRow, startsOn = false) => ({
      slotKey: key,
      name: SLOTS.get(key)!.name,
      ...(contract && { contractId: contract.id, contractNumber: contract.number, contractVersion: contract.version }),
      ...(contract && startsOn && { defaultDate: fromDateOnly(contract.startDate) }),
      ...template(key),
      documents: docs.filter((d) => d.slotKey === key).map(documentView),
    });

    // each contract version not replaced, newest first; a replaced one only while it has documents, which stay on record;
    // one that changes the pay once the CEO approved it (owner's decisions, 16 October 2026)
    const contracts = employment.contracts.filter((c) => (c.status !== 'superseded' || rows.some((d) => d.contractId === c.id)) && !awaitsCeo(c));
    // Form 2 for each approved raise (and renewal with new pay)
    const raises = contracts.filter((c) => c.approval === 'approved');
    const ending = employment.endings[0] ?? null;
    const ofVersion = (c: ContractRow) => rows.filter((d) => d.contractId === c.id);
    const items: Record<SectionKey, ReturnType<typeof item>[]> = {
      // an amendment's own letter, a contract's copies
      contract: contracts.flatMap((c) => versionSlots(c.kind, slots.contract).map((key) => item(key, ofVersion(c), c, true))),
      hiring: slots.hiring.map((key) => item(key, rows)),
      insurance: slots.insurance.flatMap((key) => (key === FORM_2_SLOT ? raises.map((c) => item(key, ofVersion(c), c)) : [item(key, rows)])),
      letters: slots.letters.map((key) => item(key, rows)),
      // the documents of the ending in hand: those of a withdrawn or rejected one no longer apply
      leaving: slots.leaving.map((key) => item(key, rows.filter((d) => d.endingId === ending?.id))),
    };
    return { sections: SECTION_KEYS.map((key) => ({ key, items: items[key] })) };
  }

  /** The tags the published template prints that have no value for this employee, and whether it prints restricted data. */
  async check(employeeId: string, dto: CheckDocumentDto) {
    const ctx = await this.context(employeeId, dto.slotKey, dto.contractId);
    const template = await this.published(ctx.slot);
    if (!template) throw new NotFoundException(`There is no published template for ${ctx.slot.name}. Upload it in Templates first.`);
    const { missing } = this.fill(ctx, template, todayInCairo(), {});
    return { missing, usesRestricted: restrictedTags(template.tags, ctx.slot.overrides).length > 0 };
  }

  /**
   * Generates a document: the published template filled in with the employee's values. Refused while any tag it
   * prints has no value (422, with what is missing and where to fill it in).
   */
  async generate(employeeId: string, dto: GenerateDocumentDto, user: SessionUser) {
    const ctx = await this.context(employeeId, dto.slotKey, dto.contractId);
    const { slot } = ctx;
    const template = await this.published(slot, true);
    if (!template) throw new ConflictException(`There is no published template for ${slot.name}. Upload it in Templates first.`);

    // restricted data only for those who may see it (generating is HR's, who may; checked all the same)
    const restricted = restrictedTags(template.tags, slot.overrides);
    const rights = new Set(restricted.flatMap((tag) => [rightFor(tag), rightFor(sourceTag(tag, slot.overrides))]).filter((r): r is RestrictedRight => r !== null));
    const may: Record<RestrictedRight, boolean> = { identity: seesIdentity(user), salary: seesSalary(user), bank: seesBank(user) };
    const denied = [...rights].filter((r) => !may[r]);
    if (denied.length) {
      throw new ForbiddenException(`${slot.name} prints ${denied.map((r) => RIGHT_TEXT[r]).join(' and ')}, which you can’t see, so you can’t generate it.`);
    }

    // what is typed when generating: asked for when the template prints it
    const inputs: Record<string, string> = {};
    for (const tag of TYPED_TAGS) {
      const value = dto.inputs?.[tag as keyof typeof dto.inputs];
      if (value) inputs[tag] = value;
    }
    const typed = TYPED_TAGS.filter((t) => template.tags.includes(t));
    const notTyped = typed.filter((t) => !inputs[t]);
    if (notTyped.length) {
      const say: Record<string, string> = { letter_to: 'who the letter is addressed to', letter_purpose: 'the purpose of the letter' };
      throw new BadRequestException(`Type ${notTyped.map((t) => say[t]).join(' and ')}.`);
    }

    const documentDate = dto.documentDate ?? todayInCairo();
    const { values, missing } = this.fill(ctx, template, documentDate, inputs);
    if (missing.length) throw new UnprocessableEntityException({ statusCode: 422, message: 'Fill in the missing details first.', missing });

    // a Word template's .docx, or a PDF form's PDF (owner's decision, 15 October 2026)
    const data = await fillVersion(template, values);
    const fileName = filledFileName(documentStem(slot.name, ctx.employee.employeeCode, ctx.employee.fullNameEn), template.format);
    const hasRestricted = restricted.length > 0;
    const row = await this.prisma.generatedDocument.create({
      data: {
        employeeId,
        employmentId: ctx.employment.id,
        contractId: isVersionSlot(slot.key) ? ctx.contract!.id : null,
        endingId: ENDING_SLOTS.includes(slot.key) ? (ctx.ending?.id ?? null) : null,
        slotKey: slot.key,
        templateVersionId: template.id,
        inputs: Object.fromEntries(typed.map((t) => [t, inputs[t]])),
        documentDate: toDateOnly(documentDate),
        fileName,
        data: new Uint8Array(data),
        sizeBytes: data.length,
        hasRestricted,
        status: 'generated',
        generatedById: user.id,
        note: dto.note ?? null,
      },
      select: DOCUMENT,
    });
    await this.audit.record({
      userId: user.id,
      action: 'generate',
      entityType: ENTITY,
      entityId: row.id,
      diff: {
        employeeId,
        slot: slot.key,
        templateVersion: template.version,
        contract: ctx.contract?.number ?? null,
        documentDate,
        fileName,
        sizeBytes: data.length,
        ...(typed.length && { inputs: row.inputs }),
      },
    });
    if (hasRestricted) await this.viewed(row.id, employeeId, slot.key, restricted, 'generated', user);
    return documentView(row);
  }

  /**
   * The filled .docx, or the PDF of a PDF form (given out only as a protected PDF: DocumentsController). A view of one
   * that prints restricted data is written to the audit log.
   */
  async file(id: string, user: SessionUser): Promise<{ data: Buffer; type: string; fileName: string }> {
    const d = await this.prisma.generatedDocument.findUnique({
      where: { id },
      select: { employeeId: true, slotKey: true, fileName: true, data: true, hasRestricted: true, templateVersion: { select: { tags: true } } },
    });
    if (!d) throw new NotFoundException('Document not found.');
    if (d.hasRestricted) await this.viewed(id, d.employeeId, d.slotKey, this.restrictedOf(d.slotKey, d.templateVersion.tags), 'file', user);
    return { data: Buffer.from(d.data), type: isPdf(d.data) ? 'application/pdf' : DOCX_MIME, fileName: d.fileName };
  }

  /**
   * The filled .docx for an unprotected PDF to send for e-signature (HR only): every download is recorded, whatever the
   * document prints (owner, 15 October 2026: Adobe Sign refuses the protected PDF).
   */
  async eSignatureFile(id: string, user: SessionUser): Promise<{ data: Buffer; type: string; fileName: string }> {
    const d = await this.prisma.generatedDocument.findUnique({
      where: { id },
      select: { employeeId: true, slotKey: true, fileName: true, data: true, templateVersion: { select: { tags: true } } },
    });
    if (!d) throw new NotFoundException('Document not found.');
    await this.audit.record({
      userId: user.id,
      action: 'download_unprotected',
      entityType: ENTITY,
      entityId: id,
      diff: { employeeId: d.employeeId, slot: d.slotKey, purpose: 'e-signature', fields: this.restrictedOf(d.slotKey, d.templateVersion.tags) },
    });
    return { data: Buffer.from(d.data), type: isPdf(d.data) ? 'application/pdf' : DOCX_MIME, fileName: d.fileName };
  }

  /** Generated → printed. */
  async printed(id: string, user: SessionUser) {
    const { count } = await this.prisma.generatedDocument.updateMany({
      where: { id, status: 'generated' },
      data: { status: 'printed', printedById: user.id, printedAt: new Date() },
    });
    const row = await this.row(id);
    if (!count) throw wrongStep(row.status, 'only a generated document is marked printed.');
    await this.stepped(row, 'print', 'generated', user);
    return documentView(row);
  }

  /**
   * The scan of the signed copy (a photo or a PDF, checked as paperwork is): generated or printed → signed. Until the
   * document is verified, a scan uploaded again replaces the one before (a page missed, a blurred photo).
   */
  async signed(id: string, file: Express.Multer.File | undefined, user: SessionUser) {
    const before = await this.row(id);
    if (before.status === 'verified') throw wrongStep(before.status, 'its signed copy can’t be replaced.');
    const { data, type } = checkedScan(file);
    const stem = before.fileName.replace(/\.(docx|pdf)$/i, '');
    const signedFileName = safeFileName(`${stem} (signed).${extensionOf(type)}`, type);
    const { count } = await this.prisma.generatedDocument.updateMany({
      where: { id, status: { in: ['generated', 'printed', 'signed'] } },
      data: {
        status: 'signed',
        signedFileName,
        signedMime: type,
        signedSize: data.length,
        signedData: new Uint8Array(data),
        signedUploadedById: user.id,
        signedUploadedAt: new Date(),
      },
    });
    const row = await this.row(id);
    if (!count) throw wrongStep(row.status, 'its signed copy can’t be replaced.'); // verified since it was read
    await this.audit.record({
      userId: user.id,
      action: before.status === 'signed' ? 'update' : 'sign',
      entityType: ENTITY,
      entityId: id,
      diff: {
        employeeId: row.employeeId,
        slot: row.slotKey,
        ...(before.status !== 'signed' && { status: { from: before.status, to: 'signed' } }),
        ...(before.status === 'signed' && { replaced: before.signedFileName }),
        signedFileName,
        signedSize: data.length,
      },
    });
    return documentView(row);
  }

  /** The scan of the signed copy. A view of one that prints restricted data is written to the audit log. */
  async signedFile(id: string, user: SessionUser): Promise<{ data: Buffer; type: string; fileName: string }> {
    const d = await this.prisma.generatedDocument.findUnique({
      where: { id },
      select: {
        employeeId: true,
        slotKey: true,
        hasRestricted: true,
        signedData: true,
        signedMime: true,
        signedFileName: true,
        templateVersion: { select: { tags: true } },
      },
    });
    if (!d) throw new NotFoundException('Document not found.');
    if (!d.signedData || !d.signedMime || !d.signedFileName) throw new NotFoundException('The signed copy of this document hasn’t been uploaded yet.');
    if (d.hasRestricted) await this.viewed(id, d.employeeId, d.slotKey, this.restrictedOf(d.slotKey, d.templateVersion.tags), 'signed copy', user);
    return { data: Buffer.from(d.signedData), type: d.signedMime, fileName: d.signedFileName };
  }

  /** Signed → verified: HR checked the signed scan. */
  async verify(id: string, user: SessionUser) {
    const { count } = await this.prisma.generatedDocument.updateMany({
      where: { id, status: 'signed' },
      data: { status: 'verified', verifiedById: user.id, verifiedAt: new Date() },
    });
    const row = await this.row(id);
    if (!count) {
      throw row.status === 'verified' ? wrongStep(row.status, 'there is nothing more to do.') : wrongStep(row.status, 'upload the signed copy before verifying it.');
    }
    await this.stepped(row, 'verify', 'signed', user);
    return documentView(row);
  }

  /** A Super Admin deletes a document, with its file and signed scan. */
  async remove(id: string, user: SessionUser): Promise<void> {
    assertDeletes(user);
    const row = await this.row(id);
    await this.prisma.generatedDocument.delete({ where: { id } });
    await this.audit.record({
      userId: user.id,
      action: 'delete',
      entityType: ENTITY,
      entityId: id,
      diff: { employeeId: row.employeeId, slot: row.slotKey, status: row.status, fileName: row.fileName, signedFileName: row.signedFileName },
    });
  }

  /**
   * A template version (a draft too) filled in with one employee's data, to preview it (owner's request, 15 October
   * 2026): from what generation reads, whether or not the Employment tab offers the document to them. Nothing is refused
   * and nothing saved: a tag with no value prints as its label in square brackets (a PDF form's optional field, blank,
   * as on the document), a restricted value the caller may not see as •••• (preview.ts). Without the version's file (`data`), only how many of its tags have a value. The
   * restricted values printed (`shown`) are for the caller to write to the audit log once the file is handed over.
   */
  async previewFill(
    employeeId: string,
    slotKey: string,
    template: { language: string; tags: string[]; data?: Uint8Array; format?: string; pdfFields?: Prisma.JsonValue | null },
    user: SessionUser,
  ): Promise<{ employee: { id: string; employeeCode: string; fullNameEn: string }; filled: number; total: number; shown: string[]; data: Buffer | null }> {
    const slot = SLOTS.get(slotKey);
    if (!slot) throw new NotFoundException('Template not found.');
    // never a C-level person's data in a preview for anyone but the CEO and a Super Admin (owner, 19 October 2026)
    await this.confidential.assertVisible(user, employeeId);
    // context() refuses a document the tab doesn't offer them (a resignation request before any ending) and a contract
    // copy without its version. What it reads doesn't depend on the document but for the contract, which here is the one
    // other documents print (the signed one, else the newest draft); so it is read through the document itself when the
    // tab offers it, else through one the tab does, and the document's own slot (its overrides) is put back.
    const employment = await this.employmentOf(employeeId);
    const s = employment && situation(employment, await this.commissionSlots());
    const offers = s ? SECTION_KEYS.flatMap((k) => offeredSlots(s)[k]).filter((k) => !isVersionSlot(k)) : [];
    const through = offers.includes(slot.key) ? slot.key : (offers[0] ?? slot.key);
    const ctx: Context = { ...(await this.context(employeeId, through, undefined)), slot };
    const { values } = this.fill(ctx, template, todayInCairo(), {});
    // every tag with no value, those optional fields print too; nothing is typed for a preview
    const empty = new Set([...template.tags.filter((tag) => isBlankValue(values[tag])), ...TYPED_TAGS]);
    const preview = previewValues(template.tags, values, empty, slot.overrides, { identity: seesIdentity(user), salary: seesSalary(user), bank: seesBank(user) });
    // a PDF form's optional fields with no value print blank, as on the document
    const data = template.data
      ? await fillVersion({ ...template, slotKey: slot.key, format: template.format ?? 'docx', data: template.data }, preview.values, new Set(preview.placeholders))
      : null;
    return { employee: ctx.employee, filled: preview.filled, total: preview.total, shown: data ? preview.shown : [], data };
  }

  // ---------- helpers ----------

  private async employee(id: string) {
    const e = await this.prisma.employee.findUnique({ where: { id }, select: { id: true, employeeCode: true, fullNameEn: true } });
    if (!e) throw new NotFoundException('Employee not found.');
    return e;
  }

  /** The commission slots (COMMISSION_SLOTS) with a published version: chosen for an employment paid by commission. */
  private async commissionSlots(): Promise<string[]> {
    const rows = await this.prisma.templateVersion.findMany({
      where: { slotKey: { in: Object.keys(COMMISSION_SLOTS) }, status: 'published' },
      select: { slotKey: true },
      distinct: ['slotKey'],
    });
    return rows.map((r) => r.slotKey);
  }

  /** The current employment, else the latest; null for someone never employed. */
  private employmentOf(employeeId: string): Promise<EmploymentRow | null> {
    return this.prisma.employment.findFirst({ where: { employeeId }, select: EMPLOYMENT, orderBy: NEWEST_FIRST });
  }

  /** Everything a document of this slot is generated from, refused when the tab doesn't offer it. */
  private async context(employeeId: string, slotKey: string, contractId: string | undefined): Promise<Context> {
    const employee = await this.employee(employeeId);
    const slot = SLOTS.get(slotKey);
    if (!slot) throw new BadRequestException('Choose a document the Employment tab offers.');
    const employment = await this.employmentOf(employeeId);
    if (!employment) throw new BadRequestException(`${employee.fullNameEn} has no employment yet. Add it on the Employment tab before generating documents.`);
    const s = situation(employment, await this.commissionSlots());
    if (!offered(slot.key, s)) throw new BadRequestException(notOffered(slot, s, employee.fullNameEn));

    let contract: ContractRow | null;
    if (contractId) {
      contract = employment.contracts.find((c) => c.id === contractId) ?? null;
      if (!contract) {
        const elsewhere = await this.prisma.contract.findFirst({ where: { id: contractId, employment: { employeeId } }, select: { number: true } });
        if (!elsewhere) throw new NotFoundException('Contract not found.');
        throw new BadRequestException(`${elsewhere.number} belongs to an earlier employment: documents are generated for the current one.`);
      }
      if (contract.status === 'superseded') {
        const newer = employment.contracts.find((c) => c.version > contract!.version && c.status !== 'superseded');
        throw new ConflictException(`${contract.number} was replaced${newer ? ` by ${newer.number}` : ''}. Generate the documents of the newer version.`);
      }
      // a change of pay's documents once the CEO approved it; an amendment's letter, a contract's copies, a raise's Form 2
      if (awaitsCeo(contract)) throw new ConflictException(`${contract.number} changes the pay: its documents are generated once the CEO approves it.`);
      if (slot.key === AMENDMENT_SLOT && contract.kind !== 'amendment') {
        throw new BadRequestException(`${contract.number} is a whole contract: generate its contract copies. ${slot.name} is for a salary amendment.`);
      }
      if (isContractSlot(slot.key) && slot.key !== AMENDMENT_SLOT && contract.kind === 'amendment') {
        throw new BadRequestException(`${contract.number} is a salary amendment: generate its ${SLOTS.get(AMENDMENT_SLOT)!.name} instead of a whole contract.`);
      }
      if (slot.key === FORM_2_SLOT && contract.approval === null) throw new BadRequestException(`${contract.number} doesn't change the pay: Form 2 is for a raise.`);
    } else if (isVersionSlot(slot.key)) {
      throw new BadRequestException(`Choose the contract version to generate ${slot.name} for.`);
    } else {
      contract = termsContract(employment.contracts);
    }

    const ending = employment.endings[0] ?? null;
    const [person, company, offer, settings, lawYears, settlement] = await Promise.all([
      this.prisma.employee.findUniqueOrThrow({
        where: { id: employeeId },
        select: {
          employeeCode: true,
          fullNameEn: true,
          fullNameAr: true,
          displayName: true,
          nationality: true,
          gender: true,
          dateOfBirth: true,
          addressAr: true,
          city: true,
          governorate: true,
          buildingNo: true,
          mobile: true,
          workEmail: true,
          personalEmail: true,
          qualificationAr: true,
          insuranceNo: true,
          // what the Social Insurance tab holds (owner, 16 October 2026): the occupation, the subscription start, the
          // basic and comprehensive wages (the insured wage is worked out from the comprehensive one)
          occupationCode: true,
          insuranceStartDate: true,
          insuranceBasicWage: true,
          insuranceComprehensiveWage: true,
          identity: { select: { nationalId: true, printedNo: true, issueDate: true } },
          bank: { select: { bankName: true, accountNo: true, iban: true, holderName: true } },
        },
      }),
      this.prisma.company.findUnique({ where: { id: 1 } }),
      // {{offer_number}} and {{offer_expiry}} on an employee's documents: the job offer they accepted (the latest)
      this.prisma.jobOffer.findFirst({
        where: { employeeId, status: 'accepted' },
        orderBy: [{ respondedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        select: { number: true, expiresOn: true },
      }),
      // the basic wage social insurance forms print for an employee who has none of their own (owner, 16 October 2026)
      this.prisma.contractSettings.findUnique({ where: { id: 1 }, select: { insuranceBasicDefault: true } }),
      // the rates set by law: the insured wage Form 1 prints is within this year's insurable limits
      this.lawRates.years(),
      // what the clearance and dues prints of the final settlement (20 October 2026)
      this.settlementOf(employeeId, employment, ending),
    ]);
    const { identity, bank, ...own } = person;
    const insuranceBasicDefault = settings?.insuranceBasicDefault.toNumber() ?? INSURANCE_BASIC_DEFAULT;
    return {
      slot,
      employee,
      employment,
      contract,
      ending,
      sources: {
        employee: own,
        identity,
        bank,
        employment,
        contract,
        ending,
        offer,
        company,
        insuranceBasicDefault,
        lawYears,
        settlement,
        raise: contract && raiseSource(contract, employment.contracts),
        ...(contract && contract.status !== 'draft' && { insuredContractTotal: insuredTotalToday(contract, employment.contracts) }),
      },
    };
  }

  /**
   * The final settlement of an employment with an ending recorded, or ended, as its documents print it (20 October 2026:
   * the owner unsure, Claude recommended listing its deductions on the clearance and dues); null before. The advances
   * and loans still owed: those open with something outstanding (deducted, by the owner's rule of 18 October 2026:
   * "taken from the final settlement, unless waived"), and those HR settled as deducted from the final settlement or
   * waived (POST /payroll/advances/:id/settle) since the leaving was known, the notice given or else the end date, in
   * Cairo; with what was still owed of each, the recoveries applied before taken off. The unused annual leave as the
   * final settlement lists it (Unsettled), worked out once the employment has its end date.
   */
  private async settlementOf(employeeId: string, employment: EmploymentRow, ending: EmploymentRow['endings'][number] | null): Promise<SettlementSource | null> {
    const since = [ending?.noticeGivenOn, employment.endDate]
      .filter((d): d is Date => d instanceof Date)
      .map((d) => fromDateOnly(d))
      .sort()[0];
    if (!since) return null;
    const [advances, unused] = await Promise.all([
      this.prisma.payrollAdvance.findMany({
        where: { employeeId, OR: [{ status: 'open' }, { status: 'settled', settledHow: { in: ['final_settlement', 'waived'] } }] },
        orderBy: [{ givenOn: 'asc' }, { createdAt: 'asc' }],
        select: { kind: true, reason: true, amount: true, status: true, settledHow: true, settledAt: true, recoveries: { select: { amount: true, status: true } } },
      }),
      employment.endDate ? this.leave.unused([employment.id]) : null,
    ]);
    const owed = advances
      .filter((a) => a.status === 'open' || (a.settledAt !== null && dayInCairo(a.settledAt) >= since))
      .map((a) => ({
        kind: a.kind,
        reason: a.reason,
        // a recovery always has its amount (only a bonus or penalty in days has none)
        outstanding: advanceBalance(a.amount.toNumber(), a.recoveries.map((r) => ({ amount: r.amount?.toNumber() ?? 0, status: r.status as AdjustmentStatus }))).outstanding,
        waived: a.settledHow === 'waived',
      }))
      .filter((a) => a.outstanding > 0);
    const leave = unused?.get(employment.id);
    return { owed, unusedLeave: leave && leave.days > 0 ? { days: leave.days, dayRate: leave.dayRate, amount: leave.amount } : null };
  }

  /** The slot's published version: its tags, language, format and (a PDF) fields, and its file when it is to be filled in. */
  private published(slot: TemplateSlot): Promise<{ id: string; version: number; language: string; tags: string[]; format: string; pdfFields: Prisma.JsonValue | null } | null>;
  private published(
    slot: TemplateSlot,
    withFile: true,
  ): Promise<{ id: string; version: number; language: string; tags: string[]; format: string; data: Uint8Array; pdfFields: Prisma.JsonValue | null; slotKey: string } | null>;
  private published(slot: TemplateSlot, withFile = false): Promise<unknown> {
    return this.prisma.templateVersion.findFirst({
      where: { slotKey: fileSlot(slot), status: 'published' },
      select: withFile ? { ...PUBLISHED, ...FILLED_FROM } : PUBLISHED,
    });
  }

  /**
   * The values of the tags the template prints, and those of them still empty that stop the document: on a PDF form,
   * not those only optional fields print (owner, 15 October 2026), which are left blank.
   */
  private fill(
    ctx: Context,
    template: { language: string; tags: string[]; pdfFields?: Prisma.JsonValue | null },
    documentDate: string,
    inputs: Record<string, string>,
  ): { values: Record<string, TagValue>; missing: MissingTag[] } {
    const sources: ValueSources = { ...ctx.sources, language: template.language as TemplateLanguage, documentDate, inputs };
    const values = resolveValues(sources, template.tags, ctx.slot.overrides);
    return { values, missing: missingTags(values, requiredTags(template), ctx.slot.overrides, ctx.contract !== null) };
  }

  /** The restricted tags a document of this slot prints, from its template version's tags. */
  private restrictedOf(slotKey: string, tags: readonly string[]): string[] {
    return restrictedTags(tags, SLOTS.get(slotKey)?.overrides);
  }

  private async row(id: string): Promise<DocumentRow> {
    const d = await this.prisma.generatedDocument.findUnique({ where: { id }, select: DOCUMENT });
    if (!d) throw new NotFoundException('Document not found.');
    return d;
  }

  /** A step of the lifecycle (print, verify), for the audit log. */
  private async stepped(row: DocumentRow, action: 'print' | 'verify', from: DocumentStatus, user: SessionUser) {
    await this.audit.record({
      userId: user.id,
      action,
      entityType: ENTITY,
      entityId: row.id,
      diff: { employeeId: row.employeeId, slot: row.slotKey, status: { from, to: row.status } },
    });
  }

  /** Restricted data seen: generating a document that prints it, or downloading its file or its signed copy. */
  private async viewed(id: string, employeeId: string, slotKey: string, tags: string[], seen: 'generated' | 'file' | 'signed copy', user: SessionUser) {
    await this.audit.record({
      userId: user.id,
      action: 'view_restricted',
      entityType: ENTITY,
      entityId: id,
      diff: { employeeId, slot: slotKey, fields: tags, seen },
    });
  }
}
