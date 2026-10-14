import { PAPERWORK_KINDS, type PaperworkKind } from '@trendlix/shared';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../common/transforms.js';

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
