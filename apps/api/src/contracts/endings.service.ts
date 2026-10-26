import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ENDING_STATUS_LABELS, INTERNSHIP_AGREEMENT, isTrainingType, NOTICE_UNIT_LABELS, type EndingStatus, type NoticeUnit } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { addDays, fromDateOnly, shownDate, toDateOnly, todayInCairo } from '../common/date-only.js';
import { EmploymentsService } from '../employees/employments.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { OffboardingService } from '../offboarding/offboarding.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { agreedLastDayProblem } from './agreed-last-day.js';
import type { AgreedLastDayDto, CreateEndingDto, EndingNoteDto, RejectEndingDto } from './contracts.dto.js';
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
    private readonly confidential: ConfidentialService,
    private readonly offboarding: OffboardingService,
  ) {}

  /** Records an ending of a current employment, approved by HR (the creator), for the CEO to decide. */
  async create(employeeId: string, employmentId: string, dto: CreateEndingDto, user: SessionUser) {
    const employment = await this.prisma.employment.findFirst({
      where: { id: employmentId, employeeId },
      select: {
        id: true,
        employmentType: true,
        joinDate: true,
        endDate: true,
        status: true,
        probationEnd: true,
        employee: { select: { fullNameEn: true } },
        shift: { select: { workingDays: true } },
      },
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

    // an intern's internship agreement (owner, 19 October 2026: "their contracts are never renewed", then renewed once at
    // most): not a fixed term the company doesn't renew, it ends as Training completed; and Training completed ends
    // nothing else
    const training = isTrainingType(employment.employmentType);
    if (rule.key === 'non_renewal' && training) {
      throw new BadRequestException(
        `An ${INTERNSHIP_AGREEMENT} isn’t renewed as a fixed term is: end it as Training completed, or convert it to a full-time contract.`,
      );
    }
    if (rule.key === 'training_completed' && !training) {
      throw new BadRequestException(`${employment.employee.fullNameEn} isn’t an intern: "${rule.label}" ends an ${INTERNSHIP_AGREEMENT}. Choose another way to end the employment.`);
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
    // the agreement ends with its last day; recorded after that day, on the day it is recorded
    if (rule.key === 'training_completed') {
      const contract = await this.prisma.contract.findFirst({ where: { employmentId, status: 'active' }, orderBy: { version: 'desc' } });
      if (!contract?.endDate) {
        throw new BadRequestException(`Only a signed ${INTERNSHIP_AGREEMENT} ends as "${rule.label}". Sign it first, or choose another way to end the employment.`);
      }
      const end = fromDateOnly(contract.endDate);
      lastWorkingDay = givenOn > end ? givenOn : end;
    }

    // the last day HR agreed with the employee replaces the worked-out one; that one is kept as noticeEndsOn (owner, 26
    // October 2026)
    const noticeEndsOn = lastWorkingDay;
    const agreed = dto.agreedLastWorkingDay ?? null;
    if (agreed) {
      const problem = agreedLastDayProblem({ agreed, noticeGivenOn: givenOn, employmentEnd: null, payInLieu });
      if (problem) throw new BadRequestException(problem);
      lastWorkingDay = agreed;
    }

    const row = await this.prisma.employmentEnding.create({
      data: {
        employmentId,
        ruleKey: rule.key,
        initiator,
        noticeGivenOn: toDateOnly(givenOn),
        payInLieu,
        lastWorkingDay: toDateOnly(lastWorkingDay),
        noticeEndsOn: toDateOnly(noticeEndsOn),
        lastDayAgreed: !!agreed,
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
      diff: { employeeId, employmentId, ruleKey: rule.key, initiator, noticeGivenOn: givenOn, payInLieu, lastWorkingDay, noticeEndsOn, lastDayAgreed: !!agreed, status: 'pending_ceo', ...certification },
    });
    return endingView(row, seesSalary(user));
  }

  /** Endings with their employee, newest first; `status` narrows them (the CEO's queue: pending_ceo). */
  async list(status: EndingStatus | undefined, user: SessionUser) {
    const rows = await this.prisma.employmentEnding.findMany({
      // not a C-level person's for anyone but the CEO and a Super Admin (owner, 19 October 2026)
      where: { ...(status && { status }), employment: await this.confidential.ownedWhere(user) },
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
    // the notice period starts: its offboarding case opens (owner, 22 October 2026: the full module)
    await this.offboarding.openForEnding(id, before.employmentId, user);
    return endingView(row, seesSalary(user));
  }

  /** The CEO rejects, with the reason. The employment goes on as it was. */
  async reject(id: string, dto: RejectEndingDto, user: SessionUser) {
    const before = await this.row(id);
    this.assertStatus(before, ['pending_ceo'], 'Only an ending waiting for the CEO can be rejected.');
    // one sent back after its last working day was changed (setLastDay) had put the employment in its notice period
    const restored = this.statusAfterLeavingNotice(before);
    const row = await this.prisma.$transaction(async (tx) => {
      if (restored) await tx.employment.update({ where: { id: before.employmentId }, data: { status: restored } });
      return tx.employmentEnding.update({
        where: { id },
        data: { status: 'rejected', ceoDecidedById: user.id, ceoDecidedAt: new Date(), ceoNote: dto.note },
        include: ROW,
      });
    });
    await this.record(user, before, 'reject', 'rejected', { ceoNote: dto.note });
    if (restored) {
      await this.recordEmploymentStatus(user, before, restored);
      await this.offboarding.cancelForEnding(id, before.employmentId, user);
    }
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
    const restored = this.statusAfterLeavingNotice(before);
    const note = dto.note ? [before.note, `Withdrawn: ${dto.note}`].filter(Boolean).join('\n') : before.note;
    const row = await this.prisma.$transaction(async (tx) => {
      if (restored) await tx.employment.update({ where: { id: before.employmentId }, data: { status: restored } });
      return tx.employmentEnding.update({ where: { id }, data: { status: 'withdrawn', note }, include: ROW });
    });
    await this.record(user, before, 'withdraw', 'withdrawn', { note: dto.note ?? null });
    if (restored) await this.recordEmploymentStatus(user, before, restored);
    // its offboarding case, if one opened, is cancelled
    await this.offboarding.cancelForEnding(id, before.employmentId, user);
    return endingView(row, seesSalary(user));
  }

  /**
   * HR or an Admin sets, changes or clears the agreed last working day, until the ending is completed (owner, 26 October
   * 2026). Waiting for the CEO: just updated. Already approved: it goes back to the CEO, with what changed written in the
   * ending's note (the employment stays in its notice period, its offboarding case open). Everything is audited with
   * before and after. Clearing it makes the notice's end the last working day again.
   */
  async setLastDay(id: string, dto: AgreedLastDayDto, user: SessionUser) {
    if (dto.agreedLastWorkingDay === undefined) throw new BadRequestException('Send the agreed last working day, or null to clear it.');
    const before = await this.row(id);
    this.assertStatus(before, OPEN, 'The last working day can be changed until the ending is completed, but not once it is rejected or withdrawn.');
    this.assertCurrent(before);
    const agreed = dto.agreedLastWorkingDay;
    const noticeEndsOn = fromDateOnly(before.noticeEndsOn);
    if (agreed) {
      const problem = agreedLastDayProblem({
        agreed,
        noticeGivenOn: fromDateOnly(before.noticeGivenOn),
        employmentEnd: fromDateOnly(before.employment.endDate),
        payInLieu: before.payInLieu,
      });
      if (problem) throw new BadRequestException(problem);
    }
    const from = fromDateOnly(before.lastWorkingDay);
    const to = agreed ?? noticeEndsOn;
    if (to === from && !!agreed === before.lastDayAgreed) throw new BadRequestException('That is already the last working day.');

    const sendBack = before.status === 'approved';
    const changed = `Last working day ${agreed ? 'agreed' : 'back to the notice’s end'}: ${shownDate(from)} → ${shownDate(to)}${dto.note ? `. ${dto.note}` : ''}`;
    const note = sendBack ? [before.note, changed].filter(Boolean).join('\n').slice(0, 1000) : before.note;
    const row = await this.prisma.employmentEnding.update({
      where: { id },
      data: {
        lastWorkingDay: toDateOnly(to),
        lastDayAgreed: !!agreed,
        ...(sendBack && { status: 'pending_ceo', ceoDecidedById: null, ceoDecidedAt: null, ceoNote: null, note }),
      },
      include: ROW,
    });
    await this.audit.record({
      userId: user.id,
      action: 'update',
      entityType: ENTITY,
      entityId: id,
      diff: {
        employeeId: before.employment.employeeId,
        employmentId: before.employmentId,
        ruleKey: before.ruleKey,
        lastWorkingDay: { from, to },
        lastDayAgreed: { from: before.lastDayAgreed, to: !!agreed },
        noticeEndsOn,
        ...(sendBack && {
          status: { from: 'approved', to: 'pending_ceo' },
          sentBackToCeo: true,
          // the CEO's earlier approval, which the change withdraws
          ceoApproval: { by: before.ceoDecidedBy?.email ?? null, at: before.ceoDecidedAt?.toISOString() ?? null, note: before.ceoNote },
        }),
        ...(dto.note && { note: dto.note }),
      },
    });
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
    // its offboarding case (opened at the approval, or now) and the leaver's sign-in once the last working day has passed
    await this.offboarding.afterEnded(before.employmentId, user);
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

  /**
   * The status an employment goes back to when its ending stops (withdrawn, or rejected after it was sent back): out of
   * its notice period to Probation while the probation end is still ahead, else Active; null when it isn't in notice.
   */
  private statusAfterLeavingNotice(e: EndingRow): 'probation' | 'active' | null {
    if (e.employment.endDate || e.employment.status !== 'notice_period') return null;
    const probationEnd = fromDateOnly(e.employment.probationEnd);
    return probationEnd && probationEnd >= todayInCairo() ? 'probation' : 'active';
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
