import { BadGatewayException, BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { RESTRICTED_PAPERWORK, type PaperworkKind } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NORMALIZE_FROM, NORMALIZE_TO, normalizeArabic, snippet } from './arabic-text.js';
import { readIdCardWithNotes, type CardLine } from './egyptian-id.js';
import { CorrectionsService } from './corrections.service.js';
import { assignSides } from './id-card-sides.js';
import { OcrClient, type OcrPageRead, type OcrRead } from './ocr.client.js';
import { detectPaperworkType, PAPERWORK_MAX_BYTES, PAPERWORK_MAX_MB, safeFileName, type PaperworkType } from './paperwork-file.js';

const ENTITY = 'paperwork';
const SEARCH_LIMIT = 50;

/** What lists show: never the file or its text. */
const ITEM = {
  id: true,
  kind: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  ocrStatus: true,
  uploadedAt: true,
  uploadedBy: { select: { email: true } },
} satisfies Prisma.PaperworkItemSelect;

/** Why an ID card could not be read: the OCR service is not running (503), or it failed (502). */
interface CardUnread {
  unavailable: string;
  failed: string;
}

const SCAN_UNREAD: CardUnread = {
  unavailable: 'Reading ID cards is not available right now: the OCR service is not running. The photos were saved in the employee file.',
  failed: 'The OCR service could not read the ID card. The photos were saved in the employee file.',
};
// A new employee starts from a clean scan of their card, so there is no filling in by hand (owner's rule).
const NEW_EMPLOYEE_UNREAD: CardUnread = {
  unavailable: 'Reading ID cards is not available right now: the OCR service is not running. Try again in a few minutes.',
  failed: 'The OCR service could not read the ID card. Try again, or use a clearer scan.',
};
const PREPARE_UNREAD: CardUnread = {
  unavailable: 'Finding the card on the scan is not available right now: the OCR service is not running. Try again in a few minutes.',
  failed: 'The OCR service could not process the scan. Try again, or use a clearer scan.',
};

interface Upload {
  data: Buffer;
  type: PaperworkType;
  fileName: string;
}

/** The photos of a national ID card as uploaded: the front is needed, the back is optional. */
export type IdCardFiles = { front?: Express.Multer.File[]; back?: Express.Multer.File[] } | undefined;

/** National ID scans are restricted like the national ID itself. */
const isRestricted = (kind: string) => (RESTRICTED_PAPERWORK as readonly string[]).includes(kind);

/** The uploaded file, checked by its content. */
function checked(file: Express.Multer.File | undefined, missing: string, what = 'The file'): Upload {
  if (!file?.buffer?.length) throw new BadRequestException(missing);
  if (file.size > PAPERWORK_MAX_BYTES) throw new BadRequestException(`${what} must be ${PAPERWORK_MAX_MB} MB or smaller.`);
  const type = detectPaperworkType(file.buffer);
  if (!type) throw new BadRequestException(`${what} must be a JPEG, PNG or WebP image, or a PDF.`);
  return { data: file.buffer, type, fileName: safeFileName(file.originalname, type) };
}

/** Both sides of an ID card, each a photo or a PDF scan, checked by their content; the back may be missing. */
function cardSides(files: IdCardFiles): { front: Upload; back: Upload | null } {
  const front = checked(files?.front?.[0], 'Choose a photo or PDF scan of the front of the ID card.', 'The front of the card');
  const back = files?.back?.[0] ? checked(files.back[0], 'The file for the back of the card is empty.', 'The back of the card') : null;
  return { front, back };
}

/** A PDF scan with both sides of the card and no separate back: page 1 is the front, the next pages the back. */
function splitSides(front: OcrRead, back: OcrRead | null): [OcrRead, OcrRead | null] {
  if (back || front.status !== 'done' || front.pages.length < 2) return [front, back];
  const [first, ...rest] = front.pages;
  const page = (pages: OcrPageRead[]): OcrRead => {
    const lines = pages.flatMap((p) => p.lines.map((l) => l.text));
    return { status: 'done', text: lines.join('\n'), lines, pages };
  };
  return [page([first]), page(rest)];
}

