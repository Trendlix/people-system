import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  decidesConfidentialStage,
  noticeSentence,
  resignationOffered,
  resignationProblems,
  RESIGNATION_LETTER_NO_TEMPLATE,
  RESIGNATION_NOT_UNDER_LAW,
  RESIGNATION_REQUEST_STATUS_LABELS,
  type NoticeUnit,
  type ResignationRequestStatus,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { actsAs } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { toDateOnly, todayInCairo } from '../common/date-only.js';
import { noticeEnds } from '../contracts/notice.js';
import type { CreateEndingDto } from '../contracts/contracts.dto.js';
import { EndingsService } from '../contracts/endings.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { NoticesService } from '../notifications/notices.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { checkedLetter } from './letter.js';
import type { CreateResignationRequestDto, ReturnResignationRequestDto } from './resignation-requests.dto.js';
import { LETTER_ENTITY, REQUEST_INCLUDE, REQUEST_OMIT, requestView, RESIGNATION_ENTITY, type RequestRow, type Viewer } from './views.js';

/** The endings still going for an employment: a resignation can't be asked while one is recorded. */
const OPEN_ENDINGS = ['pending_ceo', 'approved'];

/** A request whose signed letter HR keeps: waiting for HR, or recorded (owner, 31 October 2026); not one withdrawn or returned. */
const KEEPS_LETTER: string[] = ['sent', 'recorded'];

const statusText = (status: string) => (RESIGNATION_REQUEST_STATUS_LABELS[status as ResignationRequestStatus] ?? status).toLowerCase();

