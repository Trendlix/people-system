import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CHANGE_REQUEST_STATUS_LABELS, decidesConfidentialStage, type ChangeRequestStatus } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { actsAs } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { isSelf, seesEmployeeFile } from '../employees/access.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NoticesService } from '../notifications/notices.service.js';
import type { PaperworkType } from '../paperwork/paperwork-file.js';
import { PaperworkService } from '../paperwork/paperwork.service.js';
import { PHOTO_PAPER } from '../paperwork/photo-crop.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { sentPhoto } from './photo-file.js';
import { ALL_PHOTO_REQUESTS, type CreatePhotoRequestDto, type PhotoDecisionDto } from './photo-requests.dto.js';
import { PHOTO_REQUEST_SELECT, photoRequestView, type PhotoRequestRow } from './views.js';

const ENTITY = 'profile_photo_request';

/** The database, or a transaction in it. */
type Db = PrismaService | Prisma.TransactionClient;

/** How a photo request stops waiting. */
type Closed = Exclude<ChangeRequestStatus, 'pending'>;

/** HR and Admin (a Super Admin counts as an Admin) decide photo requests, as they decide change requests. */
const DECIDERS = ['hr', 'admin'] as const;

/** "approved", "cancelled" …: a request's status inside a sentence. */
const statusText = (status: string) => (CHANGE_REQUEST_STATUS_LABELS[status as ChangeRequestStatus] ?? status).replace(/^\w/, (c) => c.toLowerCase());

export const PHOTO_WAITING = 'You already have a new photo waiting for HR. Cancel it to send another.';

