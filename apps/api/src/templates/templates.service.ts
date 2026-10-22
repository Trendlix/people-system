import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TEMPLATE_SLOTS, withSlotDigits, type PdfField, type PdfPageSize, type TemplateLanguage, type TemplateSlot } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { assertDeletes, isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { shownDate, todayInCairo } from '../common/date-only.js';
import { fillPdfTemplate, PdfTemplateError, readPdfTemplate } from '../documents/pdf-engine/index.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PAPERWORK_MAX_BYTES, PAPERWORK_MAX_MB } from '../paperwork/paperwork-file.js';
import { isPdf } from '../pdf/pdf-file.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DOCX_MIME, DocxError, readDocx, type TagReading } from './docx-tags.js';
import { FIELDS_GUIDE_FILE_NAME, fieldsGuideDocx } from './fields-guide.js';
import { pdfFieldsProblem, pdfFieldTags, plainPdfFields } from './pdf-fields.js';
import { pdfSample } from './pdf-sample.js';
import { STARTER_LAYOUTS_TOKEN, starterLayoutFor, type StarterLayout } from './starter-layouts.js';
import { formatOf, templateFileName } from './template-file.js';
import type { UploadTemplateDto } from './templates.dto.js';
import { fieldsOf, pagesOf, slotView, VERSION, versionView, type VersionRow } from './views.js';

const ENTITY = 'template_version';
const LANGUAGE_NAMES: Record<TemplateLanguage, string> = { ar: 'Arabic', en: 'English', bilingual: 'Arabic and English' };
const SLOTS = new Map(TEMPLATE_SLOTS.map((s) => [s.key, s]));

/** Whose versions a slot stands on: its own, or its source's for a copy. */
const fileSlot = (slot: TemplateSlot) => slot.copyOf ?? slot.key;

const PDF_MIME = 'application/pdf';
export const PLACE_FIELDS_FIRST = 'Place the fields on the form before publishing it.';
/** The 409 for Use the standard layout on a version whose form the system has no layout for. */
export const NO_STANDARD_LAYOUT = 'There is no standard layout for this form.';
/** Uploading, renaming, placing fields on and publishing a template are for a Super Admin only (owner, 19 October 2026). */
export const ONLY_SUPER_ADMIN_EDITS_TEMPLATES = 'Only a Super Admin uploads, edits or publishes templates.';

/** Called by every service method that changes a template, whichever route reaches it (the guard checks first). */
function assertEditsTemplates(user: SessionUser): void {
  if (!isSuperAdmin(user)) throw new ForbiddenException(ONLY_SUPER_ADMIN_EDITS_TEMPLATES);
}

/** The 409 for placing fields on a Word version: its fields are the tags typed in it. */
const wordVersion = (version: number) =>
  new ConflictException(`Version ${version} is a Word file: its fields are the {{tags}} typed in it. Fields are placed only on a PDF form.`);

/** The 409 for changing the fields of a version that was replaced. */
const replacedVersion = (version: number) =>
  new ConflictException(`Version ${version} was replaced, so its fields can't be changed. Upload the form again to make it a new version.`);

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

// The template library (spec §8; owner's request, 15 October 2026). Only a Super Admin uploads, renames, places the
// fields and publishes (owner, 19 October 2026: "Templates: only a Super Admin edits them"); HR, Admin and the CEO view
// and download (the controller says who); only a Super Admin deletes. Filling a template in for an
// employee comes next: it takes the published version's file, tags and language.
@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STARTER_LAYOUTS_TOKEN) private readonly starterLayouts: readonly StarterLayout[],
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
    assertEditsTemplates(user);
    const slot = this.slotOf(key);
    if (slot.copyOf) throw new BadRequestException(`This copy is printed from ${this.slotOf(slot.copyOf).name}'s file. Upload there.`);
    const language = this.languageOf(slot, dto.language ?? null);
    if (!file?.buffer?.length) throw new BadRequestException('Choose the file to upload: a Word document (.docx) or a PDF form.');
    if (file.size > PAPERWORK_MAX_BYTES) throw new BadRequestException(`The file must be ${PAPERWORK_MAX_MB} MB or smaller.`);
    // a PDF (an official form) or a Word document, by its content
    const pdf = isPdf(file.buffer);
    let content: Pick<Prisma.TemplateVersionCreateInput, 'format' | 'mimeType' | 'pdfPages' | 'pdfFields' | 'tags' | 'unknownTags' | 'broken'>;
    let starter: StarterLayout | null = null;
    if (pdf) {
      let pages: PdfPageSize[];
      try {
        pages = await readPdfTemplate(file.buffer);
      } catch (err) {
        if (err instanceof PdfTemplateError) throw new BadRequestException(err.message);
        throw err;
      }
      // the fields already placed for exactly this file, when the system knows it (starter-layouts.ts)
      starter = this.starterFor(slot.key, file.buffer, pages);
      const fields = starter ? plainPdfFields(starter.fields) : [];
      content = { format: 'pdf', mimeType: PDF_MIME, pdfPages: pages as unknown as Prisma.InputJsonValue, pdfFields: fields as unknown as Prisma.InputJsonValue, tags: pdfFieldTags(fields), unknownTags: [], broken: [] };
    } else {
      let reading: TagReading;
      try {
        reading = readDocx(file.buffer);
      } catch (err) {
        if (err instanceof DocxError) throw new BadRequestException(err.message);
        throw err;
      }
      content = { format: 'docx', mimeType: DOCX_MIME, ...reading };
    }

    const row = await this.prisma.$transaction(async (tx) => {
      await lockSlot(tx, slot.key);
      const { _max } = await tx.templateVersion.aggregate({ where: { slotKey: slot.key }, _max: { version: true } });
      return tx.templateVersion.create({
        data: {
          slotKey: slot.key,
          version: (_max.version ?? 0) + 1,
          fileName: templateFileName(file.originalname, pdf ? 'pdf' : 'docx'),
          sizeBytes: file.size,
          data: new Uint8Array(file.buffer),
          language,
          ...content,
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
        ...(pdf && { format: 'pdf', pages: pagesOf(row).length, fields: fieldsOf(row).length }),
        ...(starter && { starterLayout: starter.note }),
      },
    });
    return versionView(row);
  }

  /**
   * The fields placed on a PDF version, with its pages as shown, for the editor (Templates → a version → Place fields).
   * Editable while it is a draft or in use (a box printed a little off is put right without uploading again; documents
   * made before keep their own file), not once replaced; `standardLayout`: whether the system has a standard layout for
   * its form (see standardLayout). Refused (409) for a Word version.
   */
  async fields(id: string) {
    return this.fieldsView(await this.row(id));
  }

  /**
   * Saves all the fields of a PDF version (owner's decision, 15 October 2026), checked as pdfFieldsProblem says, and the
   * tags it prints worked out again from them. Refused for a Word version and a replaced one (409); a version in use
   * keeps at least one field.
   */
  async saveFields(id: string, sent: readonly PdfField[], user: SessionUser) {
    assertEditsTemplates(user);
    return this.writeFields(id, sent, user);
  }

  /**
   * Use the standard layout (owner, 16 October 2026): the version's fields replaced with the starter layout the system
   * places when its form is uploaded (starter-layouts.ts: the same file, or one with the same pages), so a layout
   * improved since reaches a version already uploaded without uploading it again. Checked and saved as saveFields, and
   * logged with the layout's name. Refused (409) for a Word version or a replaced one, as a save is, and when the system
   * has no standard layout for this form.
   */
  async standardLayout(id: string, user: SessionUser) {
    assertEditsTemplates(user);
    const v = await this.row(id);
    if (formatOf(v.format) !== 'pdf') throw wordVersion(v.version);
    if (v.status === 'retired') throw replacedVersion(v.version);
    const starter = await this.standardFor(v, true);
    if (!starter) throw new ConflictException(NO_STANDARD_LAYOUT);
    return this.writeFields(id, starter.fields, user, starter.note);
  }

  /** Saves the fields of a PDF version (saveFields), and logs the standard layout they are, when they are one. */
  private async writeFields(id: string, sent: readonly PdfField[], user: SessionUser, standardLayout?: string) {
    const { slotKey } = await this.row(id);
    const { before, row, fields } = await this.prisma.$transaction(async (tx) => {
      await lockSlot(tx, slotKey); // not while it is being published
      const v = await tx.templateVersion.findUniqueOrThrow({ where: { id }, select: VERSION });
      if (formatOf(v.format) !== 'pdf') throw wordVersion(v.version);
      if (v.status === 'retired') throw replacedVersion(v.version);
      const problem = pdfFieldsProblem(sent, pagesOf(v));
      if (problem) throw new BadRequestException(problem);
      if (v.status === 'published' && !sent.length) throw new BadRequestException(`Version ${v.version} is in use, so it keeps its fields: place at least one.`);
      const checked = plainPdfFields(sent);
      const saved = await tx.templateVersion.update({
        where: { id },
        data: { pdfFields: checked as unknown as Prisma.InputJsonValue, tags: pdfFieldTags(checked) },
        select: VERSION,
      });
      return { before: v, row: saved, fields: checked };
    });
    await this.audit.record({
      userId: user.id,
      action: 'update',
      entityType: ENTITY,
      entityId: id,
      diff: {
        slot: row.slotKey,
        version: row.version,
        status: row.status,
        fields: { from: fieldsOf(before).length, to: fields.length },
        tags: { from: before.tags.length, to: row.tags.length },
        ...(standardLayout && { standardLayout }),
      },
    });
    return this.fieldsView(row);
  }

  /**
   * The PDF version filled in with made-up values where `fields` (not saved yet, checked as for saving) place them, for
   * HR to see where each prints (pdf-sample.ts). No one's data: given unprotected. Refused (409) for a Word version.
   */
  async sample(id: string, sent: readonly PdfField[]): Promise<{ data: Buffer; fileName: string }> {
    const v = await this.prisma.templateVersion.findUnique({ where: { id }, select: { ...VERSION, data: true } });
    if (!v) throw new NotFoundException('Template version not found.');
    if (formatOf(v.format) !== 'pdf') throw wordVersion(v.version);
    const problem = pdfFieldsProblem(sent, pagesOf(v));
    if (problem) throw new BadRequestException(problem);
    const sample = pdfSample(plainPdfFields(sent), v.language);
    // as the documents print it: a social insurance form's numbers in ٠-٩ (owner, 16 October 2026)
    const data = await fillPdfTemplate(v.data, withSlotDigits(v.slotKey, sample.fields, v.language), sample.values, v.language);
    const name = SLOTS.get(v.slotKey)?.name ?? 'Template';
    return { data, fileName: templateFileName(`${name} v${v.version} - sample.pdf`, 'pdf') };
  }

  /**
   * A draft becomes the version in use, and the one in use before it is retired (kept, with the documents made from
   * it). Refused while it has unknown or broken tags, and for a draft older than the version in use.
   */
  /** Renames a version's file (as uploaded names often aren't telling); cleaned as an upload's name is, ".docx" or ".pdf" kept. */
  async rename(id: string, name: string, user: SessionUser) {
    assertEditsTemplates(user);
    const before = await this.row(id);
    const fileName = templateFileName(name, formatOf(before.format));
    if (fileName === before.fileName) return versionView(before);
    const row = await this.prisma.templateVersion.update({ where: { id }, data: { fileName }, select: VERSION });
    await this.audit.record({
      userId: user.id,
      action: 'update',
      entityType: ENTITY,
      entityId: id,
      diff: { slot: before.slotKey, version: before.version, fileName: { from: before.fileName, to: fileName } },
    });
    return versionView(row);
  }

  async publish(id: string, user: SessionUser) {
    assertEditsTemplates(user);
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
      if (formatOf(v.format) === 'pdf' && !fieldsOf(v).length) throw new BadRequestException(PLACE_FIELDS_FIRST);
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
  /**
   * A Super Admin deletes a version that nothing was made from: a draft, the version in use or one it replaced (owner,
   * 15 October 2026: "I don't want to keep wrong templates"). A version documents or job offers were made from is kept
   * with them: they say which version they came from. Deleting the version in use leaves the template without one
   * until another is published.
   */
  async remove(id: string, user: SessionUser): Promise<void> {
    assertDeletes(user);
    const v = await this.row(id);
    const used = v._count.documents + v._count.offers;
    if (used) throw new ConflictException(usedMessage(v.version, used));
    try {
      await this.prisma.templateVersion.delete({ where: { id } });
    } catch (err) {
      // a document made from it in the meantime: the database keeps the version for it
      const now = await this.prisma.templateVersion.findUnique({ where: { id }, select: VERSION });
      if (now && now._count.documents + now._count.offers) throw new ConflictException(usedMessage(now.version, now._count.documents + now._count.offers));
      throw err;
    }
    await this.audit.record({
      userId: user.id,
      action: 'delete',
      entityType: ENTITY,
      entityId: id,
      diff: { slot: v.slotKey, version: v.version, fileName: v.fileName, status: v.status },
    });
  }

  // ---------- helpers ----------

  /** A PDF version's fields as the editor gets them. */
  private async fieldsView(v: VersionRow) {
    if (formatOf(v.format) !== 'pdf') throw wordVersion(v.version);
    const standardLayout = (await this.standardFor(v)) !== null;
    return { version: versionView(v), pages: pagesOf(v), fields: fieldsOf(v), editable: v.status !== 'retired', standardLayout };
  }

  /**
   * The standard layout of a PDF version's form: the starter layout its file gets on uploading (starterFor). The file
   * is read only for a slot the system has a layout for. `log`: say why a layout that doesn't fit was left out.
   */
  private async standardFor(v: Pick<VersionRow, 'id' | 'slotKey' | 'pdfPages'>, log = false): Promise<StarterLayout | null> {
    if (!this.starterLayouts.some((l) => l.slotKey === v.slotKey)) return null;
    const file = await this.prisma.templateVersion.findUnique({ where: { id: v.id }, select: { data: true } });
    return file ? this.starterFor(v.slotKey, file.data, pagesOf(v), log) : null;
  }

  /** The starter layout for this file in this slot, when there is one that fits its pages (one that doesn't is left out, and logged). */
  private starterFor(slotKey: string, data: Uint8Array, pages: readonly PdfPageSize[], log = true): StarterLayout | null {
    const starter = starterLayoutFor(slotKey, data, pages, this.starterLayouts);
    if (!starter) return null;
    const problem = pdfFieldsProblem(starter.fields, pages);
    if (problem) {
      if (log) this.logger.warn(`The starter layout "${starter.note}" for ${slotKey} was not applied: ${problem}`);
      return null;
    }
    return starter;
  }

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

/** Why a version is kept: what was made from it. */
function usedMessage(version: number, used: number): string {
  return `${used === 1 ? 'A document was' : `${used} documents were`} made from version ${version}, so it is kept with them.`;
}
