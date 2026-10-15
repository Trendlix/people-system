import { TEMPLATE_LANGUAGES, type TemplateLanguage } from '@trendlix/shared';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { TrimOrNull } from '../common/transforms.js';
import { MAX_EDITS } from './map-fields.js';

/** The form fields sent with an uploaded template. */
export class UploadTemplateDto {
  /** Needed when the slot's language is set on upload; otherwise the slot's, and only the slot's. */
  @TrimOrNull()
  @IsOptional()
  @IsIn(TEMPLATE_LANGUAGES, { message: 'Choose the language of the template: Arabic, English, or both.' })
  language?: TemplateLanguage | null;

  /** What changed in this version, for HR's own record. */
  @TrimOrNull()
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Keep the note to 500 characters or fewer.' })
  note?: string | null;
}

/** One change Map Fields makes: the range [from, to) of a line's text, and what goes in its place. */
export class FieldEditDto {
  /** The line's id, as GET versions/:id/lines gives it, e.g. "word/document.xml#12". */
  @IsString({ message: 'Say which line to change.' })
  @MaxLength(200, { message: 'Say which line to change.' })
  line: string;

  @IsInt({ message: 'Say where on the line the change starts.' })
  @Min(0, { message: 'Say where on the line the change starts.' })
  from: number;

  @IsInt({ message: 'Say where on the line the change ends.' })
  @Min(0, { message: 'Say where on the line the change ends.' })
  to: number;

  /** One {{tag}}, with at most one space before and after it, or '' to take a tag out. Not trimmed: the spaces count. */
  @IsString({ message: 'Give the tag to put in, or nothing to take a tag out.' })
  @MaxLength(100, { message: 'Put in one tag at a time.' })
  text: string;
}

/** Map Fields: the changes to make, saved as a new draft version. */
export class MapFieldsDto {
  @IsArray({ message: 'Make at least one change.' })
  @ArrayMinSize(1, { message: 'Make at least one change.' })
  @ArrayMaxSize(MAX_EDITS, { message: `Make at most ${MAX_EDITS} changes at a time.` })
  @ValidateNested({ each: true })
  @Type(() => FieldEditDto)
  edits: FieldEditDto[];

  /** What changed, for HR's own record; "Fields mapped in People System from v<N>" when not given. */
  @TrimOrNull()
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Keep the note to 500 characters or fewer.' })
  note?: string | null;
}
