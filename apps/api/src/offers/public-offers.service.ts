import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { fromDateOnly, shownDate, toDateOnly, todayInCairo } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DOCX_MIME } from '../templates/docx-tags.js';
import { OfferHiringService, type HireResult } from './offer-hiring.service.js';
import type { AcceptOfferDto, DeclineOfferDto } from './offers.dto.js';
import { cairoDate, nameMatches, shownStatus, tokenHash } from './rules.js';
import { publicOfferView } from './views.js';

const ENTITY = 'job_offer';
/** A link's secret: 32 random bytes, base64url. */
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const NOT_VALID = 'This offer link is not valid. It may have been replaced by a newer email.';
const TYPE_YOUR_NAME = 'Type your full name as it is on the offer.';
/** How much of what the candidate's browser says is kept. */
const NAME_MAX = 200;
const IP_MAX = 100;
const AGENT_MAX = 500;

/** What the offer's page needs, and what answering it checks. */
const PUBLIC = {
  id: true,
  number: true,
  status: true,
  fullNameEn: true,
  fullNameAr: true,
  employmentType: true,
  joinDate: true,
  expiresOn: true,
  message: true,
  fileName: true,
  respondedAt: true,
  acceptedName: true,
  declineReason: true,
  viewedAt: true,
  sentById: true,
  tokenHash: true,
  jobTitle: { select: { titleEn: true, titleAr: true } },
} satisfies Prisma.JobOfferSelect;

type PublicRow = Prisma.JobOfferGetPayload<{ select: typeof PUBLIC }>;

/** Where the candidate answered from, as the web app passed it on, else as the request shows it. */
export interface ResponseOrigin {
  ip: string | null;
  userAgent: string | null;
}

const cut = (s: string | null | undefined, max: number) => (s ? s.slice(0, max) : null);

