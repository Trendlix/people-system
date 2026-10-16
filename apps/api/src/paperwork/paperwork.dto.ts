import { PAPERWORK_KINDS, PHOTO_CROP_MIN, type PaperworkKind, type PhotoCrop } from '@trendlix/shared';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDefined, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateBy, ValidateIf, ValidateNested } from 'class-validator';
import { IsDateOnly } from '../common/date-only.js';
import { Trim, TrimOrNull } from '../common/transforms.js';
import { LEARNED_FIELDS, type LearnedField } from './corrections.js';

/** A paper's number and expiry, both optional: an empty value clears it. */
class PaperDetailsDto {
  /** The number printed on the paper, if any. */
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(60)
  documentNo?: string | null;

  /** When the paper stops being valid (e.g. a criminal record certificate), if it does. */
  @TrimOrNull() @IsOptional() @IsDateOnly('Enter the expiry date as a real date.')
  expiresOn?: string | null;
}

/** The form fields sent with an uploaded file. */
export class UploadPaperworkDto extends PaperDetailsDto {
  @Trim()
  @IsIn(PAPERWORK_KINDS, { message: 'Choose what kind of document this is.' })
  kind: PaperworkKind;
}

/**
 * Changing a stored paper's number, expiry or kind: a paper uploaded under the wrong kind is put right without deleting
 * it (owner, 16 October 2026).
 */
export class UpdatePaperworkDto extends PaperDetailsDto {
  @Trim()
  @IsOptional()
  @IsIn(PAPERWORK_KINDS, { message: 'Choose what kind of document this is.' })
  kind?: PaperworkKind;
}

const isFraction = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * A fraction of the photo, from 0 to 1, and at least `min`: one message for a value, whatever is wrong with it (the
 * same words as photoCropProblem in packages/shared, which checks the crop as a whole).
 */
const IsFraction = (min = 0) =>
  ValidateBy({
    name: 'isFraction',
    validator: {
      validate: (v: unknown) => isFraction(v) && v >= min,
      defaultMessage: (args) =>
        isFraction(args?.value) ? 'The crop is too small: zoom out a little.' : 'The crop must be given as fractions of the photo, from 0 to 1.',
    },
  });

/** The square of a personal photo shown in the circle beside the name, as fractions of the photo as shown (PhotoCrop). */
class PhotoCropDto implements PhotoCrop {
  @IsFraction()
  x: number;

  @IsFraction()
  y: number;

  @IsFraction(PHOTO_CROP_MIN)
  w: number;

  @IsFraction(PHOTO_CROP_MIN)
  h: number;
}

const SEND_CROP = 'Send the square of the photo to show, or null for the whole photo.';

/**
 * The crop of the picture beside the name: the square to show, or null for the whole photo, centred. Sent as `{ crop }`
 * since a request body is an object: a bare null is not taken.
 */
export class SetPhotoCropDto {
  @ValidateIf((o: SetPhotoCropDto) => o.crop !== null)
  @IsDefined({ message: SEND_CROP })
  @ValidateNested({ message: SEND_CROP })
  @Type(() => PhotoCropDto)
  crop: PhotoCropDto | null;
}

export class SearchPaperworkDto {
  @Trim()
  @IsString({ message: 'Type at least 2 characters to search.' })
  @MinLength(2, { message: 'Type at least 2 characters to search.' })
  @MaxLength(100, { message: 'Search for 100 characters or fewer.' })
  q: string;
}

class CorrectionItemDto {
  @IsIn(LEARNED_FIELDS, { message: 'Only the Arabic name and the address are learned.' })
  field: LearnedField;

  /** As the card reading said it. */
  @IsString()
  @MaxLength(300)
  read: string;

  /** As HR saved it. */
  @IsString()
  @MaxLength(300)
  saved: string;
}

/** What HR saved after reading an ID card, field by field, compared with what the reading said. */
export class LearnCorrectionsDto {
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CorrectionItemDto)
  corrections: CorrectionItemDto[];
}