/**
 * The lines of a side, each marked when the top or bottom edge of its picture runs through it (a scan cut a little
 * short). Without the page's size, nothing is marked.
 */
function cardLines(read: OcrRead | null): CardLine[] | null {
  if (read?.status !== 'done') return null;
  return read.pages.flatMap((page) => {
    const tolerance = page.height ? Math.max(1, page.height * 0.001) : 0;
    return page.lines.map((l) => ({
      text: l.text,
      cut: page.height !== undefined && (l.box[1] <= tolerance || l.box[3] >= page.height - tolerance),
    }));
  });
}

/**
 * What the card says (see egyptian-id.ts) and the text read from each side (null when that side could not be read).
 * When neither side could be read, says why: 503 when the OCR service is not running, 502 when it failed.
 */
function readCard(read: OcrRead, readBack: OcrRead | null, unread: CardUnread) {
  const [front, back] = splitSides(read, readBack);
  const reads = back ? [front, back] : [front];
  if (!reads.some((r) => r.status === 'done')) {
    throw reads.some((r) => r.status === 'unavailable') ? new ServiceUnavailableException(unread.unavailable) : new BadGatewayException(unread.failed);
  }
  const textOf = (r: OcrRead | null) => (r?.status === 'done' ? r.text : null);
  const { suggestions, notes } = readIdCardWithNotes(cardLines(front), cardLines(back));
  return { suggestions, notes, frontText: textOf(front), backText: textOf(back) };
}

/** What is stored after reading: the text, or why there is none. PostgreSQL text cannot hold NUL characters. */
function ocrColumns(read: OcrRead) {
  return read.status === 'done'
    ? { ocrStatus: 'done', ocrText: read.text.replaceAll('\u0000', ''), ocrAt: new Date() }
    : { ocrStatus: read.status, ocrText: null, ocrAt: null };
}

