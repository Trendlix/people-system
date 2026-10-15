import { BadGatewayException, BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { RESTRICTED_PAPERWORK, type PaperworkKind } from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import { fromDateOnly, toDateOnly } from '../common/date-only.js';
import { assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NORMALIZE_FROM, NORMALIZE_TO, normalizeArabic, snippet } from './arabic-text.js';
import { readIdCardWithNotes, type CardLine } from './egyptian-id.js';
import { CorrectionsService } from './corrections.service.js';
import { assignSides } from './id-card-sides.js';
import { OCR_CARDS_PDF_PAGES, OcrClient, type OcrPage, type OcrPageRead, type OcrRead, type OcrShownPages } from './ocr.client.js';
import { detectPaperworkType, PAPERWORK_MAX_BYTES, PAPERWORK_MAX_MB, replacementName, safeFileName, type PaperworkType } from './paperwork-file.js';
import type { UpdatePaperworkDto, UploadPaperworkDto } from './paperwork.dto.js';
import { countPdfPages } from './pdf-pages.js';
import { photoSize } from './photo-size.js';

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
  documentNo: true,
  expiresOn: true,
} satisfies Prisma.PaperworkItemSelect;

/** A paper as the API sends it: its expiry date as YYYY-MM-DD. */
function itemView<T extends { expiresOn: Date | null }>(item: T) {
  return { ...item, expiresOn: fromDateOnly(item.expiresOn) };
}

/** What to say when the OCR service gave nothing: it is not running (503), or it failed (502). */
interface Unread {
  unavailable: string;
  failed: string;
}

const SCAN_UNREAD: Unread = {
  unavailable: 'Reading ID cards is not available right now: the OCR service is not running. The photos were saved in the employee file.',
  failed: 'The OCR service could not read the ID card. The photos were saved in the employee file.',
};
// A new employee starts from a clean scan of their card, so there is no filling in by hand (owner's rule).
const NEW_EMPLOYEE_UNREAD: Unread = {
  unavailable: 'Reading ID cards is not available right now: the OCR service is not running. Try again in a few minutes.',
  failed: 'The OCR service could not read the ID card. Try again, or use a clearer scan.',
};
const PREPARE_UNREAD: Unread = {
  unavailable: 'Finding the card on the scan is not available right now: the OCR service is not running. Try again in a few minutes.',
  failed: 'The OCR service could not process the scan. Try again, or use a clearer scan.',
};
const PDF_PAGES_UNREAD: Unread = {
  unavailable: "PDF pages can't be shown right now; try again in a minute, or upload a photo.",
  failed: "The PDF's pages could not be shown: it may be damaged or protected by a password. Try again, or upload a photo.",
};

/** The 503 or 502 for an OCR call that gave nothing. */
function unread(status: 'failed' | 'unavailable', say: Unread) {
  return status === 'unavailable' ? new ServiceUnavailableException(say.unavailable) : new BadGatewayException(say.failed);
}

/** Pages shown for adjusting at most, as many as the OCR service shows (POST /pages): a longer PDF is refused. */
const ADJUST_MAX_PAGES = 20;

/**
 * The 400 for a PDF with more pages than can be shown: `upTo` at most, which is fewer than ADJUST_MAX_PAGES only while
 * the OCR service is older than POST /pages ("for now").
 */
function tooLong(upTo: number, has: string): BadRequestException {
  const forNow = upTo < ADJUST_MAX_PAGES ? ' for now' : '';
  return new BadRequestException(`Only PDFs of up to ${upTo} pages can be adjusted${forNow}; this one ${has}.`);
}

/** A page as a picture, for adjusting in the browser: base64 JPEG, and its size as shown. */
export interface PreparedPage {
  image: string;
  width: number;
  height: number;
}
const preparedPage = ({ image, width, height }: OcrPage): PreparedPage => ({ image, width, height });

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
 * The lines of a side, each with how sure the reader was and where it lies on the card (as shares of the picture's
 * width), and marked when the top or bottom edge of the picture runs through it (a scan cut a little short). Without
 * the page's size, nothing is marked and no place is known.
 */
function cardLines(read: OcrRead | null): CardLine[] | null {
  if (read?.status !== 'done') return null;
  return read.pages.flatMap((page) => {
    const tolerance = page.height ? Math.max(1, page.height * 0.001) : 0;
    return page.lines.map((l) => ({
      text: l.text,
      cut: page.height !== undefined && (l.box[1] <= tolerance || l.box[3] >= page.height - tolerance),
      ...(l.confidence !== undefined && { confidence: l.confidence }),
      ...(page.width && { left: l.box[0] / page.width, right: l.box[2] / page.width }),
    }));
  });
}

