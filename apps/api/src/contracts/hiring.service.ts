import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, toDateOnly, todayInCairo } from '../common/date-only.js';
import { EmployeesService } from '../employees/employees.service.js';
import { EmploymentsService } from '../employees/employments.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ContractsService } from './contracts.service.js';
import type { HireDto } from './hiring.dto.js';

/** A hire takes a dozen queries or more: a busy server can need more than a transaction's default 5 seconds (as offers do). */
const TIMEOUT_MS = 20_000;

export const START_ON_JOIN_DATE = 'The first contract starts on the join date: leave its start date out.';

/**
 * The employment's probation from its first contract's (Labour Law Art. 90), as a hire from a job offer has it: Probation
 * while it runs (to its last day included), else Active (none, or a hire back-dated past it).
 */
export function probationOf(probationEnd: string | null, today = todayInCairo()) {
  return { probationEnd, status: probationEnd && probationEnd >= today ? ('probation' as const) : ('active' as const) };
}

// Hiring in one form (owner's decision, 16 October 2026: "there is no point of adding employment then adding contract
// and no active employment without a contract"): Add employment, the first time or after someone left, takes the job
// and the first contract's terms together, and saving makes the employment and its contract version 1 as a draft to
// print and sign, in one transaction (all or nothing), as accepting a job offer does (OfferHiringService). Each part
// is checked as it is on its own (EmploymentsService.add, ContractsService.draft); the contract starts on the join
// date, and the employment's probation is the contract's. The audit log records both once they are saved. Renewals and
// new versions stay with the contract (ContractsService.create).
@Injectable()
export class HiringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly employees: EmployeesService,
    private readonly employments: EmploymentsService,
    private readonly contracts: ContractsService,
  ) {}

  /** Hires someone whose profile exists: the employment and its first contract, drafted. Answers the updated profile. */
  async hire(employeeId: string, dto: HireDto, user: SessionUser) {
    const joinDate = dto.employment.joinDate;
    if (dto.contract.startDate !== undefined && dto.contract.startDate !== joinDate) throw new BadRequestException(START_ON_JOIN_DATE);
    // the first contract starts on the join date
    dto.contract.startDate = joinDate;

    const made = await this.prisma.$transaction(
      async (tx) => {
        const employment = await this.employments.add(employeeId, dto.employment, tx);
        const contract = await this.contracts.draft(employeeId, employment.id, dto.contract, user, tx);
        // the contract's probation (e.g. 1 month, or none) rather than the settings' months the employment was given
        const probation = probationOf(fromDateOnly(contract.row.probationEnd));
        if (probation.probationEnd !== employment.created.probationEnd || probation.status !== employment.created.status) {
          await tx.employment.update({
            where: { id: employment.id },
            data: { probationEnd: probation.probationEnd ? toDateOnly(probation.probationEnd) : null, status: probation.status },
          });
        }
        return { employment: { id: employment.id, created: { ...employment.created, ...probation } }, contract: contract.audit };
      },
      { timeout: TIMEOUT_MS },
    );

    await this.audit.record({ userId: user.id, action: 'create', entityType: 'employment', entityId: made.employment.id, diff: made.employment.created });
    await this.audit.record(made.contract);
    return this.employees.get(employeeId, user);
  }
}
