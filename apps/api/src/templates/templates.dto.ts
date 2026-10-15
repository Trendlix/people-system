import { TEMPLATE_LANGUAGES, type TemplateLanguage } from '@trendlix/shared';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { TrimOrNull } from '../common/transforms.js';

/** The form fields sent with an uploaded template. */
export class UploadTemplateDto {
  /** Needed when the slot's language is set on upload; otherwise the slot's, and only the slot's. */
  @TrimOrNull()
  @IsOptional()
  @IsIn(TEMPLATE_LANGUAGES, { message: 'Choose the language of the template: Arabic or English.' })
  language?: TemplateLanguage | null;

  /** What changed in this version, for HR's own record. */
  @TrimOrNull()
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Keep the note to 500 characters or fewer.' })
  note?: string | null;
}
