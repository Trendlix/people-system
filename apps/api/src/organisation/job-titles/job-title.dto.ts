import { Transform } from 'class-transformer';
import { occupationName } from '@trendlix/shared';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateBy } from 'class-validator';
import { LatinDigits, Trim, TrimOrNull } from '../../common/transforms.js';
import { JD_HTML_MAX, JD_HTML_RAW_MAX, sanitizeJdHtml } from './jd-html.js';

// Trims each duty and drops blank lines.
const CleanDuties = () =>
  Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((d) => (typeof d === 'string' ? d.trim() : d)).filter((d) => d !== '')
      : value,
  );

/**
 * A job description field: simple rich text, sent and saved as HTML (owner's request, 15 October 2026), cleaned to the
 * allowed tags (see jd-html.ts). Nothing left to read becomes null, so "clear this field" works. Anything longer than
 * the most that is cleaned stays as sent, for the length check to refuse.
 */
const JdHtml = () =>
  Transform(({ value }) => (typeof value === 'string' && value.length <= JD_HTML_RAW_MAX ? sanitizeJdHtml(value) : value));

/** The message when the occupation isn't one of the social insurance table's. */
export const OCCUPATION_MESSAGE = 'Choose the occupation from the social insurance list.';

/** A six-digit code of the social insurance occupations table (packages/shared occupations.ts). */
const IsOccupation = () =>
  ValidateBy({
    name: 'isOccupation',
    validator: { validate: (v) => typeof v === 'string' && /^\d{6}$/.test(v) && occupationName(v) !== null, defaultMessage: () => OCCUPATION_MESSAGE },
  });

const tooLong = (field: string) => ({
  message: `Shorten the ${field}: it can take up to ${JD_HTML_MAX.toLocaleString('en')} characters, formatting included.`,
});

export class CreateJobTitleDto {
  /** Where it belongs: a department itself, or one of its teams (owner's decision, 15 October 2026). */
  @IsUUID('all', { message: 'Choose a department or team.' })
  departmentId: string;

  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Enter the job title in English.' })
  @MaxLength(150)
  titleEn: string;

  @TrimOrNull()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  titleAr?: string | null;

  /** The range of grades the job title takes (owner's decision, 15 October 2026); either end may be empty. */
  @TrimOrNull()
  @IsOptional()
  @IsUUID('all', { message: 'Choose the lowest grade.' })
  minGradeId?: string | null;

  @TrimOrNull()
  @IsOptional()
  @IsUUID('all', { message: 'Choose the highest grade.' })
  maxGradeId?: string | null;

  /**
   * Its occupation in the social insurance table, by its six-digit code (كود المهنة, printed on Form 1 for everyone
   * with the title: owner, 15 October 2026); null clears it.
   */
  @LatinDigits()
  @TrimOrNull()
  @IsOptional()
  @IsOccupation()
  occupationCode?: string | null;

  /** The job description's purpose, as HTML. */
  @JdHtml()
  @IsOptional()
  @IsString()
  @MaxLength(JD_HTML_MAX, tooLong('purpose'))
  jdPurpose?: string | null;

  /**
   * The duties, as HTML; the duty rows (which KPIs will be linked to) are read from it: each list item and paragraph.
   * Sent with `duties`, this wins.
   */
  @JdHtml()
  @IsOptional()
  @IsString()
  @MaxLength(JD_HTML_MAX, tooLong('duties'))
  jdDuties?: string | null;

  @JdHtml()
  @IsOptional()
  @IsString()
  @MaxLength(JD_HTML_MAX, tooLong('requirements'))
  jdRequirements?: string | null;

  /** The duties one per line, as sent before 15 October 2026: still taken, and made into `jdDuties`. */
  @CleanDuties()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  duties?: string[];
}

export class UpdateJobTitleDto {
  /** Where it belongs: a department itself, or one of its teams (owner's decision, 15 October 2026). */
  @IsOptional()
  @IsUUID('all', { message: 'Choose a department or team.' })
  departmentId?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Enter the job title in English.' })
  @MaxLength(150)
  titleEn?: string;

  @TrimOrNull()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  titleAr?: string | null;

  /** The range of grades the job title takes (owner's decision, 15 October 2026); either end may be empty. */
  @TrimOrNull()
  @IsOptional()
  @IsUUID('all', { message: 'Choose the lowest grade.' })
  minGradeId?: string | null;

  @TrimOrNull()
  @IsOptional()
  @IsUUID('all', { message: 'Choose the highest grade.' })
  maxGradeId?: string | null;

  /**
   * Its occupation in the social insurance table, by its six-digit code (كود المهنة, printed on Form 1 for everyone
   * with the title: owner, 15 October 2026); null clears it.
   */
  @LatinDigits()
  @TrimOrNull()
  @IsOptional()
  @IsOccupation()
  occupationCode?: string | null;

  /** The job description's purpose, as HTML. */
  @JdHtml()
  @IsOptional()
  @IsString()
  @MaxLength(JD_HTML_MAX, tooLong('purpose'))
  jdPurpose?: string | null;

  /**
   * The duties, as HTML; the duty rows (which KPIs will be linked to) are read from it: each list item and paragraph.
   * Sent with `duties`, this wins.
   */
  @JdHtml()
  @IsOptional()
  @IsString()
  @MaxLength(JD_HTML_MAX, tooLong('duties'))
  jdDuties?: string | null;

  @JdHtml()
  @IsOptional()
  @IsString()
  @MaxLength(JD_HTML_MAX, tooLong('requirements'))
  jdRequirements?: string | null;

  /** The duties one per line, as sent before 15 October 2026: still taken, and made into `jdDuties`. */
  @CleanDuties()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  duties?: string[];
}
