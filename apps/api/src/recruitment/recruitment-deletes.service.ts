import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  applicationDeleteRefusal,
  DEVELOPER_READ_ONLY,
  offerWentOut,
  vacancyConfirmed,
  vacancyConfirmText,
  vacancyDeleteRefusal,
  type ApplicationDeletion,
  type DeleteRefusal,
  type VacancyDeletion,
  type VacancyStatus,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lockCandidates, refreshCandidate } from './candidate-links.js';
import { CANDIDATE_ENTITY } from './candidates.service.js';
import { GENERAL_CV_ENTITY } from './general-cvs.service.js';
import { vacancyWhere } from './recruitment-access.js';
import { APPLICATION_ENTITY, VACANCY_ENTITY } from './recruitment-views.js';
import { VacancySuggestionsService } from './vacancy-suggestions.service.js';

// Deleting an applicant, or a vacancy people applied to (owner, 25 October 2026, on a closed vacancy with one rejected
// applicant: "i want to delete this"; asked, "Vacancy alone - applicant alone - superadmin only"; packages/shared
// recruitment-deletes.ts). A Super Admin only, never a developer. In one transaction, under the candidates' lock (taken
// first, as every path that touches candidates does: candidate-links.ts):
// - an application goes with its steps, interviews (their interviewers and scorecards), screening comments, CV, the
//   CV's reading and its PDF preview (all kept in the database, each record its own copy, so nothing another record
//   uses goes), and the job offers drafted to them and never sent; its notifications (the bell's, its draft offers'
//   too) are deleted and its WhatsApp messages still waiting cancelled; the suggestion it closed on its vacancy (added,
//   or applied) is deleted, and those it was the earlier CV of that HR hadn't decided, so the person can be suggested
//   again from what is left; a general CV moved into it is Reviewed again (it can be moved or suggested again);
// - it stays on record (refused, nothing changed) when someone was hired from it, an offer was sent to them, or an
//   interview is still to come;
// - its candidate profile goes with it when nothing else is left (no other application, no general CV, no employee
//   linked), with the profiles merged into it (empty, kept only to undo the merge); otherwise it stays, worked out
//   again (its keys, its possible matches, when it last applied); its contacts stay with it;
// - a vacancy goes with every application on it by the same rules, once its number is typed (?confirm=VAC-2026-0001,
//   needed only when people applied); if any application stays, the vacancy stays, each one named.
// Audited after the commit: one entry for the vacancy (its number, title, status, the applications' numbers), one per
// application (its number, vacancy, stage and source, never the CV, the name or the email), one per candidate profile
// deleted (its code) and one per general CV made Reviewed again.

const APPLICANT_NOT_FOUND = 'Applicant not found.';
const VACANCY_NOT_FOUND = 'Vacancy not found.';

/** What an application is read with to check and delete it. */
const APP_SELECT = {
  id: true,
  number: true,
  stage: true,
  source: true,
  employeeId: true,
  candidateId: true,
  vacancy: { select: { id: true, number: true, title: true } },
  offers: { select: { id: true, number: true, status: true, sentAt: true, hiredAt: true } },
  interviews: { select: { id: true, status: true, startsAt: true, minutes: true } },
  generalCv: { select: { id: true, number: true, status: true } },
  cv: { select: { preview: { select: { id: true } } } },
  // its earlier CVs (applying again, 25 October 2026) go with it too
  _count: { select: { onboarding: true, comments: true, earlierCvs: true } },
} satisfies Prisma.JobApplicationSelect;

type AppRow = Prisma.JobApplicationGetPayload<{ select: typeof APP_SELECT }>;
type Db = PrismaService | Prisma.TransactionClient;

/** What went, for the audit log and the suggestions worked out again. */
interface Purged {
  applications: { id: string; number: string; vacancy: string; stage: string; source: string; interviews: number; comments: number; draftOffers: string[] }[];
  candidates: { id: string; code: string; merged: boolean }[];
  generalCvs: { id: string; number: string; application: string }[];
  /** The open vacancies whose suggestions may change: the application's own, those it was the earlier CV of. */
  vacancyIds: string[];
}

const refusalOf = (a: AppRow, now: Date): DeleteRefusal | null =>
  applicationDeleteRefusal({ number: a.number, stage: a.stage, employeeId: a.employeeId, offers: a.offers, interviews: a.interviews, onboarding: a._count.onboarding }, now);