// A new photo of themself the employee sends HR (owner, 31 October 2026: "allow them to upload a new photo as a request
// and approved from the HR"). Only the employee sends one, for their own profile, and one waits at a time; they may cancel
// it while it waits. Those who decide their change requests decide it (HR or an Admin; a C-level person's the CEO or a
// Super Admin: owner, 19 October 2026, "make C level Employees details not visible to HR"), seeing the photo first:
// approved, it is added to the employee file as the personal photo, as HR's upload of it would be, so it is the picture
// beside their name from then on (HR may crop it); rejected, with a note or none, nothing changes. Logged and notified as
// each step is taken. The photo itself is shown to the employee who sent it and to those who decide it, never anyone else.
@Injectable()
export class PhotoRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly paperwork: PaperworkService,
    private readonly notices: NoticesService,
  ) {}

  /** The employee sends a new photo of themself, with an optional note. One waits at a time. */
  async request(employeeId: string, dto: CreatePhotoRequestDto, file: Express.Multer.File | undefined, user: SessionUser) {
    const e = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
    if (!e) throw new NotFoundException('Employee not found.');
    if (!isSelf(user, e)) throw new ForbiddenException('Only the employee can send a new photo of themself.');
    const photo = sentPhoto(file);
    await this.assertNoneWaiting(this.prisma, employeeId);

    const row = await this.prisma.$transaction(async (tx) => {
      // one at a time, even when two are sent together: the employee's row is held until this one is saved
      await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
      await this.assertNoneWaiting(tx, employeeId);
      return tx.profilePhotoRequest.create({
        data: {
          employeeId,
          requestedById: user.id,
          fileName: photo.fileName,
          mimeType: photo.type,
          sizeBytes: photo.data.length,
          data: new Uint8Array(photo.data),
          note: dto.note ?? null,
        },
        select: PHOTO_REQUEST_SELECT,
      });
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: ENTITY,
      entityId: row.id,
      diff: { employeeId, fileName: row.fileName, sizeBytes: row.sizeBytes, note: row.note, status: 'pending' },
    });
    await this.notices.photoRequestSent(row.id);
    return { ...photoRequestView(row), confidential: await this.confidential.isConfidential(employeeId) };
  }

  /**
   * Photo requests with their employee, newest first: those waiting unless `status` says otherwise; `all`, every one. The
   * CEO without HR or Admin gets C-level people's only, HR and Admin never theirs, as the change requests' list. Each
   * with the employee's current picture beside the name, for those who see the employee file (HR, the CEO), to compare.
   */
  async list(status: ChangeRequestStatus | typeof ALL_PHOTO_REQUESTS = 'pending', user: SessionUser) {
    const confidential = await this.confidential.view(user);
    const ceoOnly = !actsAs(user.roles, [...DECIDERS]);
    const rows = await this.prisma.profilePhotoRequest.findMany({
      where: {
        ...(status !== ALL_PHOTO_REQUESTS && { status }),
        ...(ceoOnly ? { employeeId: { in: [...confidential.all] } } : confidential.hidden.size ? { employeeId: { notIn: [...confidential.hidden] } } : {}),
      },
      // the same moment: the later id first, so the order is the same on every read
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      select: PHOTO_REQUEST_SELECT,
    });
    const current = seesEmployeeFile(user) ? await this.currentPhotos([...new Set(rows.map((r) => r.employeeId))]) : new Map<string, string>();
    return rows.map((r) => ({ ...photoRequestView(r), currentPhotoId: current.get(r.employeeId) ?? null, confidential: confidential.all.has(r.employeeId) }));
  }

  /**
   * The photo sent: to the employee who sent it, and to those who read the photo requests (HR, Admin, the CEO) and see
   * the employee; anyone else is refused, and a C-level person's is not there for those it is hidden from (404).
   */
  async photo(id: string, user: SessionUser): Promise<{ data: Buffer; type: string }> {
    const r = await this.prisma.profilePhotoRequest.findUnique({ where: { id }, select: { employeeId: true, mimeType: true, data: true } });
    if (!r) throw new NotFoundException('Photo request not found.');
    if (user.employeeId !== r.employeeId) {
      if (!actsAs(user.roles, [...DECIDERS, 'ceo'])) throw new ForbiddenException('Only the employee and those who decide their photo requests can see it.');
      await this.confidential.assertVisible(user, r.employeeId, 'Photo request not found.');
    }
    return { data: Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength), type: r.mimeType };
  }

  /**
   * HR or an Admin (a C-level person's: the CEO or a Super Admin) approves: the photo is added to the employee file as the
   * personal photo, uploaded by the one who approved it, as their own upload of it would be (logged, its text read); the
   * picture beside the name from then on, the crop HR chose for the photo before left with that one. If it can't be added,
   * the request keeps waiting.
   */
  async approve(id: string, dto: PhotoDecisionDto, user: SessionUser) {
    const before = await this.row(id);
    await this.assertDecides(before, user);
    this.assertWaiting(before, 'approved');
    const note = dto.note ?? null;
    await this.close(before, 'approved', user, note);
    let photoId: string;
    try {
      const file = await this.prisma.profilePhotoRequest.findUniqueOrThrow({ where: { id }, select: { data: true, mimeType: true, fileName: true } });
      const data = Buffer.from(file.data.buffer, file.data.byteOffset, file.data.byteLength);
      photoId = await this.paperwork.addApprovedPhoto(before.employeeId, { data, type: file.mimeType as PaperworkType, fileName: file.fileName }, user, id);
    } catch (err) {
      // back to waiting, as it was
      await this.prisma.profilePhotoRequest.updateMany({ where: { id, status: 'approved', photoId: null }, data: { status: 'pending', decidedById: null, decidedAt: null, decisionNote: null } });
      throw err;
    }
    await this.prisma.profilePhotoRequest.update({ where: { id }, data: { photoId } });
    return this.decided(before, 'approved', user, note, photoId);
  }

  /** HR or an Admin rejects, with a note or none. Nothing changes on the profile. */
  async reject(id: string, dto: PhotoDecisionDto, user: SessionUser) {
    const before = await this.row(id);
    await this.assertDecides(before, user);
    this.assertWaiting(before, 'rejected');
    const note = dto.note ?? null;
    await this.close(before, 'rejected', user, note);
    return this.decided(before, 'rejected', user, note);
  }

  /** The employee who sent it withdraws it while it waits. */
  async cancel(id: string, user: SessionUser) {
    const before = await this.row(id);
    if (before.requestedById !== user.id) throw new ForbiddenException('Only the employee who sent the photo can cancel it.');
    this.assertWaiting(before, 'cancelled');
    await this.close(before, 'cancelled', user, null);
    return this.decided(before, 'cancelled', user, null);
  }

  // ---------- helpers ----------

  /** Each employee's picture beside the name now (the personal photo uploaded last as an image), by employee. */
  private async currentPhotos(employeeIds: string[]): Promise<Map<string, string>> {
    if (!employeeIds.length) return new Map();
    const items = await this.prisma.paperworkItem.findMany({
      where: { ...PHOTO_PAPER, employeeId: { in: employeeIds } },
      select: { id: true, employeeId: true },
      orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
    });
    const latest = new Map<string, string>();
    for (const item of items) if (!latest.has(item.employeeId)) latest.set(item.employeeId, item.id);
    return latest;
  }

  /**
   * Who decides a photo request, as a change request: HR or an Admin; a C-level person's the CEO or a Super Admin, never
   * their own; 404 for those it is hidden from.
   */
  private async assertDecides(r: PhotoRequestRow, user: SessionUser): Promise<void> {
    await this.confidential.assertVisible(user, r.employeeId, 'Photo request not found.');
    if (await this.confidential.isConfidential(r.employeeId)) {
      if (!decidesConfidentialStage(user, [...DECIDERS])) throw new ForbiddenException("A C-level person's photo request is decided by the CEO or a Super Admin.");
      if ((await this.confidential.selfId(user)) === r.employeeId) throw new ForbiddenException('Someone else has to decide your own photo.');
      return;
    }
    if (!actsAs(user.roles, [...DECIDERS])) throw new ForbiddenException("HR or an Admin decides this photo request: the CEO decides only a C-level person's.");
  }

  private async row(id: string): Promise<PhotoRequestRow> {
    const r = await this.prisma.profilePhotoRequest.findUnique({ where: { id }, select: PHOTO_REQUEST_SELECT });
    if (!r) throw new NotFoundException('Photo request not found.');
    return r;
  }

  private async assertNoneWaiting(db: Db, employeeId: string) {
    const waiting = await db.profilePhotoRequest.findFirst({ where: { employeeId, status: 'pending' }, select: { id: true } });
    if (waiting) throw new ConflictException(PHOTO_WAITING);
  }

  private assertWaiting(r: PhotoRequestRow, to: Closed) {
    if (r.status !== 'pending') throw new ConflictException(`Only a photo waiting for HR can be ${to}. This one is ${statusText(r.status)}.`);
  }

  /** Closes a waiting request, only while it still waits, so two people deciding at once can't both close it. */
  private async close(before: PhotoRequestRow, status: Closed, user: SessionUser, note: string | null) {
    const { count } = await this.prisma.profilePhotoRequest.updateMany({
      where: { id: before.id, status: 'pending' },
      data: { status, decidedById: user.id, decidedAt: new Date(), decisionNote: note },
    });
    if (!count) {
      const now = await this.row(before.id);
      throw new ConflictException(`This photo request was ${statusText(now.status)} meanwhile.`);
    }
  }

  /** Logs the decision (the employee's cancelling too), tells the employee of HR's, and answers the request as it is now. */
  private async decided(before: PhotoRequestRow, status: Closed, user: SessionUser, note: string | null, photoId?: string) {
    await this.audit.record({
      userId: user.id,
      action: { approved: 'approve', rejected: 'reject', cancelled: 'cancel' }[status],
      entityType: ENTITY,
      entityId: before.id,
      diff: { employeeId: before.employeeId, status: { from: 'pending', to: status }, ...(note !== null && { decisionNote: note }), ...(photoId && { photoId }) },
    });
    if (status !== 'cancelled') await this.notices.photoRequestDecided(before.id);
    return { ...photoRequestView(await this.row(before.id)), confidential: await this.confidential.isConfidential(before.employeeId) };
  }
}
