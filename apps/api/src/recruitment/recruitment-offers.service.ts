import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { APPLICATION_STAGE_LABELS, offerable, type ApplicationEvent, type ApplicationStage } from '@trendlix/shared';
import type { SessionUser } from '../auth/session-user.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OPEN_OFFER } from './applications.service.js';
import { vacancyWhere } from './recruitment-access.js';
import { APPLICATION_ENTITY, VACANCY_ENTITY } from './recruitment-views.js';

// Between an applicant and their job offer (owner, 22 October 2026: "where will we include the ATS?"; the brief: "Make
// offer, which opens the existing job-offer form pre-filled from the applicant and the vacancy, linking the offer and
// the application"). A job offer made from an application moves it to Offer; the offer's answer moves it on: accepted,
// Hired (with the profile made from it), the vacancy filled once its hires reach the headcount; declined, withdrawn or
// deleted, back to Shortlisted, where HR rejects them or makes another offer. Used by the job offers' services, so it
// never fails their answer: a failure here is logged.

@Injectable()
export class RecruitmentOffersService {
  private readonly logger = new Logger('Recruitment');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Whether a job offer may be made from the application, for the caller: one they may see (404 otherwise),
   * shortlisted, at interview or at Offer, not filtered out, with no job offer open to them (409 in words otherwise).
   */
  async assertOfferable(applicationId: string, user: SessionUser): Promise<void> {
    const a = await this.prisma.jobApplication.findFirst({
      where: { id: applicationId, vacancy: vacancyWhere(user) },
      select: { stage: true, filteredOut: true, offers: { where: OPEN_OFFER, select: { number: true } } },
    });
    if (!a) throw new NotFoundException('Applicant not found.');
    if (a.offers.length) throw new ConflictException(`A job offer to them is open already (${a.offers[0].number}).`);
    const stage = a.stage as ApplicationStage;
    if (!offerable({ stage, filteredOut: a.filteredOut })) {
      throw new ConflictException(
        a.filteredOut ? 'They failed a must-have question and were filtered out: restore them first.' : `They are at ${APPLICATION_STAGE_LABELS[stage]}: shortlist them first.`,
      );
    }
  }

  /** The job offer drafted from the application: it moves to Offer, with the offer's number in its history. */
  async offerMade(applicationId: string, offer: { id: string; number: string }, userId: string): Promise<void> {
    try {
      const a = await this.prisma.jobApplication.findUnique({ where: { id: applicationId }, select: { id: true, number: true, stage: true } });
      if (!a) return;
      await this.prisma.$transaction([
        this.prisma.jobApplication.update({ where: { id: a.id }, data: { stage: 'offer', rejectedFrom: null, rejectReason: null } }),
        this.prisma.jobApplicationStep.create({ data: { applicationId: a.id, event: 'offer', stage: 'offer', note: offer.number, byId: userId } }),
      ]);
      await this.audit.record({ userId, action: 'stage', entityType: APPLICATION_ENTITY, entityId: a.id, diff: { number: a.number, stage: { from: a.stage, to: 'offer' }, offer: offer.number } });
    } catch (err) {
      this.logger.warn(`Moving the application of ${offer.number} to Offer failed: ${(err as Error).message}`);
    }
  }

  /**
   * The job offer's answer, or its end: accepted, Hired (with the profile made, when it was); declined, withdrawn or
   * deleted, back to Shortlisted. Nothing for an offer made from no application. `userId`: null when the candidate
   * answered online.
   */
  async offerEnded(offerId: string, outcome: 'accepted' | 'declined' | 'withdrawn', employeeId: string | null, userId: string | null): Promise<void> {
    try {
      const o = await this.prisma.jobOffer.findUnique({
        where: { id: offerId },
        select: { number: true, application: { select: { id: true, number: true, stage: true, vacancyId: true } } },
      });
      const a = o?.application;
      if (!o || !a) return;
      if (outcome === 'accepted') {
        await this.prisma.$transaction([
          this.prisma.jobApplication.update({ where: { id: a.id }, data: { stage: 'hired', rejectedFrom: null, rejectReason: null, ...(employeeId && { employeeId }) } }),
          this.prisma.jobApplicationStep.create({ data: { applicationId: a.id, event: 'hired', stage: 'hired', note: o.number, byId: userId } }),
        ]);
        await this.audit.record({ userId, action: 'stage', entityType: APPLICATION_ENTITY, entityId: a.id, diff: { number: a.number, stage: { from: a.stage, to: 'hired' }, offer: o.number } });
        await this.fillIfDone(a.vacancyId, userId);
        return;
      }
      if (a.stage !== 'offer') return;
      // another offer to them still open keeps them at Offer
      if (await this.prisma.jobOffer.count({ where: { applicationId: a.id, id: { not: offerId }, ...OPEN_OFFER } })) return;
      const event: ApplicationEvent = outcome === 'declined' ? 'offer_declined' : 'offer_withdrawn';
      await this.prisma.$transaction([
        this.prisma.jobApplication.update({ where: { id: a.id }, data: { stage: 'shortlisted' } }),
        this.prisma.jobApplicationStep.create({ data: { applicationId: a.id, event, stage: 'shortlisted', note: o.number, byId: userId } }),
      ]);
      await this.audit.record({ userId, action: 'stage', entityType: APPLICATION_ENTITY, entityId: a.id, diff: { number: a.number, stage: { from: 'offer', to: 'shortlisted' }, offer: o.number, why: outcome } });
    } catch (err) {
      this.logger.warn(`Moving the application of an offer on (${outcome}) failed: ${(err as Error).message}`);
    }
  }

  /** The profile made from an accepted offer later (Make the profile again): kept on its application. */
  async profileMade(offerId: string, employeeId: string): Promise<void> {
    try {
      await this.prisma.jobApplication.updateMany({ where: { offers: { some: { id: offerId } }, stage: 'hired', employeeId: null }, data: { employeeId } });
    } catch (err) {
      this.logger.warn(`Keeping the profile on the application failed: ${(err as Error).message}`);
    }
  }

  /** The vacancy filled once its hires reach the headcount (while open or on hold). */
  private async fillIfDone(vacancyId: string, userId: string | null): Promise<void> {
    const v = await this.prisma.vacancy.findUnique({ where: { id: vacancyId }, select: { id: true, number: true, status: true, headcount: true } });
    if (!v || (v.status !== 'open' && v.status !== 'on_hold')) return;
    const hired = await this.prisma.jobApplication.count({ where: { vacancyId, stage: 'hired' } });
    if (hired < v.headcount) return;
    const { count } = await this.prisma.vacancy.updateMany({ where: { id: vacancyId, status: v.status }, data: { status: 'filled', closedAt: new Date() } });
    if (count) await this.audit.record({ userId, action: 'fill', entityType: VACANCY_ENTITY, entityId: vacancyId, diff: { number: v.number, status: { from: v.status, to: 'filled' }, hired } });
  }
}