// An employee's request to resign (owner, 26 October 2026: "but the employee has to request resignation and then the HR
// generates the document"; packages/shared resignation-request.ts). The employee sends it from My Requests: a short
// reason and a preferred last working day if they have one; the day it is sent (Cairo) is the notice received day. HR is
// told (the CEO for a C-level person, whose request HR never sees: ConfidentialService), the direct manager is told and
// sees it without the reason or the letters, and neither decides: HR presses "Record the resignation", which makes the
// ending of the End employment form's kind (EndingsService.create, so its rules, certification, CEO approval and
// completion carry on as before) and links it here; the request is then Recorded. The employee may withdraw it until
// then; HR may return it with a reason (a mistaken request) and the employee may send it again.
//
// The letter (owner, 31 October 2026: "on the resignation, the letter is auto generated, viewed by the employee but
// uploaded by the HR"): People fills the published Resignation request template in from the request whenever it is
// opened (DocumentsService.resignationLetter), for the employee to print and sign, and HR (the CEO for a C-level person)
// uploads the signed copy, replaceable. Both are for the employee, HR and the CEO, never the manager. Every step is in
// the audit log, each letter's every opening and the signed copy's every upload too.
@Injectable()
export class ResignationRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly notices: NoticesService,
    private readonly endings: EndingsService,
    private readonly documents: DocumentsService,
  ) {}

  // ---------- the employee's own ----------

  /**
   * Their requests, newest first, and whether and how they may send one now: the resignation rule's notice and the last
   * working day it would give if sent today (the form's hint).
   */
  async mine(user: SessionUser) {
    const employeeId = user.employeeId ?? null;
    const rows = employeeId
      ? await this.prisma.resignationRequest.findMany({ where: { employeeId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: REQUEST_INCLUDE, omit: REQUEST_OMIT })
      : [];
    const confidential = employeeId ? await this.confidential.isConfidential(employeeId) : false;
    const ready = await this.documents.resignationLetterReady();
    return { requests: rows.map((r) => requestView(r, 'self', confidential, ready)), form: await this.form(employeeId) };
  }

  /** What the form says before it is sent. */
  private async form(employeeId: string | null) {
    const today = todayInCairo();
    const base = { today, notice: null as string | null, noticeAmount: null as number | null, noticeUnit: null as string | null, lastDayIfToday: null as string | null };
    if (!employeeId) return { ...base, offered: false, refusal: 'Only someone with an employee profile can send a resignation request.' };
    const employment = await this.currentEmployment(employeeId);
    if (!employment) return { ...base, offered: false, refusal: 'You have no current employment to resign from.' };
    if (!resignationOffered(employment.employmentType)) return { ...base, offered: false, refusal: RESIGNATION_NOT_UNDER_LAW };
    const rule = await this.prisma.endingRule.findUnique({ where: { key: 'resignation' } });
    if (!rule || !rule.active) return { ...base, offered: false, refusal: 'Resignation is turned off in the ending rules. Ask HR.' };
    const notice = { notice: noticeSentence(rule.noticeAmount, rule.noticeUnit), noticeAmount: rule.noticeAmount, noticeUnit: rule.noticeUnit, lastDayIfToday: noticeEnds(today, rule.noticeAmount, rule.noticeUnit as NoticeUnit, employment.shift?.workingDays) };
    const open = await this.prisma.resignationRequest.findFirst({ where: { employmentId: employment.id, status: 'sent' }, select: { id: true } });
    if (open) return { ...base, ...notice, offered: false, refusal: 'You already have a resignation request waiting for HR. Withdraw it first to send another.' };
    const ending = await this.prisma.employmentEnding.findFirst({ where: { employmentId: employment.id, status: { in: OPEN_ENDINGS } }, select: { status: true } });
    if (ending) return { ...base, ...notice, offered: false, refusal: 'An ending of your employment is already recorded. Ask HR.' };
    return { ...base, ...notice, offered: true, refusal: null };
  }

  /**
   * Sends a request: refused with every reason; one open (sent) at a time, even when two are sent together. No letter
   * comes with it (owner, 31 October 2026): People prepares it from the request (generatedLetter).
   */
  async create(dto: CreateResignationRequestDto, user: SessionUser) {
    const employeeId = user.employeeId ?? null;
    if (!employeeId) throw new ForbiddenException('Only someone with an employee profile can send a resignation request.');
    const employment = await this.currentEmployment(employeeId);
    if (!employment) throw new ConflictException('You have no current employment to resign from.');
    if (!resignationOffered(employment.employmentType)) throw new ConflictException(RESIGNATION_NOT_UNDER_LAW);
    const rule = await this.prisma.endingRule.findUnique({ where: { key: 'resignation' } });
    if (!rule || !rule.active) throw new ConflictException('Resignation is turned off in the ending rules. Ask HR.');

    const today = todayInCairo();
    const problems = resignationProblems({ reason: dto.reason ?? '', preferredLastDay: dto.preferredLastDay ?? null, confirmed: dto.confirmed === true }, today);
    if (problems.length) throw new BadRequestException(problems);

    const ending = await this.prisma.employmentEnding.findFirst({ where: { employmentId: employment.id, status: { in: OPEN_ENDINGS } }, select: { id: true } });
    if (ending) throw new ConflictException('An ending of your employment is already recorded. Ask HR.');

    const ruleLastDay = noticeEnds(today, rule.noticeAmount, rule.noticeUnit as NoticeUnit, employment.shift?.workingDays);
    const made = await this.prisma.$transaction(async (tx) => {
      // one waiting at a time, even when two are sent together: the employee's row is held until this one is saved
      await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
      const open = await tx.resignationRequest.findFirst({ where: { employmentId: employment.id, status: 'sent' }, select: { id: true } });
      if (open) throw new ConflictException('You already have a resignation request waiting for HR. Withdraw it first to send another.');
      return tx.resignationRequest.create({
        data: {
          employeeId,
          employmentId: employment.id,
          reason: (dto.reason ?? '').trim(),
          preferredLastDay: dto.preferredLastDay ? toDateOnly(dto.preferredLastDay) : null,
          sentOn: toDateOnly(today),
          noticeAmount: rule.noticeAmount,
          noticeUnit: rule.noticeUnit,
          ruleLastDay: toDateOnly(ruleLastDay),
        },
        include: REQUEST_INCLUDE,
        omit: REQUEST_OMIT,
      });
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: RESIGNATION_ENTITY,
      entityId: made.id,
      diff: { employeeId, employmentId: employment.id, status: 'sent', sentOn: today, preferredLastDay: dto.preferredLastDay ?? null, ruleLastDay, reason: dto.reason ?? '' },
    });
    await this.notices.resignationSent(made.id);
    return requestView(made, 'self', await this.confidential.isConfidential(employeeId), await this.documents.resignationLetterReady());
  }

  /** The employee withdraws their request while it is still waiting for HR; it is kept, marked withdrawn. */
  async withdraw(id: string, user: SessionUser) {
    const before = await this.row(id);
    if (!user.employeeId || before.employeeId !== user.employeeId) throw new NotFoundException('Resignation request not found.');
    const moved = await this.prisma.resignationRequest.updateMany({ where: { id, status: 'sent' }, data: { status: 'withdrawn', withdrawnAt: new Date() } });
    if (!moved.count) {
      throw new ConflictException(before.status === 'recorded' ? 'HR has recorded your resignation, so it can no longer be withdrawn here. Talk to HR.' : `This request is ${statusText(before.status)}.`);
    }
    await this.audit.record({
      userId: user.id,
      action: 'withdraw',
      entityType: RESIGNATION_ENTITY,
      entityId: id,
      diff: { employeeId: before.employeeId, employmentId: before.employmentId, status: { from: 'sent', to: 'withdrawn' } },
    });
    return requestView(await this.row(id), 'self', await this.confidential.isConfidential(before.employeeId), await this.documents.resignationLetterReady());
  }

  // ---------- HR, the CEO and the direct manager ----------

  /**
   * HR, the CEO and a Super Admin see every request (a C-level person's only the CEO and a Super Admin); a direct manager
   * those of their direct reports, without the reason and the letter. Newest first; `status` narrows them.
   */
  async list(status: ResignationRequestStatus | undefined, user: SessionUser) {
    const me = user.employeeId ?? null;
    const full = actsAs(user.roles, ['hr', 'ceo', 'super_admin']);
    const view = await this.confidential.view(user);
    const rows = await this.prisma.resignationRequest.findMany({
      where: {
        ...(status && { status }),
        ...(full ? (view.hidden.size ? { employeeId: { notIn: [...view.hidden] } } : {}) : { employment: { managerId: me ?? '00000000-0000-0000-0000-000000000000' }, employeeId: { notIn: [...view.hidden] } }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: REQUEST_INCLUDE,
      omit: REQUEST_OMIT,
    });
    const ready = await this.documents.resignationLetterReady();
    return rows.map((r) => requestView(r, full ? 'full' : 'manager', view.all.has(r.employeeId), ready));
  }

  /**
   * One request, as the caller may see it: 404 for anyone else, and for a C-level person's hidden from them. With
   * whether the caller records or returns it, and uploads its signed letter.
   */
  async one(id: string, user: SessionUser) {
    const r = await this.row(id);
    const viewer = await this.viewerOf(r, user);
    const decides = await this.mayRecord(r, user);
    return {
      ...requestView(r, viewer, await this.confidential.isConfidential(r.employeeId), await this.documents.resignationLetterReady()),
      canRecord: decides,
      canUploadLetter: decides && KEEPS_LETTER.includes(r.status),
    };
  }

  /** The signed letter, for the employee, HR and the CEO who see the request's details; each opening is audited. */
  async letter(id: string, user: SessionUser) {
    const r = await this.row(id);
    const viewer = await this.viewerOf(r, user);
    if (viewer === 'manager') throw new ForbiddenException('The letter is for the employee, HR and the CEO.');
    const file = await this.prisma.resignationRequest.findUnique({ where: { id }, select: { letterName: true, letterMime: true, letterData: true } });
    if (!file?.letterData || !file.letterName || !file.letterMime) throw new NotFoundException('The signed letter hasn’t been uploaded yet.');
    await this.audit.record({ userId: user.id, action: 'view_restricted', entityType: LETTER_ENTITY, entityId: id, diff: { requestId: id, employeeId: r.employeeId, fields: ['file'] } });
    return { data: Buffer.from(file.letterData.buffer, file.letterData.byteOffset, file.letterData.byteLength), type: file.letterMime, fileName: file.letterName };
  }

  /**
   * The letter People prepares from the request (owner, 31 October 2026: "on the resignation, the letter is auto
   * generated, viewed by the employee but uploaded by the HR"), as a filled document, for the employee, HR and the CEO;
   * the controller gives it out as a protected PDF. 409 while no Resignation request template is published. Each opening
   * is audited, as the signed letter's.
   */
  async generatedLetter(id: string, user: SessionUser): Promise<{ data: Buffer; fileName: string }> {
    const r = await this.row(id);
    const viewer = await this.viewerOf(r, user);
    if (viewer === 'manager') throw new ForbiddenException('The letter is for the employee, HR and the CEO.');
    const file = await this.documents.resignationLetter(r.employeeId, { id, sentOn: r.sentOn, lastWorkingDay: r.preferredLastDay ?? r.ruleLastDay, reason: r.reason });
    if (!file) throw new ConflictException(RESIGNATION_LETTER_NO_TEMPLATE);
    await this.audit.record({
      userId: user.id,
      action: 'view_restricted',
      entityType: LETTER_ENTITY,
      entityId: id,
      diff: { requestId: id, employeeId: r.employeeId, letter: 'generated', templateVersion: file.templateVersion, fields: ['file', ...file.restricted] },
    });
    return { data: file.data, fileName: file.fileName };
  }

  /**
   * HR uploads the signed letter (owner, 31 October 2026), a PDF or a photo checked by its content: HR; a C-level
   * person's the CEO (or HR with Super Admin), never for themself. While the request waits or once it is recorded; one
   * uploaded again replaces the one before (a page missed, a blurred photo), as does one the employee attached before.
   */
  async uploadLetter(id: string, file: Express.Multer.File | undefined, user: SessionUser) {
    const before = await this.row(id);
    const viewer = await this.viewerOf(before, user);
    if (viewer === 'self') throw new ForbiddenException('HR keeps the signed copy of your letter: hand it to HR.');
    const confidential = await this.confidential.isConfidential(before.employeeId);
    if (!(await this.mayRecord(before, user))) {
      throw new ForbiddenException(confidential ? "A C-level person's signed letter is kept by the CEO, not HR." : 'Only HR uploads the signed letter.');
    }
    if (!KEEPS_LETTER.includes(before.status)) throw new ConflictException(`This request is ${statusText(before.status)}, so its signed letter isn't kept.`);
    const { letter, problems } = checkedLetter(file);
    if (!letter) throw new BadRequestException(problems);
    const kept = await this.prisma.resignationRequest.updateMany({
      where: { id, status: { in: KEEPS_LETTER } },
      data: { letterName: letter.fileName, letterMime: letter.mimeType, letterSize: letter.sizeBytes, letterData: new Uint8Array(letter.data) },
    });
    if (!kept.count) throw new ConflictException('This request was just withdrawn or returned. Reload the page to see where it stands.');
    await this.audit.record({
      userId: user.id,
      action: 'attach_signed',
      entityType: LETTER_ENTITY,
      entityId: id,
      diff: { requestId: id, employeeId: before.employeeId, letterFileName: letter.fileName, sizeBytes: letter.sizeBytes, ...(before.letterName && { replaced: before.letterName }) },
    });
    return requestView(await this.row(id), 'full', confidential, await this.documents.resignationLetterReady());
  }

  /**
   * "Record the resignation": HR (the CEO, or HR with Super Admin, for a C-level person) records the ending the End
   * employment form makes, from the request. The body is that form's; the way must be the resignation. The request is
   * claimed first (so two presses make one ending), the ending made as it is made on the profile, and the request linked
   * to it; if the ending is refused, the request is as it was.
   */
  async record(id: string, dto: CreateEndingDto, user: SessionUser) {
    const before = await this.row(id);
    await this.assertDecides(before, user, 'recorded');
    if (dto.ruleKey !== 'resignation') throw new BadRequestException('A resignation request is recorded as a resignation.');
    if (before.status !== 'sent') throw new ConflictException(`This request is ${statusText(before.status)}, so it can't be recorded now.`);
    if (before.employment.endDate) throw new ConflictException('This employment has already ended.');

    const claimed = await this.prisma.resignationRequest.updateMany({ where: { id, status: 'sent' }, data: { status: 'recorded', recordedById: user.id, recordedAt: new Date() } });
    if (!claimed.count) throw new ConflictException('This request was just recorded or withdrawn. Reload the page to see where it stands.');
    let ending: Awaited<ReturnType<EndingsService['create']>>;
    try {
      ending = await this.endings.create(before.employeeId, before.employmentId, dto, user);
    } catch (err) {
      await this.prisma.resignationRequest.updateMany({ where: { id, status: 'recorded', endingId: null }, data: { status: 'sent', recordedById: null, recordedAt: null } });
      throw err;
    }
    await this.prisma.resignationRequest.update({ where: { id }, data: { endingId: ending.id } });
    await this.audit.record({
      userId: user.id,
      action: 'record',
      entityType: RESIGNATION_ENTITY,
      entityId: id,
      diff: { employeeId: before.employeeId, employmentId: before.employmentId, status: { from: 'sent', to: 'recorded' }, endingId: ending.id },
    });
    await this.notices.resignationDecided(id, 'recorded');
    const after = await this.row(id);
    return { request: requestView(after, 'full', await this.confidential.isConfidential(before.employeeId), await this.documents.resignationLetterReady()), ending };
  }

  /** HR returns a mistaken request with a reason: the employee is told and may send it again. */
  async returnIt(id: string, dto: ReturnResignationRequestDto, user: SessionUser) {
    const before = await this.row(id);
    await this.assertDecides(before, user, 'returned');
    const moved = await this.prisma.resignationRequest.updateMany({
      where: { id, status: 'sent' },
      data: { status: 'returned', returnedReason: dto.reason, returnedById: user.id, returnedAt: new Date() },
    });
    if (!moved.count) throw new ConflictException(`This request is ${statusText(before.status)}, so it can't be returned now.`);
    await this.audit.record({
      userId: user.id,
      action: 'return',
      entityType: RESIGNATION_ENTITY,
      entityId: id,
      diff: { employeeId: before.employeeId, employmentId: before.employmentId, status: { from: 'sent', to: 'returned' }, reason: dto.reason },
    });
    await this.notices.resignationDecided(id, 'returned');
    return requestView(await this.row(id), 'full', await this.confidential.isConfidential(before.employeeId), await this.documents.resignationLetterReady());
  }

  // ---------- helpers ----------

  private async currentEmployment(employeeId: string) {
    return this.prisma.employment.findFirst({
      where: { employeeId, endDate: null },
      orderBy: { joinDate: 'desc' },
      select: { id: true, employmentType: true, shift: { select: { workingDays: true } } },
    });
  }

  private async row(id: string): Promise<RequestRow> {
    const r = await this.prisma.resignationRequest.findUnique({ where: { id }, include: REQUEST_INCLUDE, omit: REQUEST_OMIT });
    if (!r) throw new NotFoundException('Resignation request not found.');
    return r;
  }

  /** How the caller stands to the request; 404 when they have no part in it (and for a C-level person's hidden from them). */
  private async viewerOf(r: RequestRow, user: SessionUser): Promise<Viewer> {
    await this.confidential.assertVisible(user, r.employeeId, 'Resignation request not found.');
    if (user.employeeId && r.employeeId === user.employeeId) return 'self';
    if (actsAs(user.roles, ['hr', 'ceo', 'super_admin'])) return 'full';
    if (user.employeeId && r.employment.managerId === user.employeeId) return 'manager';
    throw new NotFoundException('Resignation request not found.');
  }

  /**
   * Whether the caller takes HR's step on this request: HR; a C-level person's the CEO (or HR with Super Admin), never
   * for themself. 404 for a request hidden from them or not theirs to see; 403 for the rest.
   */
  private async assertDecides(r: RequestRow, user: SessionUser, what: string): Promise<void> {
    const viewer = await this.viewerOf(r, user);
    if (viewer === 'self') throw new ForbiddenException(`Someone else has to have your own resignation ${what}.`);
    if (!(await this.mayRecord(r, user))) {
      throw new ForbiddenException((await this.confidential.isConfidential(r.employeeId)) ? "A C-level person's resignation is recorded by the CEO, not HR." : 'Only HR records or returns a resignation request.');
    }
  }

  private async mayRecord(r: RequestRow, user: SessionUser): Promise<boolean> {
    if (user.employeeId && r.employeeId === user.employeeId) return false;
    if (await this.confidential.isConfidential(r.employeeId)) return decidesConfidentialStage(user, ['hr']);
    return actsAs(user.roles, ['hr']);
  }
}
