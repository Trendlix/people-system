import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { isCustodyCode, normalCustodyCode, type CustodyRecordView } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { detectPaperworkType, PAPERWORK_MAX_BYTES, PAPERWORK_MAX_MB, safeFileName } from '../paperwork/paperwork-file.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AssetsCaller } from './assets-access.js';
import { CUSTODY_ENTITY, CUSTODY_NOT_FOUND, CustodyService } from './custody.service.js';

// A custody record's signed copy (Assets step 3; the spec's paper signing: "save the handover → print the form → the
// employee signs on paper → photograph/scan the signed page and attach it"): a photo (JPEG, PNG, WebP) or a PDF, known by
// its first bytes, never by the browser's word, at most 10 MB, kept in the database as the asset photos and the
// employee file's papers are; a few to a record (a form of several pages). A custodian or a manager attaches one (the
// phone pages with the camera); anyone with Assets access opens it, and the person themself their own, from My custody.
// Attaching one takes the record off the Not signed list. Audited, its name and size, never its content.

const FILE_NOT_FOUND = 'File not found.';
/** The most files a record keeps: its pages. */
export const CUSTODY_FILES_MAX = 10;

export interface CustodyFile {
  data: Buffer;
  type: string;
  fileName: string;
}

@Injectable()
export class CustodyFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly custody: CustodyService,
  ) {}

  /** POST /assets/custody/:code/signed (the field `file`): the record with its signed copies after. */
  async attach(code: string, file: Express.Multer.File | undefined, caller: AssetsCaller): Promise<CustodyRecordView> {
    const record = await this.custody.detail(code, caller.user);
    if (!file?.buffer?.length) throw new BadRequestException(['Choose the photo or the PDF of the signed form.']);
    if (file.buffer.length > PAPERWORK_MAX_BYTES) throw new BadRequestException([`The file must be ${PAPERWORK_MAX_MB} MB or smaller.`]);
    const type = detectPaperworkType(file.buffer);
    if (!type) throw new BadRequestException(['Attach a photo (JPEG, PNG or WebP) or a PDF of the signed form.']);
    if (record.files.length >= CUSTODY_FILES_MAX) throw new ConflictException(`A custody record keeps at most ${CUSTODY_FILES_MAX} files.`);
    const fileName = safeFileName(file.originalname, type);
    const row = await this.prisma.custodyFile.create({
      data: { custodyId: record.id, fileName, mimeType: type, sizeBytes: file.buffer.length, data: new Uint8Array(file.buffer), uploadedById: caller.user.id },
      select: { id: true },
    });
    await this.audit.record({
      userId: caller.user.id,
      action: 'attach_signed',
      entityType: CUSTODY_ENTITY,
      entityId: record.id,
      diff: { code: record.code, fileId: row.id, fileName, mimeType: type, sizeBytes: file.buffer.length },
    });
    return this.custody.get(record.code, caller);
  }

  /** GET /assets/custody/:code/signed/:fileId, for anyone with Assets access who may see the record. */
  async file(code: string, fileId: string, user: SessionUser): Promise<CustodyFile> {
    const record = await this.custody.detail(code, user);
    return this.read(record.id, fileId);
  }

  /** GET /me/custody/:code/files/:fileId: the person's own signed form (owner, 21 October 2026: "Yes, My custody"). */
  async myFile(code: string, fileId: string, user: SessionUser): Promise<CustodyFile> {
    const self = await this.confidential.selfId(user);
    const normal = normalCustodyCode(code);
    const record = self && isCustodyCode(normal) ? await this.prisma.custodyRecord.findUnique({ where: { code: normal }, select: { id: true, employeeId: true } }) : null;
    if (!record || record.employeeId !== self) throw new NotFoundException(CUSTODY_NOT_FOUND);
    return this.read(record.id, fileId);
  }

  private async read(custodyId: string, fileId: string): Promise<CustodyFile> {
    const row = await this.prisma.custodyFile.findFirst({ where: { id: fileId, custodyId }, select: { data: true, mimeType: true, fileName: true } });
    if (!row) throw new NotFoundException(FILE_NOT_FOUND);
    return { data: Buffer.from(row.data.buffer, row.data.byteOffset, row.data.byteLength), type: row.mimeType, fileName: row.fileName };
  }
}