/**
 * What the card says (see egyptian-id.ts) and the text read from each side (null when that side could not be read).
 * When neither side could be read, says why: 503 when the OCR service is not running, 502 when it failed.
 */
function readCard(read: OcrRead, readBack: OcrRead | null, say: Unread) {
  const [front, back] = splitSides(read, readBack);
  const reads = back ? [front, back] : [front];
  if (!reads.some((r) => r.status === 'done')) {
    throw unread(reads.some((r) => r.status === 'unavailable') ? 'unavailable' : 'failed', say);
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
    const items = await this.prisma.paperworkItem.findMany({
      where: { employeeId },
      select: ITEM,
      orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
    });
    return items.map(itemView);
  }

  /** Stores the file with its number and expiry when given, then reads its text (Arabic, every page) right away. */
  async upload(employeeId: string, dto: UploadPaperworkDto, file: Express.Multer.File | undefined, user: SessionUser) {
    await this.assertEmployee(employeeId);
    const upload = checked(file, 'Choose a file to upload.');
    const id = await this.store(employeeId, dto.kind, upload, user, { documentNo: dto.documentNo ?? null, expiresOn: dto.expiresOn ?? null });
    await this.read(id, upload);
    return itemView(await this.prisma.paperworkItem.findUniqueOrThrow({ where: { id }, select: ITEM }));
  }

  /** The number printed on a paper, when it expires, and its kind (put right when it was uploaded under the wrong one). */
  async describe(itemId: string, dto: UpdatePaperworkDto, user: SessionUser) {
    const before = await this.prisma.paperworkItem.findUnique({ where: { id: itemId }, select: { employeeId: true, kind: true, documentNo: true, expiresOn: true } });
    if (!before) throw new NotFoundException('Document not found.');
    const data = {
      documentNo: dto.documentNo,
      expiresOn: dto.expiresOn === undefined ? undefined : dto.expiresOn === null ? null : toDateOnly(dto.expiresOn),
      kind: dto.kind,
    };
    const updated = await this.prisma.paperworkItem.update({ where: { id: itemId }, data, select: ITEM });
    // the number of a national ID scan (before or after) is restricted like the national ID: only that it changed is logged
    const diff: Record<string, unknown> = changes(
      { documentNo: before.documentNo, expiresOn: fromDateOnly(before.expiresOn), kind: before.kind },
      { documentNo: dto.documentNo, expiresOn: dto.expiresOn, kind: dto.kind },
    );
    if ((isRestricted(before.kind) || isRestricted(updated.kind)) && 'documentNo' in diff) diff.documentNo = 'changed';
    if (Object.keys(diff).length) {
      await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, entityId: itemId, diff: { employeeId: before.employeeId, ...diff } });
    }
    return itemView(updated);
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
    const updated = itemView(await this.prisma.paperworkItem.update({ where: { id: itemId }, data: ocrColumns(read), select: ITEM }));
    await this.audit.record({
      userId: user.id,
      action: 'update',
      entityType: ENTITY,
      entityId: itemId,
      diff: { employeeId: item.employeeId, ocrStatus: { from: item.ocrStatus, to: updated.ocrStatus } },
    });
    return updated;
  }

  /** Deletes a stored paper, the national ID's sides too: a Super Admin only (owner's decision, 15 October 2026). */
  async remove(itemId: string, user: SessionUser) {
    assertDeletes(user);
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
      results.push({ item: itemView(item), employee, snippet: snippet(ocrText ?? '', needle) });
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
      throw unread(results.some((r) => r.status === 'unavailable') ? 'unavailable' : 'failed', PREPARE_UNREAD);
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

  /**
   * A photo or a PDF → its pages as pictures, in order, for cropping and adjusting in the browser, which then uploads
   * the result (a JPEG, or a PDF of several pages) as a new paper or in place of a stored one (replaceFile). Nothing is
   * stored and nothing is logged.
   */
  async preparePages(file: Express.Multer.File | undefined): Promise<{ pages: PreparedPage[] }> {
    const upload = checked(file, 'Choose a photo or PDF to adjust.');
    return { pages: upload.type === 'application/pdf' ? await this.pdfPages(upload) : [await this.photoPage(upload)] };
  }

  /**
   * Replaces the file of a stored paper with an adjusted one (cropped, straightened … in the browser). Its kind,
   * employee, number and expiry stay; its name, type and size follow the new file, and its text is read again as for
   * a new upload. Logged with the new name and size, never the contents. National ID scans are replaced by HR, who
   * upload them; replacing one is not a view of it.
   */
  async replaceFile(itemId: string, file: Express.Multer.File | undefined, user: SessionUser) {
    const item = await this.prisma.paperworkItem.findUnique({ where: { id: itemId }, select: { employeeId: true, fileName: true } });
    if (!item) throw new NotFoundException('Document not found.');
    const upload = checked(file, 'Choose the adjusted file to upload.');
    const fileName = replacementName(file?.originalname, item.fileName, upload.type);
    const sizeBytes = upload.data.length;
    await this.prisma.paperworkItem.update({
      where: { id: itemId },
      data: { fileName, mimeType: upload.type, sizeBytes, data: new Uint8Array(upload.data), ocrStatus: 'pending', ocrText: null, ocrAt: null },
    });
    await this.audit.record({
      userId: user.id,
      action: 'update',
      entityType: ENTITY,
      entityId: itemId,
      diff: { employeeId: item.employeeId, file: 'replaced', fileName, sizeBytes },
    });
    await this.read(itemId, { ...upload, fileName });
    return itemView(await this.prisma.paperworkItem.findUniqueOrThrow({ where: { id: itemId }, select: ITEM }));
  }

  // ---------- helpers ----------

  /**
   * A photo as one page. A JPEG goes back as it is, at its full size: browsers turn it upright by its EXIF
   * orientation, and the size given is as shown. A PNG or WebP photo goes back as a JPEG made by the OCR service, or,
   * when the service is not running, as it is (browsers show a picture by its content, whatever it is called).
   */
  private async photoPage({ data, type }: Upload): Promise<PreparedPage> {
    const size = photoSize(data, type);
    if (size && type === 'image/jpeg') return { image: data.toString('base64'), ...size };
    let shown: OcrShownPages = await this.ocr.pages(data, type);
    if (shown.status === 'old') shown = await this.ocr.cardPages(data, type);
    if (shown.status === 'done' && shown.pages.length === 1) return preparedPage(shown.pages[0]);
    if (size) return { image: data.toString('base64'), ...size };
    throw new BadRequestException('This photo could not be opened: it may be damaged. Try another file.');
  }

  /**
   * The pages of a PDF, rendered by the OCR service (503 without it), up to ADJUST_MAX_PAGES. Never fewer than the PDF
   * has: the adjusted file replaces the whole document, so a PDF whose pages cannot all be shown is refused. An OCR
   * service older than POST /pages (the API deployed before its image is rebuilt) shows a PDF's first 2 pages, from
   * /cards: until then, a longer PDF is refused.
   */
  private async pdfPages({ data, type }: Upload): Promise<PreparedPage[]> {
    const count = countPdfPages(data);
    if (count !== null && count > ADJUST_MAX_PAGES) throw tooLong(ADJUST_MAX_PAGES, `has ${count}`);
    let upTo = ADJUST_MAX_PAGES;
    let shown: OcrShownPages = await this.ocr.pages(data, type);
    if (shown.status === 'old') {
      upTo = OCR_CARDS_PDF_PAGES;
      if (count !== null && count > upTo) throw tooLong(upTo, `has ${count}`);
      shown = await this.ocr.cardPages(data, type);
    }
    if (shown.status === 'tooLong') throw tooLong(ADJUST_MAX_PAGES, `has ${shown.pages}`);
    if (shown.status !== 'done') throw unread(shown.status, PDF_PAGES_UNREAD);
    const { pages } = shown;
    if (!pages.length || (count !== null && pages.length < count)) throw new BadGatewayException(PDF_PAGES_UNREAD.failed);
    if (pages.length > upTo) throw tooLong(upTo, `has ${pages.length}`);
    // when the page count cannot be told, as many pages as /cards shows at most may be only the first ones
    if (count === null && upTo < ADJUST_MAX_PAGES && pages.length >= upTo) throw tooLong(upTo, 'may have more');
    return pages.map(preparedPage);
  }

  private async assertEmployee(id: string) {
    const exists = await this.prisma.employee.count({ where: { id } });
    if (!exists) throw new NotFoundException('Employee not found.');
  }

  /** Saves the file (text not read yet) and logs the upload: kind, name and size, never the contents. */
  private async store(
    employeeId: string,
    kind: PaperworkKind,
    upload: Upload,
    user: SessionUser,
    about: { documentNo: string | null; expiresOn: string | null } = { documentNo: null, expiresOn: null },
  ): Promise<string> {
    const { fileName, type, data } = upload;
    const { id } = await this.prisma.paperworkItem.create({
      data: {
        employeeId,
        kind,
        fileName,
        mimeType: type,
        sizeBytes: data.length,
        data: new Uint8Array(data),
        uploadedById: user.id,
        documentNo: about.documentNo,
        expiresOn: about.expiresOn ? toDateOnly(about.expiresOn) : null,
      },
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