@Injectable()
export class PaperworkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ocr: OcrClient,
    private readonly corrections: CorrectionsService,
  ) {}

  /** The employee file, newest first. */
  async list(employeeId: string) {
    await this.assertEmployee(employeeId);
    return this.prisma.paperworkItem.findMany({
      where: { employeeId },
      select: ITEM,
      orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
    });
  }

  /** Stores the file, then reads its text (Arabic, every page) right away. */
  async upload(employeeId: string, kind: PaperworkKind, file: Express.Multer.File | undefined, user: SessionUser) {
    await this.assertEmployee(employeeId);
    const upload = checked(file, 'Choose a file to upload.');
    const id = await this.store(employeeId, kind, upload, user);
    await this.read(id, upload);
    return this.prisma.paperworkItem.findUniqueOrThrow({ where: { id }, select: ITEM });
  }

  /** The file itself. Every view of a national ID scan is written to the audit log. */
  async file(itemId: string, user: SessionUser) {
    const item = await this.prisma.paperworkItem.findUnique({
      where: { id: itemId },
      select: { id: true, employeeId: true, kind: true, fileName: true, mimeType: true, data: true },
    });
    if (!item) throw new NotFoundException('Document not found.');
    await this.viewed(item, user, ['file']);
    return { data: Buffer.from(item.data.buffer, item.data.byteOffset, item.data.byteLength), type: item.mimeType, fileName: item.fileName };
  }

  /** The text read from the file. Audited like the file for national ID scans. */
  async text(itemId: string, user: SessionUser) {
    const item = await this.prisma.paperworkItem.findUnique({
      where: { id: itemId },
      select: { id: true, employeeId: true, kind: true, ocrStatus: true, ocrText: true },
    });
    if (!item) throw new NotFoundException('Document not found.');
    await this.viewed(item, user, ['ocrText']);
    return { ocrStatus: item.ocrStatus, ocrText: item.ocrText };
  }

  /** Reads the text again, e.g. after the OCR service was down. Text read earlier is never lost to a failed read. */
  async reread(itemId: string, user: SessionUser) {
    const item = await this.prisma.paperworkItem.findUnique({
      where: { id: itemId },
      select: { id: true, employeeId: true, mimeType: true, data: true, ocrStatus: true, ocrText: true },
    });
    if (!item) throw new NotFoundException('Document not found.');
    const read = await this.ocr.read(Buffer.from(item.data), item.mimeType as PaperworkType, 'ar');
    if (read.status !== 'done' && item.ocrText !== null) {
      throw read.status === 'unavailable'
        ? new ServiceUnavailableException('The OCR service is not running. The text read earlier is kept.')
        : new BadGatewayException('The OCR service could not read the document. The text read earlier is kept.');
    }
    const updated = await this.prisma.paperworkItem.update({ where: { id: itemId }, data: ocrColumns(read), select: ITEM });
    await this.audit.record({
      userId: user.id,
      action: 'update',
      entityType: ENTITY,
      entityId: itemId,
      diff: { employeeId: item.employeeId, ocrStatus: { from: item.ocrStatus, to: updated.ocrStatus } },
    });
    return updated;
  }

  async remove(itemId: string, user: SessionUser) {
    const item = await this.prisma.paperworkItem.findUnique({
      where: { id: itemId },
      select: { employeeId: true, kind: true, fileName: true, sizeBytes: true },
    });
    if (!item) throw new NotFoundException('Document not found.');
    await this.prisma.paperworkItem.delete({ where: { id: itemId } });
    await this.audit.record({ userId: user.id, action: 'delete', entityType: ENTITY, entityId: itemId, diff: item });
  }

  /**
   * Documents whose text contains `q`, newest first, with the words around it. The query and the stored text are
   * made uniform the same way (see arabic-text.ts), so أ/إ/ا, ة/ه, ى/ي, tatweel, diacritics and the form of the
   * digits make no difference. National ID scans are left out: what they say is already in the national ID fields,
   * and showing their text would be a restricted view (owner's decision, 14 October 2026).
   */
  async search(q: string) {
    const needle = normalizeArabic(q);
    if (Array.from(needle).length < 2) throw new BadRequestException('Type at least 2 characters to search.');
    const pattern = `%${needle.replace(/[\\%_]/g, '\\$&')}%`;
    const hits = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM paperwork_items
      WHERE ocr_text IS NOT NULL
        AND kind <> ALL(${[...RESTRICTED_PAPERWORK]}::text[])
        AND regexp_replace(translate(ocr_text, ${NORMALIZE_FROM}, ${NORMALIZE_TO}), '[[:space:]]+', ' ', 'g') ILIKE ${pattern}
      ORDER BY uploaded_at DESC, id
      LIMIT ${SEARCH_LIMIT}`;
    if (!hits.length) return [];

    const rows = await this.prisma.paperworkItem.findMany({
      where: { id: { in: hits.map((h) => h.id) } },
      select: { ...ITEM, ocrText: true, employee: { select: { id: true, employeeCode: true, fullNameEn: true } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const results = [];
    for (const { id } of hits) {
      const row = byId.get(id);
      if (!row) continue; // deleted in the meantime
      const { ocrText, employee, ...item } = row;
      results.push({ item, employee, snippet: snippet(ocrText ?? '', needle) });
    }
    return results;
  }

  /**
   * Reads a national ID card: keeps the photos in the employee file (national_id_front and national_id_back), reads
   * them, and returns what they say as suggestions. Nothing about the employee changes here: HR checks the
   * suggestions against the card and saves them through the profile and identity forms.
   */
  async scanIdentity(employeeId: string, files: IdCardFiles, user: SessionUser) {
    await this.assertEmployee(employeeId);
    const { front, back } = cardSides(files);

    const frontId = await this.store(employeeId, 'national_id_front', front, user);
    const backId = back ? await this.store(employeeId, 'national_id_back', back, user) : null;
    const [frontRead, backRead] = await Promise.all([
      this.read(frontId, front),
      back && backId ? this.read(backId, back) : Promise.resolve(null),
    ]);

    const card = readCard(frontRead, backRead, SCAN_UNREAD);
    const { suggestions, corrected } = await this.corrections.apply(card.suggestions);
    return {
      suggestions,
      corrected,
      notes: card.notes,
      front: { itemId: frontId, text: card.frontText },
      // the back: its own file, or page 2 on of a PDF that holds both sides
      ...((backId || card.backText !== null) && { back: { itemId: backId ?? frontId, text: card.backText } }),
    };
  }

  /**
   * Reads the national ID card of someone who is not an employee yet, to start their profile from it: the photos are
   * read as for scanIdentity, but nothing is stored and nothing from the card is written to the audit log. HR checks
   * the suggestions, adds the employee, then uploads the photos to the new employee file.
   */
  async readNewIdCard(files: IdCardFiles) {
    const { front, back } = cardSides(files);
    const [frontRead, backRead] = await Promise.all([
      this.ocr.read(front.data, front.type, 'ar'),
      back ? this.ocr.read(back.data, back.type, 'ar') : Promise.resolve(null),
    ]);

    const card = readCard(frontRead, backRead, NEW_EMPLOYEE_UNREAD);
    const { suggestions, corrected } = await this.corrections.apply(card.suggestions);
    return {
      suggestions,
      corrected,
      notes: card.notes,
      front: { text: card.frontText },
      ...((back || card.backText !== null) && { back: { text: card.backText } }),
    };
  }

  /**
   * Finds the national ID card on one or two uploaded scans or photos (often one page holding both sides): each card
   * cut out, straightened and upright, which one is the front and which the back, and the pages themselves, so HR
   * can frame a card by hand. Nothing is stored and nothing from the card is written to the audit log; the cut-out
   * cards are then sent to be read (readNewIdCard / scanIdentity).
   */
  async prepareIdCard(files: IdCardFiles) {
    const { front, back } = cardSides(files);
    const uploads = back ? [front, back] : [front];
    const results = await Promise.all(uploads.map((u) => this.ocr.cards(u.data, u.type)));
    if (results.some((r) => r.status !== 'done')) {
      throw results.some((r) => r.status === 'unavailable')
        ? new ServiceUnavailableException(PREPARE_UNREAD.unavailable)
        : new BadGatewayException(PREPARE_UNREAD.failed);
    }

    const pages: { width: number; height: number; image: string }[] = [];
    const cards: { page: number; box: { cx: number; cy: number; w: number; h: number; angle: number }; image: string; side: 'front' | 'back' | null; confidence: number; file: number }[] = [];
    results.forEach((r, file) => {
      if (r.status !== 'done') return;
      const offset = pages.length;
      pages.push(...r.pages);
      cards.push(...r.cards.map((c) => ({ ...c, page: c.page + offset, file })));
    });
    const [frontCard, backCard] = assignSides(cards, uploads.length);
    const side = (c: (typeof cards)[number] | null) => c && { image: c.image, page: c.page, box: c.box, recognised: c.side, confidence: c.confidence };
    return { pages, front: side(frontCard), back: side(backCard), found: cards.length };
  }

  // ---------- helpers ----------

  private async assertEmployee(id: string) {
    const exists = await this.prisma.employee.count({ where: { id } });
    if (!exists) throw new NotFoundException('Employee not found.');
  }

  /** Saves the file (text not read yet) and logs the upload: kind, name and size, never the contents. */
  private async store(employeeId: string, kind: PaperworkKind, upload: Upload, user: SessionUser): Promise<string> {
    const { fileName, type, data } = upload;
    const { id } = await this.prisma.paperworkItem.create({
      data: { employeeId, kind, fileName, mimeType: type, sizeBytes: data.length, data: new Uint8Array(data), uploadedById: user.id },
      select: { id: true },
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: ENTITY,
      entityId: id,
      diff: { employeeId, kind, fileName, sizeBytes: data.length },
    });
    return id;
  }

  /** Reads the text of a stored file (in Arabic: every kind of paperwork here is Arabic) and keeps it. */
  private async read(id: string, upload: Upload): Promise<OcrRead> {
    const read = await this.ocr.read(upload.data, upload.type, 'ar');
    await this.prisma.paperworkItem.update({ where: { id }, data: ocrColumns(read) });
    return read;
  }

  /** National ID scans are restricted: every view of the file or its text is written to the audit log. */
  private async viewed(item: { id: string; employeeId: string; kind: string }, user: SessionUser, fields: string[]) {
    if (!isRestricted(item.kind)) return;
    await this.audit.record({
      userId: user.id,
      action: 'view_restricted',
      entityType: ENTITY,
      entityId: item.id,
      diff: { employeeId: item.employeeId, kind: item.kind, fields },
    });
  }
}
