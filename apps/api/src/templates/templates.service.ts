import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TEMPLATE_SLOTS, type TemplateLanguage, type TemplateSlot } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { shownDate, todayInCairo } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PAPERWORK_MAX_BYTES, PAPERWORK_MAX_MB } from '../paperwork/paperwork-file.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DOCX_MIME, DocxError, readDocx, type TagReading } from './docx-tags.js';
import { FIELDS_GUIDE_FILE_NAME, fieldsGuideDocx } from './fields-guide.js';
import { templateFileName } from './template-file.js';
import type { UploadTemplateDto } from './templates.dto.js';
import { slotView, VERSION, versionView, type VersionRow } from './views.js';

const ENTITY = 'template_version';
const LANGUAGE_NAMES: Record<TemplateLanguage, string> = { ar: 'Arabic', en: 'English', bilingual: 'Arabic and English' };
const SLOTS = new Map(TEMPLATE_SLOTS.map((s) => [s.key, s]));

/** Whose versions a slot stands on: its own, or its source's for a copy. */
const fileSlot = (slot: TemplateSlot) => slot.copyOf ?? slot.key;

/** One upload or publish per slot at a time, so version numbers and the version in use can't be taken twice. */
async function lockSlot(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('people-system:template'), hashtext(${key}))`;
}

/** Why a version can't be published, in words HR act on; null when it can. */
export function publishProblem(v: Pick<TagReading, 'unknownTags' | 'broken'>): string | null {
  const unknown = v.unknownTags.map((t) => `{{${t}}}`).join(', ');
  const broken = v.broken.join(', ');
  if (!unknown && !broken) return null;
  const parts = [
    unknown && `This version uses tags the system doesn't know: ${unknown}.`,
    broken && `${unknown ? 'It also has' : 'This version has'} tags that aren't written correctly: ${broken}.`,
  ].filter(Boolean);
  return `${parts.join(' ')} Fix them in Word and upload it again.`;
}

