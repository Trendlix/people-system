import { createHash } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { isPdf } from '../pdf/pdf-file.js';
import { pdfName, PdfService } from '../pdf/pdf.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// A CV as the CV window shows it (owner, 24 October 2026: "when opening a CV, open it in a popup window"): a PDF as it was
// sent; a Word file converted to a PDF by the PDF service beside the API (Gotenberg, the job offers'), and kept, so the
// next opening is at once: one an application's CV or a general CV's file, made again when the file differs (its
// SHA-256). Without the converter a Word CV isn't shown (409, in words): it is downloaded instead. Who may open it is the
// callers' (the applicant's or the general CV's own rules); a developer never (@NotForDevelopers on the routes).

export const WORD_CV_NOT_SHOWN = "The PDF converter isn't set up on the server, so a Word CV can't be shown here: download it instead.";

export type CvOwner = { applicationId: string } | { generalCvId: string };

@Injectable()
export class CvPreviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
  ) {}

  /** The CV as a PDF to show: as it is when it is one; else its kept conversion, or a new one kept. */
  async pdfOf(owner: CvOwner, file: { data: Buffer; fileName: string; mimeType: string }): Promise<{ data: Buffer; fileName: string }> {
    if (isPdf(file.data)) return { data: file.data, fileName: file.fileName };
    const sha256 = createHash('sha256').update(file.data).digest('hex');
    const kept = await this.prisma.cvPreview.findUnique({ where: owner, select: { sha256: true, data: true } });
    if (kept && kept.sha256 === sha256) return { data: Buffer.from(kept.data), fileName: pdfName(file.fileName) };
    if (!this.pdf.available) throw new ConflictException(WORD_CV_NOT_SHOWN);
    // refused (503) when the converter doesn't answer or fails: tried again at the next opening
    const made = await this.pdf.fromDocx(file.data, file.fileName);
    if (!made) throw new ConflictException(WORD_CV_NOT_SHOWN);
    const data = new Uint8Array(made);
    await this.prisma.cvPreview.upsert({ where: owner, create: { ...owner, sha256, data }, update: { sha256, data, createdAt: new Date() } });
    return { data: made, fileName: pdfName(file.fileName) };
  }
}
