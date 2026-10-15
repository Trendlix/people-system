import { PDF_FIELDS_MAX, TEMPLATE_LANGUAGES, type PdfDateOrder, type PdfField, type PdfFieldAlign, type PdfFieldKind, type TemplateLanguage } from '@trendlix/shared';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { TrimOrNull } from '../common/transforms.js';

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

/** A version's file name, as the library shows it (owner, 15 October 2026: "can I rename the file?"). */
export class RenameTemplateVersionDto {
  @IsString({ message: 'Enter the file name.' })
  @IsNotEmpty({ message: 'Enter the file name.' })
  @MaxLength(200, { message: 'Keep the file name to 200 characters or fewer.' })
  fileName: string;
}

// The fields placed on a PDF template (packages/shared PdfField). Checked here for their shape only; what they may be
// (a known tag, on a page of the form and inside it, a size that prints …) is checked by pdfFieldsProblem (pdf-fields.ts),
// which names the field in its message.

const SHAPE = 'Each field must have its kind, page, position, size and text size.';

/** A box moved from its place, in points. */
class PdfNudgeDto {
  @IsNumber({}, { message: SHAPE })
  dx: number;

  @IsNumber({}, { message: SHAPE })
  dy: number;
}

class PdfFieldDto implements PdfField {
  @IsString({ message: SHAPE })
  id: string;

  @IsString({ message: SHAPE })
  kind: PdfFieldKind;

  @IsOptional()
  @IsString({ message: SHAPE })
  tag: string | null;

  @IsOptional()
  @IsString({ message: SHAPE })
  text?: string;

  @IsOptional()
  @IsString({ message: SHAPE })
  equals?: string;

  @IsInt({ message: SHAPE })
  page: number;

  @IsNumber({}, { message: SHAPE })
  x: number;

  @IsNumber({}, { message: SHAPE })
  y: number;

  @IsNumber({}, { message: SHAPE })
  width: number;

  @IsNumber({}, { message: SHAPE })
  height: number;

  @IsNumber({}, { message: SHAPE })
  fontSize: number;

  @IsOptional()
  @IsBoolean({ message: SHAPE })
  bold?: boolean;

  @IsOptional()
  @IsString({ message: SHAPE })
  align?: PdfFieldAlign;

  @IsOptional()
  @IsBoolean({ message: SHAPE })
  shrinkToFit?: boolean;

  @IsOptional()
  @IsNumber({}, { message: SHAPE })
  boxes?: number;

  @IsOptional()
  @IsArray({ message: SHAPE })
  @IsNumber({}, { each: true, message: SHAPE })
  groups?: number[];

  @IsOptional()
  @IsNumber({}, { message: SHAPE })
  groupGap?: number;

  @IsOptional()
  @IsNumber({}, { message: SHAPE })
  boxGap?: number;

  @IsOptional()
  @IsArray({ message: SHAPE })
  @ArrayMaxSize(40, { message: SHAPE })
  @ValidateNested({ each: true })
  @Type(() => PdfNudgeDto)
  nudges?: PdfNudgeDto[];

  @IsOptional()
  @IsString({ message: SHAPE })
  boxAlign?: 'left' | 'right';

  @IsOptional()
  @IsString({ message: SHAPE })
  dateOrder?: PdfDateOrder;

  @IsOptional()
  @IsString({ message: SHAPE })
  amountPart?: 'pounds' | 'piasters';

  @IsOptional()
  @IsBoolean({ message: SHAPE })
  arabicDigits?: boolean;

  /** text and boxes: left blank when the value is missing, rather than stopping the document (owner, 15 October 2026). */
  @IsOptional()
  @IsBoolean({ message: SHAPE })
  optional?: boolean;

  /** text and fixed: the most lines the value may take, 1 to 4 (owner, 16 October 2026); checked by pdfFieldsProblem. */
  @IsOptional()
  @IsInt({ message: SHAPE })
  lines?: number;
}

/** All the fields of a PDF template, saved together ([] clears them), or sent for a sample. */
export class PdfFieldsDto {
  @IsArray({ message: 'Send the fields as a list, e.g. [] for none.' })
  @ArrayMaxSize(PDF_FIELDS_MAX, { message: `A form can have at most ${PDF_FIELDS_MAX} fields.` })
  @ValidateNested({ each: true })
  @Type(() => PdfFieldDto)
  fields: PdfFieldDto[];
}
