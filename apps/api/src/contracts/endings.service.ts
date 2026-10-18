import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ENDING_STATUS_LABELS, NOTICE_UNIT_LABELS, type EndingStatus, type NoticeUnit } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { addDays, fromDateOnly, shownDate, toDateOnly, todayInCairo } from '../common/date-only.js';
import { EmploymentsService } from '../employees/employments.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateEndingDto, EndingNoteDto, RejectEndingDto } from './contracts.dto.js';
import { EndingRulesService } from './ending-rules.service.js';
import { noticeEnds } from './notice.js';
import { seesSalary } from '../employees/access.js';
import { ENDING_EMPLOYMENT, ENDING_INCLUDE, endReasonOf, endingView, nonRenewalNoticeBy } from './views.js';

const ENTITY = 'employment_ending';

/** An ending with what its view shows, and what its steps need of the employment. */
const ROW = {
  ...ENDING_INCLUDE,
  employment: { select: { ...ENDING_EMPLOYMENT, id: true, employeeId: true, status: true, probationEnd: true } },
} satisfies Prisma.EmploymentEndingInclude;

type EndingRow = Prisma.EmploymentEndingGetPayload<{ include: typeof ROW }>;

/** The endings still going: one per employment at a time. */
const OPEN: EndingStatus[] = ['pending_ceo', 'approved'];

/** "approved", "waiting for the CEO" …: an ending's status inside a sentence. */
const statusText = (status: string) => (ENDING_STATUS_LABELS[status as EndingStatus] ?? status).replace(/^\w/, (c) => c.toLowerCase());

