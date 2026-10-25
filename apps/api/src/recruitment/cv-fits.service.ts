import { Injectable } from '@nestjs/common';
import { betterFitOf, cvFitFrom, openPositionsShown, type BetterFitBadge, type OpenFitFound, type OpenPositionFit } from '@trendlix/shared';
import type { SessionUser } from '../auth/session-user.js';
import { todayInCairo, toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CONFIDENTIAL_VACANCY, decidesSuggestions, READS } from './recruitment-access.js';

// The other open positions a CV fits (owner, 25 October 2026, while the CV fit was being built: "and if it recomended to
// another position based on the CV"; packages/shared cv-fit.ts OPEN_POSITION_RULES, suggested-cvs.ts openFitsFor):
// the person's side of Suggested From Earlier CVs, so the two always agree. Kept, not worked out on each page, as a
// vacancy's applicants are hundreds and the open vacancies few: each vacancy's suggestions (VacancySuggestionsService)
// keep its earlier CVs' fits of 50% or more (cv_open_fits) with the very fit they rank by. Shown only while the vacancy
// is open and taking applications (never a C-level one), and the person neither on it (applied, or added) nor decided
// there (added, applied or dismissed; an invited one may still be added): checked each time it is read. HR, the CEO and
// a Super Admin see them (as the suggestions: never a hiring manager or an interviewer); those who decide suggestions add
// one ("Add to this vacancy", through the suggestions' add); a developer reads them, the person's details masked.

/** A CV as its open positions are read: an application's or a general CV's, with its candidate. */
export interface FitRecord {
  kind: 'application' | 'general_cv';
  id: string;
  candidateId: string | null;
}

/** Decided on a vacancy for good (an open suggestion, suggested or invited, may still be added). */
const DECIDED = ['added', 'applied', 'dismissed'];

