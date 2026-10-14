import { PAPERWORK_KINDS, type PaperworkKind } from '@trendlix/shared';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Trim } from '../common/transforms.js';
import { LEARNED_FIELDS, type LearnedField } from './corrections.js';

/** The form field sent with an uploaded file. */
export class UploadPaperworkDto {
  @Trim()
  @IsIn(PAPERWORK_KINDS, { message: 'Choose what kind of document this is.' })
  kind: PaperworkKind;
}

export class SearchPaperworkDto {
  @Trim()
  @IsString({ message: 'Type at least 2 characters to search.' })
  @MinLength(2, { message: 'Type at least 2 characters to search.' })
  @MaxLength(100, { message: 'Search for 100 characters or fewer.' })
  q: string;
}

class CorrectionItemDto {
  @IsIn(LEARNED_FIELDS, { message: 'Only the Arabic name, the address and the issuing office are learned.' })
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