// The template library (spec §8; owner's request, 15 October 2026). HR and Admin upload and publish; the CEO views
// and downloads (the controller says who); only a Super Admin deletes, and only a draft. Filling a template in for an
// employee comes next: it takes the published version's file, tags and language.
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every slot, in the library's order, with where it stands. */
  async list() {
    const rows = await this.prisma.templateVersion.findMany({ select: VERSION });
    return TEMPLATE_SLOTS.map((slot) => slotView(slot, rows.filter((r) => r.slotKey === fileSlot(slot))));
  }

  /** A slot with its versions, newest first (a copy has none of its own). */
  async slot(key: string) {
    const slot = this.slotOf(key);
    const rows = await this.prisma.templateVersion.findMany({ where: { slotKey: fileSlot(slot) }, select: VERSION, orderBy: { version: 'desc' } });
    return { ...slotView(slot, rows), versions: slot.copyOf ? [] : rows.map(versionView) };
  }

  /** A new draft version of the slot, with the tags read from the file. */
  async upload(key: string, dto: UploadTemplateDto, file: Express.Multer.File | undefined, user: SessionUser) {
    const slot = this.slotOf(key);
    if (slot.copyOf) throw new BadRequestException(`This copy is printed from ${this.slotOf(slot.copyOf).name}'s file. Upload there.`);
    const language = this.languageOf(slot, dto.language ?? null);
    if (!file?.buffer?.length) throw new BadRequestException('Choose the Word file (.docx) to upload.');
    if (file.size > PAPERWORK_MAX_BYTES) throw new BadRequestException(`The file must be ${PAPERWORK_MAX_MB} MB or smaller.`);
    let reading: TagReading;
    try {
      reading = readDocx(file.buffer);
    } catch (err) {
      if (err instanceof DocxError) throw new BadRequestException(err.message);
      throw err;
    }

    const row = await this.prisma.$transaction(async (tx) => {
      await lockSlot(tx, slot.key);
      const { _max } = await tx.templateVersion.aggregate({ where: { slotKey: slot.key }, _max: { version: true } });
      return tx.templateVersion.create({
        data: {
          slotKey: slot.key,
          version: (_max.version ?? 0) + 1,
          fileName: templateFileName(file.originalname),
          mimeType: DOCX_MIME,
          sizeBytes: file.size,
          data: new Uint8Array(file.buffer),
          language,
          ...reading,
          note: dto.note ?? null,
          uploadedById: user.id,
        },
        select: VERSION,
      });
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: ENTITY,
      entityId: row.id,
      diff: {
        slot: row.slotKey,
        version: row.version,
        fileName: row.fileName,
        language,
        tags: row.tags.length,
        unknownTags: row.unknownTags.length,
        broken: row.broken.length,
      },
    });
    return versionView(row);
  }

  /**
   * A draft becomes the version in use, and the one in use before it is retired (kept, with the documents made from
   * it). Refused while it has unknown or broken tags, and for a draft older than the version in use.
   */
  async publish(id: string, user: SessionUser) {
    const { slotKey } = await this.row(id);
    const { row, retired } = await this.prisma.$transaction(async (tx) => {
      await lockSlot(tx, slotKey);
      const v = await tx.templateVersion.findUniqueOrThrow({ where: { id }, select: VERSION }); // again, under the lock
      if (v.status === 'published') throw new ConflictException(`Version ${v.version} is already in use.`);
      if (v.status !== 'draft') {
        throw new ConflictException(`Version ${v.version} was replaced and can't be used again. Upload the file again to make it a new version.`);
      }
      const problem = publishProblem(v);
      if (problem) throw new BadRequestException(problem);
      const current = await tx.templateVersion.findMany({ where: { slotKey, status: 'published' }, select: { id: true, version: true } });
      const newer = current.find((c) => c.version > v.version);
      if (newer) {
        throw new ConflictException(`Version ${v.version} is older than version ${newer.version}, which is in use. Upload the file again to make it a new version.`);
      }
      await tx.templateVersion.updateMany({ where: { id: { in: current.map((c) => c.id) } }, data: { status: 'retired' } });
      const published = await tx.templateVersion.update({
        where: { id },
        data: { status: 'published', publishedById: user.id, publishedAt: new Date() },
        select: VERSION,
      });
      return { row: published, retired: current };
    });
    await this.audit.record({
      userId: user.id,
      action: 'publish',
      entityType: ENTITY,
      entityId: id,
      diff: { slot: slotKey, version: row.version, status: { from: 'draft', to: 'published' }, retired: retired.map((r) => r.version) },
    });
    for (const r of retired) {
      await this.audit.record({
        userId: user.id,
        action: 'update',
        entityType: ENTITY,
        entityId: r.id,
        diff: { slot: slotKey, version: r.version, status: { from: 'published', to: 'retired' }, replacedBy: row.version },
      });
    }
    return versionView(row);
  }

  /** The Fields Guide as a Word file: every tag and template, from the shared lists, with the company's name and today's date. */
  async fieldsGuide(): Promise<{ data: Buffer; type: string; fileName: string }> {
    const company = await this.prisma.company.findUnique({ where: { id: 1 }, select: { nameEn: true } });
    const data = fieldsGuideDocx({ companyName: company?.nameEn ?? null, date: shownDate(todayInCairo()) });
    return { data, type: DOCX_MIME, fileName: FIELDS_GUIDE_FILE_NAME };
  }

  /** The file as uploaded. */
  async file(id: string): Promise<{ data: Buffer; type: string; fileName: string }> {
    const v = await this.prisma.templateVersion.findUnique({ where: { id }, select: { data: true, mimeType: true, fileName: true } });
    if (!v) throw new NotFoundException('Template version not found.');
    return { data: Buffer.from(v.data), type: v.mimeType, fileName: v.fileName };
  }

  /** A Super Admin deletes a draft; a version that was published is kept with the documents made from it. */
  async remove(id: string, user: SessionUser): Promise<void> {
    assertDeletes(user);
    const v = await this.row(id);
    const { count } = await this.prisma.templateVersion.deleteMany({ where: { id, status: 'draft' } });
    if (!count) {
      const now = await this.row(id); // published since it was read, perhaps
      throw new ConflictException(
        now.status === 'published'
          ? `Version ${now.version} is in use, so it is kept. Only drafts can be deleted.`
          : `Version ${now.version} was in use, so it is kept with the documents made from it. Only drafts can be deleted.`,
      );
    }
    await this.audit.record({
      userId: user.id,
      action: 'delete',
      entityType: ENTITY,
      entityId: id,
      diff: { slot: v.slotKey, version: v.version, fileName: v.fileName },
    });
  }

  // ---------- helpers ----------

  private slotOf(key: string): TemplateSlot {
    const slot = SLOTS.get(key);
    if (!slot) throw new NotFoundException('Template not found.');
    return slot;
  }

  /** The language given, or the slot's; a slot with a language takes no other. */
  private languageOf(slot: TemplateSlot, given: TemplateLanguage | null): TemplateLanguage {
    if (!slot.language) {
      if (!given) throw new BadRequestException('Choose the language of the template: Arabic or English.');
      return given;
    }
    if (given && given !== slot.language) throw new BadRequestException(`${slot.name} is always in ${LANGUAGE_NAMES[slot.language]}.`);
    return slot.language;
  }

  private async row(id: string): Promise<VersionRow> {
    const v = await this.prisma.templateVersion.findUnique({ where: { id }, select: VERSION });
    if (!v) throw new NotFoundException('Template version not found.');
    return v;
  }
}
