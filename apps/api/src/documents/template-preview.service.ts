import { ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import type { TemplateSlot } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PdfService } from '../pdf/pdf.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DOCX_MIME } from '../templates/docx-tags.js';
import { templateFileName, type FileFormat } from '../templates/template-file.js';
import { DocumentsService } from './documents.service.js';
import { SLOTS } from './offer.js';

// A template version previewed with a real employee's data (owner's request, 15 October 2026: "When previewing a
// template, fetch any demo data already uploaded"): any version, a draft too, filled in for someone already in the
// system, as a PDF to look at (or the Word file), nothing saved. The people to choose from are those whose employment
// type the template is for, those with the most of its tags filled in first; a document the Contracts tab wouldn't
// offer them yet (a resignation request before any ending) is previewed all the same, its empty tags showing as
// "[Label]". The filling is DocumentsService.previewFill, from what generation reads.

/** At most this many people to choose from. */
const PEOPLE_MAX = 50;

/** How many people's values are worked out at once. */
const AT_ONCE = 8;

export const NO_ONE = 'There is no one to preview this template with yet: add an employee first.';

/** Newest first, the current employment (no end date) before all ended ones (as the profile orders them). */
const NEWEST_FIRST = [{ endDate: { sort: 'desc', nulls: 'first' } }, { joinDate: 'desc' }] satisfies Prisma.EmploymentOrderByWithRelationInput[];

const VERSION = { id: true, slotKey: true, version: true, language: true, tags: true } satisfies Prisma.TemplateVersionSelect;
type VersionRow = Prisma.TemplateVersionGetPayload<{ select: typeof VERSION }>;

/** Someone to preview a version with, and how many of the tags it prints have a value for them. */
export interface PreviewPerson {
  id: string;
  employeeCode: string;
  fullNameEn: string;
  /** Their current employment's type, else their latest's. */
  employmentType: string | null;
  filled: number;
  total: number;
}

/** The most tags filled in first, then by name. */
export function bestFirst(a: PreviewPerson, b: PreviewPerson): number {
  return b.filled - a.filled || a.fullNameEn.localeCompare(b.fullNameEn) || a.employeeCode.localeCompare(b.employeeCode);
}

/** `fn` for each item, `limit` at a time, the results in the items' order. */
async function inTurns<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

@Injectable()
export class TemplatePreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly pdf: PdfService,
    private readonly audit: AuditService,
  ) {}

  /** Up to 50 people to preview the version with, best first. */
  async people(versionId: string, user: SessionUser): Promise<PreviewPerson[]> {
    const { version, slot } = await this.version(versionId);
    return this.ranked(version, slot, user);
  }

  /**
   * The version filled in for the employee (else the best person to preview it with), as a PDF to show (409 without a
   * PDF converter) or the Word file. Restricted data printed is a view of it, written to the audit log.
   */
  async file(versionId: string, employeeId: string | undefined, format: FileFormat, user: SessionUser) {
    const { version, slot } = await this.version(versionId);
    const id = employeeId ?? (await this.ranked(version, slot, user))[0]?.id;
    if (!id) throw new ConflictException(NO_ONE);

    const { data } = await this.prisma.templateVersion.findUniqueOrThrow({ where: { id: versionId }, select: { data: true } });
    const filled = await this.documents.previewFill(id, slot.key, { language: version.language, tags: version.tags, data }, user);
    const docx = { data: filled.data!, type: DOCX_MIME, fileName: templateFileName(`${slot.name} v${version.version} - preview - ${filled.employee.fullNameEn}.docx`) };
    const file = format === 'pdf' ? await this.pdf.preview(docx) : docx;
    if (filled.shown.length) {
      await this.audit.record({
        userId: user.id,
        action: 'view_restricted',
        entityType: 'template_version',
        entityId: version.id,
        diff: { employeeId: id, slot: slot.key, version: version.version, fields: filled.shown, seen: 'preview' },
      });
    }
    return { ...file, employeeId: id };
  }

  // ---------- helpers ----------

  private async version(id: string): Promise<{ version: VersionRow; slot: TemplateSlot }> {
    const version = await this.prisma.templateVersion.findUnique({ where: { id }, select: VERSION });
    const slot = version && SLOTS.get(version.slotKey);
    if (!version || !slot) throw new NotFoundException('Template version not found.');
    return { version, slot };
  }

  /** Everyone whose current employment (else latest) is of a type the template is for, best first, at most 50. */
  private async ranked(version: VersionRow, slot: TemplateSlot, user: SessionUser): Promise<PreviewPerson[]> {
    const employees = await this.prisma.employee.findMany({
      where: { employments: { some: {} } },
      select: { id: true, employeeCode: true, fullNameEn: true, employments: { select: { employmentType: true }, orderBy: NEWEST_FIRST, take: 1 } },
    });
    const candidates = employees.filter((e) => e.employments[0] && slot.appliesTo.includes(e.employments[0].employmentType));
    const people = await inTurns(candidates, AT_ONCE, async (e): Promise<PreviewPerson | null> => {
      try {
        const { filled, total } = await this.documents.previewFill(e.id, slot.key, { language: version.language, tags: version.tags }, user);
        return { id: e.id, employeeCode: e.employeeCode, fullNameEn: e.fullNameEn, employmentType: e.employments[0]?.employmentType ?? null, filled, total };
      } catch (err) {
        if (err instanceof HttpException) return null; // deleted, or their employment, since the list was read
        throw err;
      }
    });
    return people
      .filter((p): p is PreviewPerson => p !== null)
      .sort(bestFirst)
      .slice(0, PEOPLE_MAX);
  }
}
