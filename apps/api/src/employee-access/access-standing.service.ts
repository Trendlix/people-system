import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import {
  ACCESS_HOLD_MESSAGE,
  accessStandingOf,
  graceAllowed,
  graceFromOf,
  HOLD_PATH,
  isAccessStanding,
  type AccessCounts,
  type AccessStanding,
  type AccessStandingView,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { actsAs } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { addDays, shownDate, todayInCairo, toDateOnly } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { NoticesService } from '../notifications/notices.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { activeAccountsOf } from '../users/employee-accounts.js';
import { standingInputOf, standingOf, standingsOf, type Standing } from './access-state.js';

// Access follows the contract (owner, 23 October 2026: "No Access without active contract, Access should be on hold with
// a 7 days grace period one time granted by the hr", then "Active - Grace - Hold - No Access"; packages/shared
// employee-access.ts). A request's standing is read from the contract each time (the guard), so it takes effect at once;
// this records it, so each change is written once to the audit log and told once:
// - the standing recorded last is kept on the employee (employees.access_standing), changed by a compare-and-set, so two
//   sweeps (or a sweep and HR's grace) never record the same change twice;
// - every change after the first record is audited (Active → Hold, Hold → Grace, Grace → Hold, → Active, → No Access);
//   the first record (at go-live) only when it is Hold or Grace: "Hold them immediately", told once, not each run;
// - going on Hold: the employee told, in the app too ("Your access is on hold until your contract is renewed. You can
//   still check in and out."), and HR once (the CEO for a C-level person: owner, 19 October 2026), in one notice a run
//   when several go at once (the go-live's first run);
// - grace given: the employee told until when; the day before it ends, told it ends tomorrow (once).
// - no contract entered (owner, 23 October 2026, asked about an account switched on whose person never had a signed
//   contract in force: "Hold them after 7 days"): the day first seen kept (employees.no_contract_since, set once by a
//   compare-and-set, audited), the employee told once that their access is on hold from the 8th day after unless their
//   contract is entered; then they go on Hold as the others do. Cleared once a signed contract starts (or they leave),
//   kept while their account is off.
// Every notice goes through the notifications service (the inbox and the push).

const EMPLOYEE_ENTITY = 'employee';

/** Who sees the counts of those on Hold and on Grace: HR, an Admin, a Super Admin (the Employees list's Access column). */
const seesAccess = (user: SessionUser) => actsAs(user.roles, ['hr', 'admin']);

@Injectable()
export class AccessStandingService {
  private readonly logger = new Logger('AccessStanding');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly notices: NoticesService,
    private readonly confidential: ConfidentialService,
  ) {}

  /**
   * The employees whose standing is recorded: those with a current employment or an account switched on (never employed:
   * no contract entered), and those recorded before (to record an end).
   */
  private async population(today: string): Promise<string[]> {
    const day = toDateOnly(today);
    const rows = await this.prisma.employee.findMany({
      where: {
        OR: [
          { employments: { some: { OR: [{ endDate: null }, { endDate: { gte: day } }] } } },
          { account: { isActive: true } },
          { accessStanding: { not: null } },
          { noContractSince: { not: null } },
        ],
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * Records the standing of these employees (everyone concerned when left out): each change audited and told once.
   * `actorId`: who made the change happen (HR giving grace, a contract signed), else the system (the sweep). Answers how
   * many changed and how many went on Hold. Never throws for one person: logged, the others go on.
   */
  async sync(employeeIds?: readonly string[], opts: { actorId?: string | null; today?: string; now?: Date } = {}): Promise<{ changed: number; held: number }> {
    const today = opts.today ?? todayInCairo();
    const now = opts.now ?? new Date();
    const ids = employeeIds ? [...new Set(employeeIds)] : await this.population(today);
    if (!ids.length) return { changed: 0, held: 0 };
    const [standings, recorded] = await Promise.all([
      standingsOf(this.prisma, ids, today),
      this.prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, fullNameEn: true, accessStanding: true } }),
    ]);
    const held: { id: string; name: string; noContract: boolean }[] = [];
    let changed = 0;
    for (const person of recorded) {
      const found = standings.get(person.id);
      if (!found) continue;
      let s: Standing = found;
      try {
        s = await this.recordNoContract(s, today, opts.actorId ?? null);
      } catch (err) {
        this.logger.warn(`No contract entered could not be recorded for ${person.id}: ${(err as Error).message}`);
      }
      const from: AccessStanding | null = isAccessStanding(person.accessStanding) ? person.accessStanding : null;
      const to = s.result.standing;
      if (from === to) continue;
      try {
        // compare-and-set: only one sweep (or HR's grace) records a change
        const { count } = await this.prisma.employee.updateMany({ where: { id: person.id, accessStanding: person.accessStanding }, data: { accessStanding: to, accessStandingAt: now } });
        if (!count) continue;
        changed++;
        // the first record (go-live, or someone new): news only when it is Hold or Grace
        if (from === null && to !== 'hold' && to !== 'grace') continue;
        const gap = s.result.gap ? s.row.employments[0]?.contracts.find((c) => c.id === s.result.gap!.id) : null;
        await this.audit.record({
          userId: opts.actorId ?? null,
          action: 'access_standing',
          entityType: EMPLOYEE_ENTITY,
          entityId: person.id,
          diff: {
            standing: { from, to },
            ...(gap && { contract: gap.number }),
            ...(s.result.noContract && { noContract: true }),
            ...(to === 'grace' && s.result.grace && { graceUntil: s.result.grace.until }),
          },
        });
        if (to === 'hold') {
          await this.toEmployee(person.id, { kind: 'access_hold', title: 'Your access is on hold', body: ACCESS_HOLD_MESSAGE, link: HOLD_PATH });
          held.push({ id: person.id, name: person.fullNameEn, noContract: !!s.result.noContract });
        } else if (to === 'grace' && s.result.grace) {
          await this.toEmployee(person.id, {
            kind: 'access_grace',
            title: '7 days’ grace',
            body: `HR gave you full access until ${shownDate(s.result.grace.until)}, while your contract is renewed.`,
            link: '/',
          });
        }
      } catch (err) {
        this.logger.warn(`The access standing of ${person.id} could not be recorded: ${(err as Error).message}`);
      }
    }
    if (held.length) await this.tellHr(held);
    return { changed, held: held.length };
  }

  /**
   * No contract entered (23 October 2026: "Hold them after 7 days"): the first time seen, the day kept (once, by a
   * compare-and-set), audited, and the employee told once when their access is on hold from; the standing read again from
   * it. Once a signed contract starts (or they leave, or a role never held), the day is cleared; while their account is
   * off it is kept, so turning it off and on never starts the 7 days again.
   */
  private async recordNoContract(s: Standing, today: string, actorId: string | null): Promise<Standing> {
    const nc = s.result.noContract;
    const since = s.row.noContractSince;
    if (!nc) {
      const accountOff = s.row.account && !s.row.account.isActive;
      if (since && !accountOff) await this.prisma.employee.updateMany({ where: { id: s.row.id, noContractSince: since }, data: { noContractSince: null } });
      return s;
    }
    if (since) return s;
    const { count } = await this.prisma.employee.updateMany({ where: { id: s.row.id, noContractSince: null }, data: { noContractSince: toDateOnly(today) } });
    const row = { ...s.row, noContractSince: toDateOnly(today) };
    const result = accessStandingOf(standingInputOf(row), today);
    if (count && result.noContract?.holdFrom) {
      await this.audit.record({
        userId: actorId,
        action: 'access_no_contract',
        entityType: EMPLOYEE_ENTITY,
        entityId: s.row.id,
        diff: { noContractSince: today, holdFrom: result.noContract.holdFrom },
      });
      await this.toEmployee(s.row.id, {
        kind: 'access_no_contract',
        title: 'Your contract isn’t entered',
        body: `Your access will be on hold from ${shownDate(result.noContract.holdFrom)} unless your contract is entered. Contact HR.`,
        link: '/',
      });
    }
    return { row, result };
  }

  /**
   * The day before a grace ends (its last day tomorrow, Cairo): the employee told it ends tomorrow, once (reminded_at),
   * while it is still their grace (no contract in force since). Answers how many were told.
   */
  async remindGraceEnding(today: string = todayInCairo(), now: Date = new Date()): Promise<number> {
    const tomorrow = toDateOnly(addDays(today, 1));
    const due = await this.prisma.accessGrace.findMany({ where: { until: tomorrow, remindedAt: null }, select: { id: true, employeeId: true, contractId: true, employmentId: true } });
    if (!due.length) return 0;
    const standings = await standingsOf(this.prisma, due.map((g) => g.employeeId), today);
    let told = 0;
    for (const g of due) {
      const s = standings.get(g.employeeId)?.result;
      // still this grace's gap: the same contract's end, or the same no contract entered
      if (s?.standing !== 'grace' || !s.grace || s.grace.contractId !== g.contractId || (s.grace.employmentId ?? null) !== g.employmentId) continue;
      const { count } = await this.prisma.accessGrace.updateMany({ where: { id: g.id, remindedAt: null }, data: { remindedAt: now } });
      if (!count) continue;
      await this.toEmployee(g.employeeId, {
        kind: 'access_grace_ending',
        title: 'Your grace ends tomorrow',
        body: `Your full access ends after ${shownDate(addDays(today, 1))} unless your contract is renewed. Checking in and out goes on working.`,
        link: '/',
      });
      told++;
    }
    return told;
  }

  /**
   * GET /employees/access/counts: those on Hold and on Grace now, and those with no contract entered (still working, on
   * Hold or on Grace), of the people the caller sees (HR's sidebar, the Employees list's "No contract entered").
   */
  async counts(user: SessionUser, today: string = todayInCairo()): Promise<AccessCounts> {
    if (!seesAccess(user)) throw new ForbiddenException('Only HR, an Admin or a Super Admin see who is on hold.');
    const day = toDateOnly(today);
    const [hidden, current] = await Promise.all([
      this.confidential.view(user),
      this.prisma.employee.findMany({
        where: { OR: [{ employments: { some: { OR: [{ endDate: null }, { endDate: { gte: day } }] } } }, { account: { isActive: true } }] },
        select: { id: true },
      }),
    ]);
    const standings = await standingsOf(
      this.prisma,
      current.map((e) => e.id).filter((id) => !hidden.hidden.has(id)),
      today,
    );
    const counts: AccessCounts = { hold: 0, grace: 0, noContract: 0 };
    for (const { result } of standings.values()) {
      if (result.standing === 'hold' || result.standing === 'grace') counts[result.standing]++;
      if (result.noContract) counts.noContract++;
    }
    return counts;
  }

  /**
   * An employee's standing as the Access tab shows it: the gap they are in, this gap's grace (who gave it, when), and
   * whether `user` may give grace now (never to themself; `mayGive`: they manage this person's access).
   */
  async viewOf(employeeId: string, user: SessionUser, mayGive: boolean, today: string = todayInCairo()): Promise<AccessStandingView> {
    const s = await standingOf(this.prisma, employeeId, today);
    if (!s) return { standing: 'no_access', exempt: null, gap: null, grace: null, canGiveGrace: false, noContract: null };
    return this.view(s, mayGive && user.employeeId !== employeeId, today);
  }

  async view(s: Standing, mayGive: boolean, today: string = todayInCairo()): Promise<AccessStandingView> {
    const { result } = s;
    const contract = result.gap ? s.row.employments[0]?.contracts.find((c) => c.id === result.gap!.id) : null;
    const graceRow = result.grace
      ? s.row.accessGraces.find((g) => g.contractId === result.grace!.contractId && (g.employmentId ?? null) === (result.grace!.employmentId ?? null))
      : null;
    const by = graceRow?.grantedById
      ? await this.prisma.user.findUnique({ where: { id: graceRow.grantedById }, select: { id: true, email: true, employee: { select: { fullNameEn: true } } } })
      : null;
    return {
      standing: result.standing,
      exempt: result.exempt,
      gap: result.gap && contract ? { contractId: contract.id, number: contract.number, endDate: result.gap.endDate! } : null,
      grace: result.grace
        ? {
            from: graceFromOf(result.grace),
            until: result.grace.until,
            grantedAt: result.grace.grantedAt,
            grantedBy: by ? { id: by.id, name: by.employee?.fullNameEn ?? by.email } : null,
            running: result.standing === 'grace' && result.grace.until >= today,
          }
        : null,
      canGiveGrace: mayGive && graceAllowed(result),
      noContract: result.noContract ? { since: result.noContract.since, holdFrom: result.noContract.holdFrom } : null,
    };
  }

  // ---------- telling ----------

  private async toEmployee(employeeId: string, n: Parameters<NotificationsService['notify']>[1]): Promise<void> {
    const userId = (await activeAccountsOf(this.prisma, [employeeId])).get(employeeId);
    if (userId) await this.notifications.notify([userId], n);
  }

  /**
   * HR told who went on Hold this run (a C-level person's the CEO, or HR with Super Admin: stageDeciders), each recipient
   * once: by name for one person, by how many for several (the go-live's first run).
   */
  private async tellHr(people: readonly { id: string; name: string; noContract: boolean }[]): Promise<void> {
    try {
      const byRecipient = new Map<string, { id: string; name: string; noContract: boolean }[]>();
      for (const p of people) {
        for (const userId of await this.notices.stageDeciders('hr', p.id)) {
          if (!byRecipient.has(userId)) byRecipient.set(userId, []);
          byRecipient.get(userId)!.push(p);
        }
      }
      for (const [userId, list] of byRecipient) {
        const one = list.length === 1 ? list[0] : null;
        await this.notifications.notify(
          [userId],
          one
            ? {
                kind: 'access_held',
                title: `On hold: ${one.name}`,
                body: one.noContract
                  ? 'No contract entered: only check-in and check-out work until a signed contract is entered, or you give 7 days’ grace.'
                  : 'Their contract isn’t in force: only check-in and check-out work until it’s renewed, or you give 7 days’ grace.',
                link: `/employees/${one.id}?tab=access`,
              }
            : {
                kind: 'access_held',
                title: `${list.length} people on hold`,
                body: 'Their contracts aren’t in force: only check-in and check-out work until they’re renewed, or you give 7 days’ grace.',
                link: '/employees?access=hold',
              },
        );
      }
    } catch (err) {
      this.logger.error(`HR could not be told who went on hold: ${(err as Error).message}`);
    }
  }
}
