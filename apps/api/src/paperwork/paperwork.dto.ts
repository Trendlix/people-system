import { PAPERWORK_KINDS, type PaperworkKind } from '@trendlix/shared';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
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

/** Changing a stored paper's number or expiry. */
export class UpdatePaperworkDto extends PaperDetailsDto {}

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
