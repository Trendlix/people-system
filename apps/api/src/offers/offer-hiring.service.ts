import { ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { offerSlotKey } from '@trendlix/shared';
import { allowanceData } from '../allowances/rows.js';
import { AuditService } from '../audit/audit.service.js';
import { fromDateOnly, shownDate, toDateOnly, todayInCairo } from '../common/date-only.js';
import { restrictedTags } from '../documents/values.js';
import type { Prisma } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { answerEmail } from './offer-mail.js';
import { cairoDate, offerSlot, termDates } from './rules.js';
import { offerPay } from './views.js';

/** The restricted terms never go to the audit log: only the fact that they were set (as contracts do). */
const SALARY_FIELDS = ['grossSalary', 'netSalary', 'insuredSalary', 'hourlyRate'];
export function salaryMasked<T extends Record<string, unknown>>(diff: T): T {
  const out: Record<string, unknown> = { ...diff };
  for (const key of SALARY_FIELDS) if (key in out) out[key] = 'changed';
  return out as T;
}

/** Making the profile can take a few queries more than a transaction's default 5 seconds allow on a busy server. */
const TIMEOUT_MS = 20_000;

/** What hiring from an offer made, or why it couldn't. */
export type HireResult = { employeeId: string; employeeCode: string } | { error: string };

/** The answer HR is told about. */
export interface AnsweredOffer {
  number: string;
  fullNameEn: string;
  sentById: string | null;
  declineReason: string | null;
  respondedAt: Date | null;
}

// What follows an offer's acceptance (owner's request, 15 October 2026): the person gets a profile only now, so
// candidates never appear in the employee lists and counts. In one transaction: the profile (or the former employee's
// own), the employment from the position, the draft contract version 1 from the terms (with the allowances as the offer
// has them), and the offer's document as sent, copied to the profile's Contracts tab. If that fails (a former employee
// hired again in the meantime …), the acceptance stays recorded, nothing else is made, and HR makes the profile again
// once it is fixed (POST /offers/:id/hire). The rows are written directly, with the same rules as EmployeesService,
// EmploymentsService and ContractsService, since those answer for a signed-in user and the candidate isn't one.
// Also here: telling the HR user who sent the offer about the answer.
@Injectable()
export class OfferHiringService {
  private readonly logger = new Logger(OfferHiringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /**
   * Makes the profile, the employment, the draft contract and the document from an accepted offer whose profile isn't
   * made yet. `userId`: the HR user who recorded the acceptance or asked again; null when the candidate accepted online.
   */
  async hire(offerId: string, userId: string | null): Promise<{ employeeId: string; employeeCode: string }> {
    const made = await this.prisma.$transaction(
      async (tx) => {
        // claimed first, so two attempts at once can't both make a profile: the second waits, then finds it made
        const { count } = await tx.jobOffer.updateMany({ where: { id: offerId, status: 'accepted', hiredAt: null }, data: { hiredAt: new Date() } });
        if (!count) {
          const o = await tx.jobOffer.findUnique({ where: { id: offerId }, select: { number: true, hiredAt: true } });
          if (!o) throw new NotFoundException('Job offer not found.');
          throw new ConflictException(o.hiredAt ? `The profile was already made from ${o.number}.` : `${o.number} isn't accepted, so there is no profile to make from it.`);
        }
        // one query at a time: a transaction runs on one connection
        const row = await tx.jobOffer.findUniqueOrThrow({ where: { id: offerId } });
        const allowances = await tx.offerAllowance.findMany({ where: { offerId } });
        const templateVersion = row.templateVersionId ? await tx.templateVersion.findUnique({ where: { id: row.templateVersionId }, select: { tags: true } }) : null;
        const o = { ...row, allowances, templateVersion };
        const joinDate = fromDateOnly(o.joinDate);

        // the person: a former employee's own profile, or a new one
        let person: { id: string; employeeCode: string; fullNameEn: string; created: boolean };
        if (o.employeeId) {
          const e = await tx.employee.findUniqueOrThrow({ where: { id: o.employeeId }, select: { id: true, employeeCode: true, fullNameEn: true } });
          const current = await tx.employment.findFirst({ where: { employeeId: e.id, endDate: null }, select: { joinDate: true } });
          if (current) {
            throw new ConflictException(
              `${e.fullNameEn} already has a current employment, since ${shownDate(fromDateOnly(current.joinDate))}, so another can't be made from ${o.number}. End that employment first, then make the profile again.`,
            );
          }
          const last = await tx.employment.findFirst({ where: { employeeId: e.id }, orderBy: { endDate: 'desc' }, select: { endDate: true } });
          const lastEnd = fromDateOnly(last?.endDate ?? null);
          if (lastEnd && joinDate <= lastEnd) {
            throw new ConflictException(
              `${e.fullNameEn}'s last employment ended on ${shownDate(lastEnd)}: the employment from ${o.number} must start after that. Correct that employment's end date, then make the profile again.`,
            );
          }
          person = { ...e, created: false };
        } else {
          const employeeCode = await nextEmployeeCode(tx);
          const e = await tx.employee.create({
            data: { employeeCode, fullNameEn: o.fullNameEn, fullNameAr: o.fullNameAr, personalEmail: o.email, mobile: o.mobile },
            select: { id: true, employeeCode: true, fullNameEn: true },
          });
          person = { ...e, created: true };
        }

        // the employment: on probation while the offer's probation runs (it ends as the contract's does), else active
        const { endDate, probationEnd } = termDates(joinDate, o.durationMonths, o.probationMonths);
        const employmentValues = {
          employmentType: o.employmentType,
          status: probationEnd ? ('probation' as const) : ('active' as const),
          departmentId: o.departmentId,
          jobTitleId: o.jobTitleId,
          gradeId: o.gradeId,
          managerId: o.managerId,
          joinDate,
          probationEnd,
          workArrangement: o.workArrangement,
          officeDays: o.workArrangement === 'hybrid' ? [...o.officeDays].sort((a, b) => a - b) : [],
          shiftId: o.shiftId,
        };
        const employment = await tx.employment.create({
          data: { ...employmentValues, employeeId: person.id, joinDate: o.joinDate, probationEnd: probationEnd ? toDateOnly(probationEnd) : null },
          select: { id: true },
        });

        // the draft contract version 1, from the terms
        const pay = offerPay(o);
        const contractValues = {
          number: await nextContractNumber(tx, joinDate),
          version: 1,
          form: 'fixed',
          startDate: joinDate,
          durationMonths: o.durationMonths,
          endDate,
          probationMonths: o.probationMonths,
          probationEnd,
          grossSalary: o.grossSalary.toNumber(),
          basicPercent: o.basicPercent,
          netSalary: o.netSalary?.toNumber() ?? null,
          insuredSalary: pay.insuredSalary,
          payBasis: o.payBasis,
          hourlyRate: o.hourlyRate?.toNumber() ?? null,
          hoursPerWeek: o.hoursPerWeek?.toNumber() ?? null,
          daysPerWeek: o.daysPerWeek,
          status: 'draft',
          note: `Made from job offer ${o.number}.`,
        };
        const contract = await tx.contract.create({
          data: {
            ...contractValues,
            employmentId: employment.id,
            startDate: o.joinDate,
            endDate: toDateOnly(endDate),
            probationEnd: probationEnd ? toDateOnly(probationEnd) : null,
          },
          select: { id: true },
        });
        if (pay.allowances.length) {
          await tx.contractAllowance.createMany({ data: allowanceData(pay.allowances).map((a) => ({ ...a, contractId: contract.id })) });
        }

        // the offer as sent, on the profile's Contracts tab
        let document: { id: string; fileName: string; sizeBytes: number; documentDate: string } | null = null;
        if (o.data && o.templateVersionId && o.templateVersion && o.fileName) {
          const slot = offerSlot(o.employmentType);
          const online = !o.answeredById && o.acceptedName && o.respondedAt;
          const documentDate = o.documentDate ? fromDateOnly(o.documentDate) : todayInCairo();
          const row = await tx.generatedDocument.create({
            data: {
              employeeId: person.id,
              employmentId: employment.id,
              slotKey: offerSlotKey(o.employmentType),
              templateVersionId: o.templateVersionId,
              documentDate: toDateOnly(documentDate),
              fileName: o.fileName,
              data: o.data,
              sizeBytes: o.data.length,
              hasRestricted: restrictedTags(o.templateVersion.tags, slot.overrides).length > 0,
              status: 'generated',
              generatedById: o.sentById ?? userId,
              note: online ? `Accepted online by ${o.acceptedName} on ${shownDate(cairoDate(o.respondedAt!))} (${o.number})` : `Accepted, recorded by HR (${o.number})`,
            },
            select: { id: true },
          });
          document = { id: row.id, fileName: o.fileName, sizeBytes: o.data.length, documentDate };
        }

        await tx.jobOffer.update({ where: { id: offerId }, data: { employeeId: person.id } });
        return {
          offer: o,
          person,
          employmentId: employment.id,
          employmentValues,
          contractId: contract.id,
          contractValues,
          allowances: pay.allowances.map((a) => a.nameEn),
          document,
        };
      },
      { timeout: TIMEOUT_MS },
    );

    // the audit log says where each record came from; userId null when the candidate accepted online
    const { offer: o, person } = made;
    const fromOffer = o.number;
    if (person.created) {
      await this.audit.record({
        userId,
        action: 'create',
        entityType: 'employee',
        entityId: person.id,
        diff: { employeeCode: person.employeeCode, fullNameEn: o.fullNameEn, fullNameAr: o.fullNameAr, personalEmail: o.email, mobile: o.mobile, fromOffer },
      });
    }
    await this.audit.record({ userId, action: 'create', entityType: 'employment', entityId: made.employmentId, diff: { employeeId: person.id, ...made.employmentValues, fromOffer } });
    await this.audit.record({
      userId,
      action: 'create',
      entityType: 'contract',
      entityId: made.contractId,
      diff: salaryMasked({ employeeId: person.id, employmentId: made.employmentId, ...made.contractValues, allowances: made.allowances, fromOffer }),
    });
    if (made.document) {
      await this.audit.record({
        userId,
        action: 'generate',
        entityType: 'generated_document',
        entityId: made.document.id,
        diff: { employeeId: person.id, slot: offerSlotKey(o.employmentType), documentDate: made.document.documentDate, fileName: made.document.fileName, sizeBytes: made.document.sizeBytes, fromOffer },
      });
    }
    await this.audit.record({
      userId,
      action: 'hire',
      entityType: 'job_offer',
      entityId: o.id,
      diff: { number: o.number, employeeId: person.id, employeeCode: person.employeeCode, rehired: !person.created, employmentId: made.employmentId, contract: made.contractValues.number },
    });
    return { employeeId: person.id, employeeCode: person.employeeCode };
  }

  /** hire(), with a failure kept as its message (the acceptance stays recorded either way). */
  async tryHire(offerId: string, userId: string | null): Promise<HireResult> {
    try {
      return await this.hire(offerId, userId);
    } catch (err) {
      if (err instanceof HttpException) {
        const res = err.getResponse();
        const message = typeof res === 'string' ? res : (res as { message?: unknown }).message;
        return { error: Array.isArray(message) ? message.join(' ') : typeof message === 'string' ? message : err.message };
      }
      this.logger.error(`Making the profile from offer ${offerId} failed: ${(err as Error).message}`);
      return { error: 'Something went wrong while making the profile. Try Make the profile again.' };
    }
  }

  /**
   * Tells the HR user who sent the offer about the answer, when email is set up (best effort: a failure is only
   * logged). Not when they recorded the answer themselves.
   */
  async notify(o: AnsweredOffer, answer: 'accepted' | 'declined', by: { userId: string | null }, hired: HireResult | null): Promise<void> {
    if (!this.mail.configured || !o.sentById || o.sentById === by.userId) return;
    try {
      const sender = await this.prisma.user.findUnique({ where: { id: o.sentById }, select: { email: true, isActive: true } });
      if (!sender?.isActive) return;
      const mail = answerEmail({
        number: o.number,
        fullNameEn: o.fullNameEn,
        answer,
        online: by.userId === null,
        on: cairoDate(o.respondedAt ?? new Date()),
        reason: answer === 'declined' ? o.declineReason : null,
        hired: hired && ('error' in hired ? { error: hired.error } : { employeeCode: hired.employeeCode }),
      });
      await this.mail.send({ to: sender.email, ...mail });
    } catch (err) {
      this.logger.warn(`Telling the sender of ${o.number} about the answer failed: ${(err as Error).message}`);
    }
  }
}

/** The next free EMP-#### code, as EmployeesService numbers new profiles: one more than the highest in use. */
async function nextEmployeeCode(tx: Prisma.TransactionClient): Promise<string> {
  const [{ max }] = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT max(substring(employee_code from 5)::int) AS max FROM employees WHERE employee_code ~ '^EMP-[0-9]+$'`;
  return `EMP-${String((max ?? 0) + 1).padStart(4, '0')}`;
}

/** The next free number for a contract starting that year, as ContractsService numbers them: CON-2026-0001 … */
async function nextContractNumber(tx: Prisma.TransactionClient, startDate: string): Promise<string> {
  const year = startDate.slice(0, 4);
  const [{ max }] = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT max(substring(number from 10)::int) AS max FROM contracts WHERE number ~ ${`^CON-${year}-[0-9]+$`}`;
  return `CON-${year}-${String((max ?? 0) + 1).padStart(4, '0')}`;
}