// The offer's page (owner's request, 15 October 2026): the candidate opens the link HR sent, reads the offer and
// accepts it (typing their full name) or declines it, without signing in. The link's secret is the only key: it is
// never stored (only its SHA-256), sending the offer again replaces it, and withdrawing the offer clears it. The page
// never shows an amount; the document has them.
@Injectable()
export class PublicOffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly hiring: OfferHiringService,
  ) {}

  /** The offer as the candidate sees it; the first time records that they opened the link. */
  async view(secret: string) {
    const o = await this.bySecret(secret);
    await this.opened(o);
    return this.publicView(o);
  }

  /** The offer as sent: the PDF, shown in the browser, or the Word file when there is no PDF. */
  async file(secret: string): Promise<{ data: Buffer; type: string; fileName: string; inline: boolean }> {
    const o = await this.bySecret(secret);
    const files = await this.prisma.jobOffer.findUniqueOrThrow({ where: { id: o.id }, select: { data: true, pdf: true } });
    if (!files.data || !o.fileName) throw new NotFoundException("The offer's document isn't available. Please contact HR.");
    await this.opened(o);
    if (files.pdf) return { data: Buffer.from(files.pdf), type: 'application/pdf', fileName: o.fileName.replace(/\.docx$/i, '.pdf'), inline: true };
    return { data: Buffer.from(files.data), type: DOCX_MIME, fileName: o.fileName, inline: false };
  }

  /**
   * Accepts a sent offer that is still open: the name typed must be the offer's, in English or Arabic (see
   * nameMatches). The profile, employment and draft contract are made at once; if that fails the acceptance stands
   * and HR makes them once the problem is fixed.
   */
  async accept(secret: string, dto: AcceptOfferDto, from: ResponseOrigin) {
    const o = await this.bySecret(secret);
    assertOpen(o);
    if (!nameMatches(dto.name, [o.fullNameEn, o.fullNameAr])) throw new BadRequestException(TYPE_YOUR_NAME);
    const respondedAt = new Date();
    await this.answered(o, {
      status: 'accepted',
      respondedAt,
      acceptedName: cut(dto.name.replace(/\s+/g, ' ').trim(), NAME_MAX),
      responseIp: cut(dto.ip ?? from.ip, IP_MAX),
      responseAgent: cut(dto.userAgent ?? from.userAgent, AGENT_MAX),
    });
    const hired: HireResult = await this.hiring.tryHire(o.id, null);
    await this.hiring.notify({ ...o, respondedAt }, 'accepted', { userId: null }, hired);
    return this.view(secret);
  }

  /** Declines a sent offer that is still open, with the candidate's reason when they give one. */
  async decline(secret: string, dto: DeclineOfferDto, from: ResponseOrigin) {
    const o = await this.bySecret(secret);
    assertOpen(o);
    const respondedAt = new Date();
    const declineReason = dto.reason ?? null;
    await this.answered(o, {
      status: 'declined',
      respondedAt,
      declineReason,
      responseIp: cut(dto.ip ?? from.ip, IP_MAX),
      responseAgent: cut(dto.userAgent ?? from.userAgent, AGENT_MAX),
    });
    await this.hiring.notify({ ...o, respondedAt, declineReason }, 'declined', { userId: null }, null);
    return this.view(secret);
  }

  // ---------- helpers ----------

  /** The offer whose link this is; 404 for any other secret (one replaced by a newer email, a withdrawn offer's …). */
  private async bySecret(secret: string): Promise<PublicRow> {
    if (!SECRET.test(secret)) throw new NotFoundException(NOT_VALID);
    const o = await this.prisma.jobOffer.findUnique({ where: { tokenHash: tokenHash(secret) }, select: PUBLIC });
    if (!o) throw new NotFoundException(NOT_VALID);
    return o;
  }

  /** The first time the candidate opens the link (each new link starts unopened). */
  private async opened(o: PublicRow) {
    if (!o.viewedAt) await this.prisma.jobOffer.updateMany({ where: { id: o.id, viewedAt: null }, data: { viewedAt: new Date() } });
  }

  /** The answer saved, if the offer is still open by the same link: else the reason it no longer is (409). */
  private async answered(o: PublicRow, data: Prisma.JobOfferUpdateManyMutationInput) {
    const { count } = await this.prisma.jobOffer.updateMany({
      where: { id: o.id, status: 'sent', tokenHash: o.tokenHash, expiresOn: { gte: toDateOnly(todayInCairo()) } },
      data,
    });
    if (!count) {
      const now = await this.prisma.jobOffer.findUnique({ where: { id: o.id }, select: PUBLIC });
      if (now) assertOpen(now);
      throw new ConflictException('This offer changed while you were answering. Reload the page to see where it stands.');
    }
    await this.audit.record({
      userId: null,
      action: 'answer',
      entityType: ENTITY,
      entityId: o.id,
      diff: { number: o.number, status: { from: 'sent', to: data.status }, online: true, ...(data.status === 'declined' && { reason: data.declineReason }) },
    });
  }

  private async publicView(o: PublicRow) {
    const [company, [files]] = await Promise.all([
      this.prisma.company.findUnique({ where: { id: 1 }, select: { nameEn: true, nameAr: true } }),
      this.prisma.$queryRaw<{ hasPdf: boolean }[]>`SELECT pdf IS NOT NULL AS "hasPdf" FROM job_offers WHERE id = ${o.id}::uuid`,
    ]);
    return publicOfferView(o, { company, hasPdf: files?.hasPdf ?? false });
  }
}

/** A sent offer that hasn't expired; for any other, why it can't be answered (409), in words for the candidate. */
function assertOpen(o: PublicRow): void {
  const status = shownStatus(o);
  const on = o.respondedAt ? shownDate(cairoDate(o.respondedAt)) : null;
  switch (status) {
    case 'sent':
      return;
    case 'accepted':
      throw new ConflictException(`You already accepted this offer${on ? ` on ${on}` : ''}.`);
    case 'declined':
      throw new ConflictException(`You declined this offer${on ? ` on ${on}` : ''}. If you have changed your mind, please contact HR.`);
    case 'expired':
      throw new ConflictException(`This offer was open until ${shownDate(fromDateOnly(o.expiresOn))}. If you still want to accept it, please contact HR.`);
    case 'withdrawn':
      throw new ConflictException('This offer was withdrawn.');
    default:
      throw new ConflictException('This offer is not open yet.');
  }
}