// How an employment ends (owner's decisions, 15 October 2026, checked against Labour Law 14/2025). HR records the
// ending, which counts as HR's approval: the rule (resignation, non-renewal …), the day notice was given, and the last
// working day, worked out from the rule's notice. The CEO approves it (the employment is then in its notice period) or
// rejects it. HR may withdraw it until it is completed, and completes it on or after the last working day, which ends
// the employment as End employment does.
@Injectable()
export class EndingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly employments: EmploymentsService,
    private readonly rules: EndingRulesService,
  ) {}

  /** Records an ending of a current employment, approved by HR (the creator), for the CEO to decide. */
  async create(employeeId: string, employmentId: string, dto: CreateEndingDto, user: SessionUser) {
    const employment = await this.prisma.employment.findFirst({
      where: { id: employmentId, employeeId },
      select: { id: true, joinDate: true, endDate: true, status: true, probationEnd: true, employee: { select: { fullNameEn: true } }, shift: { select: { workingDays: true } } },
    });
    if (!employment) throw new NotFoundException('Employment not found.');
    if (employment.endDate) throw new ConflictException(`This employment already ended on ${shownDate(fromDateOnly(employment.endDate))}.`);
    const rule = await this.rules.row(dto.ruleKey);
    if (!rule.active) throw new BadRequestException(`"${rule.label}" is turned off in Settings. Turn it on there, or choose another way to end the employment.`);
    const open = await this.prisma.employmentEnding.findFirst({ where: { employmentId, status: { in: OPEN } }, select: { status: true } });
    if (open) {
      throw new ConflictException(`An ending of this employment is already ${statusText(open.status)}. Withdraw it before recording another.`);
    }

    // who ends it: either side for some rules (probation, mutual agreement), else the rule's own, or no one (death)
    let initiator: 'employee' | 'company' | null;
    if (rule.initiator === 'either') {
      if (!dto.initiator) throw new BadRequestException('Choose who ends it: the employee or the company.');
      initiator = dto.initiator;
    } else {
      initiator = rule.initiator === 'employee' || rule.initiator === 'company' ? rule.initiator : null;
      if (dto.initiator && dto.initiator !== initiator) {
        throw new BadRequestException(initiator ? `"${rule.label}" is started by the ${initiator}.` : `"${rule.label}" is not started by either side.`);
      }
    }

    const givenOn = dto.noticeGivenOn;
    const joinDate = fromDateOnly(employment.joinDate);
    if (givenOn < joinDate) throw new BadRequestException(`The notice date must be on or after the join date, ${shownDate(joinDate)}.`);

    // during probation only while on probation, and with notice given by its last day
    if (rule.key === 'probation') {
      const probationEnd = fromDateOnly(employment.probationEnd);
      if (employment.status !== 'probation' || !probationEnd) {
        throw new BadRequestException(`${employment.employee.fullNameEn} is not on probation. Choose another way to end the employment.`);
      }
      if (givenOn > probationEnd) {
        throw new BadRequestException(`The probation ended on ${shownDate(probationEnd)}: notice during probation must be given by then. Choose another way to end the employment.`);
      }
    }

    // a resignation is certified at the labour office (Decree 187/2025); the company decides within 10 days, or it counts as accepted
    const certification =
      rule.key === 'resignation'
        ? { certifiedOffice: dto.certifiedOffice ?? null, certifiedSerial: dto.certifiedSerial ?? null, certifiedOn: dto.certifiedOn ?? null, decisionDueOn: addDays(givenOn, 10) }
        : { certifiedOffice: null, certifiedSerial: null, certifiedOn: null, decisionDueOn: null };
    if (rule.key === 'resignation') {
      if (!certification.certifiedOffice || !certification.certifiedSerial || !certification.certifiedOn) {
        throw new BadRequestException('A resignation must be certified at the labour office (Decree 187/2025): enter the office, the serial number and the date.');
      }
      if (certification.certifiedOn > todayInCairo()) throw new BadRequestException("The certification date can't be in the future.");
    }

    const payInLieu = dto.payInLieu ?? false;
    if (payInLieu && !rule.payInLieu) throw new BadRequestException(`"${rule.label}" can't be paid in lieu of notice.`);

    // the last working day: the notice date when the notice is paid instead of worked; the contract's end for a
    // fixed term not renewed; else the notice counted from the day it was given (working days by the shift)
    const workingDays = employment.shift?.workingDays ?? null;
    const unit = rule.noticeUnit as NoticeUnit;
    let lastWorkingDay = payInLieu ? givenOn : noticeEnds(givenOn, rule.noticeAmount, unit, workingDays);
    if (rule.key === 'non_renewal') {
      const contract = await this.prisma.contract.findFirst({ where: { employmentId, status: 'active' }, orderBy: { version: 'desc' } });
      if (!contract || contract.form !== 'fixed' || !contract.endDate) {
        throw new BadRequestException('Only a signed fixed-term contract can end by not being renewed. Sign one first, or choose another way to end the employment.');
      }
      const by = nonRenewalNoticeBy(contract, { workingDays, nonRenewal: rule })!;
      if (!payInLieu && givenOn > by) {
        throw new BadRequestException(
          `The non-renewal notice is due ${rule.noticeAmount} ${NOTICE_UNIT_LABELS[unit]} before the contract ends, by ${shownDate(by)}.`,
        );
      }
      if (!payInLieu) lastWorkingDay = fromDateOnly(contract.endDate);
    }

    const row = await this.prisma.employmentEnding.create({
      data: {
        employmentId,
        ruleKey: rule.key,
        initiator,
        noticeGivenOn: toDateOnly(givenOn),
        payInLieu,
        lastWorkingDay: toDateOnly(lastWorkingDay),
        ...certification,
        certifiedOn: certification.certifiedOn ? toDateOnly(certification.certifiedOn) : null,
        decisionDueOn: certification.decisionDueOn ? toDateOnly(certification.decisionDueOn) : null,
        reason: dto.reason ?? null,
        note: dto.note ?? null,
        status: 'pending_ceo',
        hrApprovedById: user.id,
        hrApprovedAt: new Date(),
      },
      include: ROW,
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: ENTITY,
      entityId: row.id,
      diff: { employeeId, employmentId, ruleKey: rule.key, initiator, noticeGivenOn: givenOn, payInLieu, lastWorkingDay, status: 'pending_ceo', ...certification },
    });
    return endingView(row, seesSalary(user));
  }

  /** Endings with their employee, newest first; `status` narrows them (the CEO's queue: pending_ceo). */
  async list(status: EndingStatus | undefined, user: SessionUser) {
    const rows = await this.prisma.employmentEnding.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      include: {
        ...ENDING_INCLUDE,
        employment: { select: { ...ENDING_EMPLOYMENT, id: true, employee: { select: { id: true, employeeCode: true, fullNameEn: true } } } },
      },
    });
    return rows.map((e) => ({ ...endingView(e, seesSalary(user)), employee: e.employment.employee, employmentId: e.employment.id }));
  }

  /** The CEO approves: the employment is then in its notice period, until HR completes the ending. */
  async approve(id: string, dto: EndingNoteDto, user: SessionUser) {
    const before = await this.row(id);
    this.assertStatus(before, ['pending_ceo'], 'Only an ending waiting for the CEO can be approved.');
    this.assertCurrent(before);
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.employment.update({ where: { id: before.employmentId }, data: { status: 'notice_period' } });
      return tx.employmentEnding.update({
        where: { id },
        data: { status: 'approved', ceoDecidedById: user.id, ceoDecidedAt: new Date(), ceoNote: dto.note ?? null },
        include: ROW,
      });
    });
    await this.record(user, before, 'approve', 'approved', { ceoNote: dto.note ?? null });
    await this.recordEmploymentStatus(user, before, 'notice_period');
    return endingView(row, seesSalary(user));
  }

  /** The CEO rejects, with the reason. The employment goes on as it was. */
  async reject(id: string, dto: RejectEndingDto, user: SessionUser) {
    const before = await this.row(id);
    this.assertStatus(before, ['pending_ceo'], 'Only an ending waiting for the CEO can be rejected.');
    const row = await this.prisma.employmentEnding.update({
      where: { id },
      data: { status: 'rejected', ceoDecidedById: user.id, ceoDecidedAt: new Date(), ceoNote: dto.note },
      include: ROW,
    });
    await this.record(user, before, 'reject', 'rejected', { ceoNote: dto.note });
    return endingView(row, seesSalary(user));
  }

  /**
   * HR withdraws an ending, before or after the CEO approved it. An approved one had put the employment in its notice
   * period: it goes back to Probation while the probation end is still ahead, else Active. A note is added to the
   * ending's note.
   */
  async withdraw(id: string, dto: EndingNoteDto, user: SessionUser) {
    const before = await this.row(id);
    this.assertStatus(before, OPEN, 'Only an ending waiting for the CEO or approved can be withdrawn.');
    const probationEnd = fromDateOnly(before.employment.probationEnd);
    const restored =
      before.status === 'approved' && !before.employment.endDate && before.employment.status === 'notice_period'
        ? probationEnd && probationEnd >= todayInCairo()
          ? ('probation' as const)
          : ('active' as const)
        : null;
    const note = dto.note ? [before.note, `Withdrawn: ${dto.note}`].filter(Boolean).join('\n') : before.note;
    const row = await this.prisma.$transaction(async (tx) => {
      if (restored) await tx.employment.update({ where: { id: before.employmentId }, data: { status: restored } });
      return tx.employmentEnding.update({ where: { id }, data: { status: 'withdrawn', note }, include: ROW });
    });
    await this.record(user, before, 'withdraw', 'withdrawn', { note: dto.note ?? null });
    if (restored) await this.recordEmploymentStatus(user, before, restored);
    return endingView(row, seesSalary(user));
  }

  /**
   * HR completes an approved ending on or after the last working day: the employment ends that day, for the reason
   * the rule gives, as End employment ends it (EmploymentsService.close: the status, and the signed contract ended).
   */
  async complete(id: string, user: SessionUser) {
    const before = await this.row(id);
    this.assertStatus(before, ['approved'], 'Only an approved ending can be completed.');
    const lastWorkingDay = fromDateOnly(before.lastWorkingDay);
    if (todayInCairo() < lastWorkingDay) throw new BadRequestException(`It can be completed on or after the last working day, ${shownDate(lastWorkingDay)}.`);
    const endReason = endReasonOf(before.ruleKey, before.rule.endReason, before.initiator);
    const endNote = [before.rule.label, before.reason].filter(Boolean).join(': ').slice(0, 500);

    const row = await this.prisma.$transaction(async (tx) => {
      await this.employments.close(before.employment.employeeId, before.employmentId, { endDate: lastWorkingDay, endReason, endNote }, user, tx);
      return tx.employmentEnding.update({ where: { id }, data: { status: 'completed', completedAt: new Date() }, include: ROW });
    });
    await this.record(user, before, 'complete', 'completed', { endDate: lastWorkingDay, endReason });
    return endingView(row, seesSalary(user));
  }

  // ---------- helpers ----------

  private async row(id: string): Promise<EndingRow> {
    const e = await this.prisma.employmentEnding.findUnique({ where: { id }, include: ROW });
    if (!e) throw new NotFoundException('Ending not found.');
    return e;
  }

  private assertStatus(e: EndingRow, allowed: EndingStatus[], message: string) {
    if (!allowed.includes(e.status as EndingStatus)) throw new ConflictException(`${message} This one is ${statusText(e.status)}.`);
  }

  private assertCurrent(e: EndingRow) {
    const end = fromDateOnly(e.employment.endDate);
    if (end) throw new ConflictException(`This employment already ended on ${shownDate(end)}. Withdraw the ending.`);
  }

  private record(user: SessionUser, before: EndingRow, action: string, to: EndingStatus, extra: Record<string, unknown>) {
    return this.audit.record({
      userId: user.id,
      action,
      entityType: ENTITY,
      entityId: before.id,
      diff: { employeeId: before.employment.employeeId, employmentId: before.employmentId, ruleKey: before.ruleKey, status: { from: before.status, to }, ...extra },
    });
  }

  private recordEmploymentStatus(user: SessionUser, before: EndingRow, to: string) {
    return this.audit.record({
      userId: user.id,
      action: 'update',
      entityType: 'employment',
      entityId: before.employmentId,
      diff: { employeeId: before.employment.employeeId, ending: before.id, status: { from: before.employment.status, to } },
    });
  }
}