@Injectable()
export class CvFitsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Whether the caller sees the other open positions: HR, the CEO and a Super Admin (and a developer, masked). */
  sees(user: Pick<SessionUser, 'roles'>): boolean {
    return user.roles.some((r) => READS.includes(r));
  }

  // ---------- kept ----------

  /** A vacancy's earlier CVs' fits replaced, in the suggestions' transaction: those found kept, the rest gone. */
  async replace(tx: Prisma.TransactionClient, vacancyId: string, found: readonly OpenFitFound[]): Promise<void> {
    await tx.cvOpenFit.deleteMany({ where: { vacancyId } });
    if (!found.length) return;
    await tx.cvOpenFit.createMany({
      data: found.map((f) => ({
        vacancyId,
        applicationId: f.record.kind === 'application' ? f.record.id : null,
        generalCvId: f.record.kind === 'general_cv' ? f.record.id : null,
        percent: f.fit.percent,
        fit: f.fit as unknown as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
  }

  /** The fits kept for vacancies no longer open (closed, on hold, filled, past their closing date, or C-level now): gone. */
  async forgetClosed(openIds: readonly string[]): Promise<void> {
    await this.prisma.cvOpenFit.deleteMany({ where: { vacancyId: { notIn: [...openIds] } } });
  }

  // ---------- shown ----------

  /**
   * The open positions of these CVs as shown, each CV's best first (50% or more, as kept): the vacancy open and taking
   * applications (never C-level), the person not on it nor decided there. `withFit`: their parts too (the breakdown); the
   * lists leave them out.
   */
  async ofRecords(records: readonly FitRecord[], user: SessionUser, withFit = true): Promise<Map<string, OpenPositionFit[]>> {
    const out = new Map<string, OpenPositionFit[]>();
    if (!records.length || !this.sees(user)) return out;
    const appIds = records.filter((r) => r.kind === 'application').map((r) => r.id);
    const gcvIds = records.filter((r) => r.kind === 'general_cv').map((r) => r.id);
    const today = toDateOnly(todayInCairo());
    const rows = await this.prisma.cvOpenFit.findMany({
      where: {
        AND: [
          { OR: [...(appIds.length ? [{ applicationId: { in: appIds } }] : []), ...(gcvIds.length ? [{ generalCvId: { in: gcvIds } }] : [])] },
          { vacancy: { AND: [{ status: 'open' }, { OR: [{ closingDate: null }, { closingDate: { gte: today } }] }, { NOT: CONFIDENTIAL_VACANCY }] } },
        ],
      },
      select: { vacancyId: true, applicationId: true, generalCvId: true, percent: true, fit: withFit, vacancy: { select: { id: true, number: true, title: true } } },
    });
    if (!rows.length) return out;
    const candidateOf = new Map(records.map((r) => [r.id, r.candidateId]));
    const candidateIds = [...new Set(records.map((r) => r.candidateId).filter((c): c is string => !!c))];
    const vacancyIds = [...new Set(rows.map((r) => r.vacancyId))];
    const [applied, decided] = await Promise.all([
      this.prisma.jobApplication.findMany({ where: { candidateId: { in: candidateIds }, vacancyId: { in: vacancyIds } }, select: { candidateId: true, vacancyId: true } }),
      this.prisma.vacancySuggestion.findMany({ where: { candidateId: { in: candidateIds }, vacancyId: { in: vacancyIds }, status: { in: DECIDED } }, select: { candidateId: true, vacancyId: true } }),
    ]);
    const blocked = new Set([...applied, ...decided].map((x) => `${x.candidateId}:${x.vacancyId}`));
    const add = decidesSuggestions(user) && !user.developer;
    for (const r of rows) {
      const recordId = (r.applicationId ?? r.generalCvId)!;
      const candidateId = candidateOf.get(recordId);
      if (!candidateId || blocked.has(`${candidateId}:${r.vacancyId}`)) continue;
      const fit = withFit ? cvFitFrom((r as { fit?: Prisma.JsonValue }).fit) : null;
      const list = out.get(recordId) ?? [];
      list.push({ vacancy: r.vacancy, percent: r.percent, fit, can: { add }, record: { kind: r.applicationId ? 'application' : 'general_cv', id: recordId } });
      out.set(recordId, list);
    }
    for (const [id, list] of out) out.set(id, list.sort((a, b) => b.percent - a.percent || a.vacancy.title.localeCompare(b.vacancy.title)));
    return out;
  }

  /** Each CV's Other Open Positions: the top 3 at 50% or more. */
  async shownFor(records: readonly FitRecord[], user: SessionUser): Promise<Map<string, OpenPositionFit[]>> {
    const all = await this.ofRecords(records, user);
    return new Map([...all].map(([id, list]) => [id, openPositionsShown(list)]));
  }

  /**
   * A person's Other Open Positions across their CVs (the candidate's page): for each vacancy the best of their CVs' fits,
   * the top 3 at 50% or more.
   */
  async forPerson(records: readonly FitRecord[], user: SessionUser): Promise<OpenPositionFit[]> {
    const best = new Map<string, OpenPositionFit>();
    for (const list of (await this.ofRecords(records, user)).values()) {
      for (const p of list) if ((best.get(p.vacancy.id)?.percent ?? -1) < p.percent) best.set(p.vacancy.id, p);
    }
    return openPositionsShown([...best.values()]);
  }

  /** Applicants' "Better fit" badges: another open vacancy at 60% or more and 10 points above their own fit, the others on hover. */
  async badges(apps: readonly { id: string; candidateId: string | null; cvMatchPercent: number | null }[], user: SessionUser): Promise<Map<string, BetterFitBadge>> {
    const all = await this.ofRecords(
      apps.map((a) => ({ kind: 'application' as const, id: a.id, candidateId: a.candidateId })),
      user,
      false,
    );
    const out = new Map<string, BetterFitBadge>();
    for (const a of apps) {
      const list = all.get(a.id) ?? [];
      const best = betterFitOf(a.cvMatchPercent, list);
      if (best) out.set(a.id, { vacancy: best.vacancy, percent: best.percent, others: openPositionsShown(list).map((o) => ({ vacancy: o.vacancy, percent: o.percent })) });
    }
    return out;
  }

  /** The General CVs' "Best open position": the open vacancy each CV fits best, at 50% or more. */
  async bestFor(generalCvs: readonly { id: string; candidateId: string | null }[], user: SessionUser): Promise<Map<string, { vacancy: { id: string; number: string; title: string }; percent: number }>> {
    const all = await this.ofRecords(
      generalCvs.map((g) => ({ kind: 'general_cv' as const, id: g.id, candidateId: g.candidateId })),
      user,
      false,
    );
    return new Map(
      [...all].flatMap(([id, list]) => {
        const top = openPositionsShown(list)[0];
        return top ? [[id, { vacancy: top.vacancy, percent: top.percent }] as const] : [];
      }),
    );
  }

  /** The fit kept for one CV and vacancy (Add to this vacancy checks it is still recommended); null: none. */
  async kept(vacancyId: string, record: { applicationId: string } | { generalCvId: string }): Promise<{ percent: number; fit: Prisma.JsonValue } | null> {
    return this.prisma.cvOpenFit.findFirst({ where: { vacancyId, ...record }, select: { percent: true, fit: true } });
  }
}