@Injectable()
export class RecruitmentDeletesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly suggestions: VacancySuggestionsService,
  ) {}

  /** A Super Admin, never a developer (answered with a Super Admin's sight, but read only). */
  private assertMay(user: SessionUser): void {
    if (user.developer) throw new ForbiddenException(DEVELOPER_READ_ONLY);
    assertDeletes(user);
  }

  // ---------- what goes ----------

  /** GET /recruitment/applications/:id/deletion: what deleting it takes with it, or why it stays. */
  async applicationDeletion(id: string, user: SessionUser): Promise<ApplicationDeletion> {
    this.assertMay(user);
    const a = await this.prisma.jobApplication.findFirst({ where: { id, vacancy: vacancyWhere(user) }, select: APP_SELECT });
    if (!a) throw new NotFoundException(APPLICANT_NOT_FOUND);
    const going = await this.candidatesGoing(this.prisma, [a]);
    const candidate = a.candidateId ? await this.prisma.candidate.findUnique({ where: { id: a.candidateId }, select: { id: true, code: true } }) : null;
    return {
      id: a.id,
      number: a.number,
      vacancy: a.vacancy,
      refusal: refusalOf(a, new Date())?.text ?? null,
      interviews: a.interviews.length,
      comments: a._count.comments,
      files: (a.cv ? 1 + (a.cv.preview ? 1 : 0) : 0) + a._count.earlierCvs,
      draftOffers: a.offers.filter((o) => !offerWentOut(o)).length,
      candidate: candidate && { id: candidate.id, code: candidate.code, goes: going.has(candidate.id) },
    };
  }

  /** GET /recruitment/vacancies/:id/deletion: what deleting it takes with it, or why it stays. */
  async vacancyDeletion(id: string, user: SessionUser): Promise<VacancyDeletion> {
    this.assertMay(user);
    const v = await this.prisma.vacancy.findFirst({ where: { AND: [{ id }, vacancyWhere(user)] }, select: { id: true, number: true, title: true, status: true } });
    if (!v) throw new NotFoundException(VACANCY_NOT_FOUND);
    const apps = await this.prisma.jobApplication.findMany({ where: { vacancyId: id }, select: APP_SELECT, orderBy: { number: 'asc' } });
    const now = new Date();
    const refusals = apps.map((a) => refusalOf(a, now)?.short).filter((x): x is string => !!x);
    return {
      id: v.id,
      number: v.number,
      title: v.title,
      status: v.status as VacancyStatus,
      applications: apps.length,
      refusals,
      candidates: (await this.candidatesGoing(this.prisma, apps)).size,
      confirm: apps.length > 0,
    };
  }

  /** The candidates left with nothing once these applications go: no other application, no general CV, no employee linked. */
  private async candidatesGoing(db: Db, apps: readonly Pick<AppRow, 'id' | 'candidateId'>[]): Promise<Set<string>> {
    const ids = [...new Set(apps.map((a) => a.candidateId).filter((x): x is string => !!x))];
    if (!ids.length) return new Set();
    const rows = await db.candidate.findMany({
      where: { id: { in: ids } },
      select: { id: true, employeeId: true, _count: { select: { generalCvs: true } }, applications: { where: { id: { notIn: apps.map((a) => a.id) } }, select: { id: true }, take: 1 } },
    });
    return new Set(rows.filter((c) => !c.employeeId && !c._count.generalCvs && !c.applications.length).map((c) => c.id));
  }

  // ---------- deleting ----------

  /** DELETE /recruitment/applications/:id: the application on its own (409 in words when it stays on record). */
  async removeApplication(id: string, user: SessionUser): Promise<void> {
    this.assertMay(user);
    if (!(await this.prisma.jobApplication.count({ where: { id, vacancy: vacancyWhere(user) } }))) throw new NotFoundException(APPLICANT_NOT_FOUND);
    const purged = await this.prisma.$transaction(
      async (tx) => {
        await lockCandidates(tx);
        return this.purge(tx, [id], user, (refused) => new ConflictException(refused[0].refusal.text));
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    await this.record(purged, user, null);
    await this.refreshSuggestions(purged.vacancyIds);
  }

  /**
   * DELETE /recruitment/vacancies/:id?confirm=VAC-2026-0001: the vacancy with every application on it. Refused (409) when
   * any application stays on record, each named; then (400) without its number typed, when people applied.
   */
  async removeVacancy(id: string, confirm: string | null | undefined, user: SessionUser): Promise<void> {
    const before = await this.vacancyDeletion(id, user);
    if (before.refusals.length) throw new ConflictException(vacancyDeleteRefusal(before.refusals));
    if (before.applications && !vacancyConfirmed(confirm, before.number)) throw new BadRequestException([vacancyConfirmText(before.number, before.applications)]);
    const purged = await this.prisma.$transaction(
      async (tx) => {
        await lockCandidates(tx);
        await tx.$queryRaw`SELECT 1 FROM vacancies WHERE id = ${id}::uuid FOR UPDATE`;
        const ids = (await tx.jobApplication.findMany({ where: { vacancyId: id }, select: { id: true } })).map((a) => a.id);
        // one applied meanwhile: worked out again under the lock, refused the same way
        const done = ids.length
          ? await this.purge(tx, ids, user, (refused) => new ConflictException(vacancyDeleteRefusal(refused.map((r) => r.refusal.short))))
          : { applications: [], candidates: [], generalCvs: [], vacancyIds: [] };
        // its own notifications (waiting for the CEO, decided, its suggested CVs): their page is gone
        await tx.notification.deleteMany({ where: { link: { startsWith: `/recruitment/vacancies/${id}` } } });
        // its suggestions and its bulk upload's CVs waiting go with it (cascade)
        await tx.vacancy.delete({ where: { id } });
        return done;
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    await this.record(purged, user, before.number);
    await this.audit.record({
      userId: user.id,
      action: 'delete',
      entityType: VACANCY_ENTITY,
      entityId: id,
      diff: { number: before.number, title: before.title, status: before.status, applicationsDeleted: purged.applications.map((a) => a.number) },
    });
    await this.refreshSuggestions(purged.vacancyIds.filter((v) => v !== id));
  }

  /**
   * The applications deleted with what hangs off them, in the caller's transaction (the candidates' lock held): each
   * checked again under its row's lock; `refuse` makes the error when any stays on record (nothing changed).
   */
  private async purge(tx: Prisma.TransactionClient, ids: readonly string[], user: SessionUser, refuse: (refused: { app: AppRow; refusal: DeleteRefusal }[]) => Error): Promise<Purged> {
    await tx.$queryRaw`SELECT 1 FROM job_applications WHERE id = ANY(${[...ids].sort()}::uuid[]) ORDER BY id FOR UPDATE`;
    const apps = await tx.jobApplication.findMany({ where: { id: { in: [...ids] } }, select: APP_SELECT, orderBy: { number: 'asc' } });
    const now = new Date();
    const refused = apps.map((app) => ({ app, refusal: refusalOf(app, now) })).filter((r): r is { app: AppRow; refusal: DeleteRefusal } => r.refusal !== null);
    if (refused.length) throw refuse(refused);
    const appIds = apps.map((a) => a.id);
    const interviewIds = apps.flatMap((a) => a.interviews.map((i) => i.id));
    // none went out (or it was refused): drafts, and withdrawn ones never sent
    const offerIds = apps.flatMap((a) => a.offers.map((o) => o.id));
    const going = await this.candidatesGoing(tx, apps);

    // the bell's notifications about them (interviews, scorecards, comments, the hiring manager's suggestion) and their draft offers
    await tx.notification.deleteMany({
      where: { OR: [...appIds.map((id) => ({ link: { startsWith: `/recruitment/applicants/${id}` } })), ...offerIds.map((id) => ({ link: { startsWith: `/offers/${id}` } }))] },
    });
    // WhatsApp messages still waiting (an interview's reminder, an update): never sent; those sent stay in its log
    await tx.whatsAppMessage.updateMany({
      where: { status: 'queued', OR: [{ applicationId: { in: appIds } }, ...(interviewIds.length ? [{ interviewId: { in: interviewIds } }] : [])] },
      data: { status: 'cancelled', error: 'The application was deleted: not sent.', updatedAt: now },
    });
    // Suggested From Earlier CVs (24 October 2026): the suggestion it closed (added, applied) goes, and those it was the
    // earlier CV of while still only suggested, so the person can be suggested again from what is left
    const closed = await tx.vacancySuggestion.findMany({ where: { applicationId: { in: appIds } }, select: { id: true, vacancyId: true } });
    const sourced = await tx.vacancySuggestion.findMany({ where: { sourceApplicationId: { in: appIds }, status: 'suggested' }, select: { id: true, vacancyId: true } });
    if (closed.length || sourced.length) await tx.vacancySuggestion.deleteMany({ where: { id: { in: [...closed, ...sourced].map((s) => s.id) } } });
    // a general CV moved into it: Reviewed again, to be moved or suggested again
    const generalCvs: Purged['generalCvs'] = [];
    for (const a of apps) {
      if (!a.generalCv || a.generalCv.status !== 'moved') continue;
      await tx.generalCv.update({ where: { id: a.generalCv.id }, data: { status: 'reviewed', applicationId: null, movedAt: null } });
      await tx.generalCvEvent.create({ data: { generalCvId: a.generalCv.id, event: 'restored', note: `Its application on ${a.vacancy.number} was deleted`, byId: user.id } });
      generalCvs.push({ id: a.generalCv.id, number: a.generalCv.number, application: a.number });
    }
    if (offerIds.length) await tx.jobOffer.deleteMany({ where: { id: { in: offerIds } } });
    // the steps, interviews, screening comments, CV, its reading and preview go with it (cascade)
    await tx.jobApplication.deleteMany({ where: { id: { in: appIds } } });

    // their candidate profiles: gone with nothing left, else worked out again
    const candidates: Purged['candidates'] = [];
    const candidateIds = [...new Set(apps.map((a) => a.candidateId).filter((x): x is string => !!x))];
    for (const candidateId of candidateIds) {
      if (!going.has(candidateId)) {
        await refreshCandidate(tx, candidateId);
        continue;
      }
      const c = await tx.candidate.findUnique({ where: { id: candidateId }, select: { id: true, code: true } });
      if (!c) continue;
      const shells = await this.mergedInto(tx, candidateId);
      await tx.candidate.deleteMany({ where: { id: { in: [candidateId, ...shells.map((s) => s.id)] } } });
      candidates.push({ ...c, merged: false }, ...shells.map((s) => ({ ...s, merged: true })));
    }

    return {
      applications: apps.map((a) => ({
        id: a.id,
        number: a.number,
        vacancy: a.vacancy.number,
        stage: a.stage,
        source: a.source,
        interviews: a.interviews.length,
        comments: a._count.comments,
        draftOffers: a.offers.map((o) => o.number),
      })),
      candidates,
      generalCvs,
      vacancyIds: [...new Set([...apps.map((a) => a.vacancy.id), ...closed.map((s) => s.vacancyId), ...sourced.map((s) => s.vacancyId)])],
    };
  }

  /** The profiles merged into a candidate (and into those, …): empty since the merge, kept only to undo it. One holding a record is left. */
  private async mergedInto(tx: Prisma.TransactionClient, candidateId: string): Promise<{ id: string; code: string }[]> {
    const out: { id: string; code: string }[] = [];
    let frontier = [candidateId];
    for (let hops = 0; frontier.length && hops < 10; hops++) {
      const rows = await tx.candidate.findMany({
        where: { mergedIntoId: { in: frontier } },
        select: { id: true, code: true, _count: { select: { applications: true, generalCvs: true } } },
      });
      const empty = rows.filter((r) => !r._count.applications && !r._count.generalCvs);
      out.push(...empty.map((r) => ({ id: r.id, code: r.code })));
      frontier = empty.map((r) => r.id);
    }
    return out;
  }

  /** The audit log, after the commit: each application, each general CV made Reviewed again, each candidate profile deleted. */
  private async record(p: Purged, user: SessionUser, withVacancy: string | null): Promise<void> {
    for (const a of p.applications) {
      await this.audit.record({
        userId: user.id,
        action: 'delete',
        entityType: APPLICATION_ENTITY,
        entityId: a.id,
        diff: {
          number: a.number,
          vacancy: a.vacancy,
          stage: a.stage,
          source: a.source,
          interviews: a.interviews,
          comments: a.comments,
          ...(a.draftOffers.length && { draftOffers: a.draftOffers }),
          ...(withVacancy && { withVacancy: true }),
        },
      });
    }
    for (const g of p.generalCvs) {
      await this.audit.record({ userId: user.id, action: 'restore', entityType: GENERAL_CV_ENTITY, entityId: g.id, diff: { number: g.number, status: { from: 'moved', to: 'reviewed' }, applicationDeleted: g.application } });
    }
    for (const c of p.candidates) {
      await this.audit.record({ userId: user.id, action: 'delete', entityType: CANDIDATE_ENTITY, entityId: c.id, diff: { code: c.code, ...(c.merged && { mergedProfile: true }) } });
    }
  }

  /** The open vacancies' suggestions worked out again (never throws), so a CV whose application went can be suggested again. */
  private async refreshSuggestions(vacancyIds: readonly string[]): Promise<void> {
    for (const id of vacancyIds) await this.suggestions.refreshVacancy(id, { notify: false });
  }
}
