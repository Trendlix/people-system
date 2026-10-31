import { BadRequestException } from '@nestjs/common';
import { detectLogoType, type LogoType } from '../company/logo-type.js';
import { PAPERWORK_MAX_BYTES, PAPERWORK_MAX_MB, safeFileName } from '../paperwork/paperwork-file.js';

// The photo an employee sends HR of themself (owner, 31 October 2026: "allow them to upload a new photo as a request and
// approved from the HR"), checked as the employee file's papers are: by its content, never the browser's type or the
// name, and no larger than a paper. Only a picture: a JPEG, PNG or WebP image (what the picture beside the name can be:
// paperwork photo-crop.ts PHOTO_PAPER), never a PDF.

export interface SentPhoto {
  data: Buffer;
  type: LogoType;
  fileName: string;
}

export const NO_PHOTO = 'Choose a photo of yourself to send.';
export const NOT_A_PHOTO = 'The photo must be a JPEG, PNG or WebP image.';
export const PHOTO_TOO_LARGE = `The photo must be ${PAPERWORK_MAX_MB} MB or smaller.`;

/** The uploaded photo, checked by its content and size, its name made safe; a 400 in words otherwise. */
export function sentPhoto(file: Pick<Express.Multer.File, 'buffer' | 'size' | 'originalname'> | undefined): SentPhoto {
  if (!file?.buffer?.length) throw new BadRequestException(NO_PHOTO);
  if (Math.max(file.size ?? 0, file.buffer.length) > PAPERWORK_MAX_BYTES) throw new BadRequestException(PHOTO_TOO_LARGE);
  const type = detectLogoType(file.buffer);
  if (!type) throw new BadRequestException(NOT_A_PHOTO);
  return { data: file.buffer, type, fileName: safeFileName(file.originalname, type) };
}
