import { PAPERWORK_KINDS, type PaperworkKind } from '@trendlix/shared';
import type { FormState, IdCardPrepared, IdCardReading, IdCardScan, LearnedField, OcrStatus } from '@/lib/types';

// The employee file (scanned paperwork, spec §8.5), shared by the profile card, the upload and ID card forms and
// their actions. Which scans a file needs comes from requiredPaperwork in @trendlix/shared.

/** The API takes files up to 10 MB; checked here too, so HR hears it before a long upload. */
export const PAPERWORK_MAX_BYTES = 10 * 1024 * 1024;
export const TOO_LARGE = 'Each file must be 10 MB or smaller.';

/**
 * Uploads pass through the web app on Vercel, which accepts at most 4.5 MB per request. Photos are made smaller in the
 * browser first (shrink-photo.ts), so this only limits PDFs, which are sent as they are.
 */
export const PDF_MAX_BYTES = 4 * 1024 * 1024;
export const PDF_TOO_LARGE = 'A PDF must be 4 MB or smaller. Scan it again at a lower resolution (150–200 dpi is enough), or upload photos of the pages instead.';

// Listing the types (not image/*) makes an iPhone hand over a JPEG instead of a HEIC photo.
export const PAPERWORK_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export function isPaperworkKind(value: string): value is PaperworkKind {
  return (PAPERWORK_KINDS as readonly string[]).includes(value);
}

/** Said quietly next to each file: whether its text was read (which makes it searchable). */
export const OCR_LABEL: Record<OcrStatus, string> = {
  done: 'Text read',
  pending: 'Text not read yet',
  failed: 'Text not read yet',
  unavailable: 'Text not read yet',
};

/** Where the browser opens a file: the web server fetches it from the API with the session (app/paperwork/[itemId]). */
export function paperworkHref(itemId: string): string {
  return `/paperwork/${itemId}`;
}

/** The document viewer's title for an ID scan: "ID Scan, Front and Back · <name>", or the one side there is. */
export function idScanTitle(sides: { front: boolean; back: boolean }, name?: string): string {
  const what = sides.front && sides.back ? 'Front and Back' : sides.front ? 'Front' : 'Back';
  return `ID Scan, ${what}${name ? ` · ${name}` : ''}`;
}

/** 812 → "812 B", 245 760 → "240 KB", 1 258 291 → "1.2 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** On a file field's change: a photo over 10 MB or a PDF over 4 MB is refused by the browser before anything is sent. */
export function limitFileSize(e: React.ChangeEvent<HTMLInputElement>) {
  const files = [...(e.currentTarget.files ?? [])];
  const message = files.some((f) => f.type === 'application/pdf' && f.size > PDF_MAX_BYTES)
    ? PDF_TOO_LARGE
    : files.some((f) => f.size > PAPERWORK_MAX_BYTES)
      ? TOO_LARGE
      : '';
  e.currentTarget.setCustomValidity(message);
}

/** What reading an employee's ID card gives the National ID page: what the card says, or why it was not read. */
export type IdScanState = FormState & { scan?: IdCardScan };

/** What reading a new employee's ID card gives the Add employee page: what the card says, or why it was not read. */
export type IdReadState = FormState & { reading?: IdCardReading };

/** What looking for the card on the chosen scans gives (POST /id-card/prepare), or why it could not be done. */
export type IdPrepareState = FormState & { prepared?: IdCardPrepared };

/**
 * Both scans of an ID card go in one upload, which Vercel limits to 4.5 MB: together they must stay under this. Photos
 * are made smaller first (shrink-photo.ts), so this only stops two large PDFs, or a large PDF and a photo.
 */
export const SCANS_MAX_BYTES = PDF_MAX_BYTES;
export const SCANS_TOO_LARGE =
  'Together the two files are too large to send: at most 4 MB. Use one file that holds both sides, or scan again at a lower resolution (150–200 dpi is enough).';

/**
 * The fields whose corrections the card reader learns from (POST /id-card/corrections). What the reading suggested for
 * each travels with the form in a hidden field (`readKey`), never in a URL, so the save can compare it with what HR saved.
 */
export const LEARNED_FIELDS: readonly LearnedField[] = ['fullNameAr', 'addressAr', 'issuingOffice'];
export const readKey = (field: LearnedField) => `read_${field}`;
