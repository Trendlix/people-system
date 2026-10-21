import { Transform } from 'class-transformer';
import { Allow, ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { KPI_COMMENT_MAX, KPI_LAST_DEADLINE_DAY, KPI_STATUSES, KPI_TEMPLATE_LIMITS, type KpiStatus } from '@trendlix/shared';
import { TrimOrNull } from '../common/transforms.js';

// What the KPI pages send (owner, 21 October 2026: "lets start with the KPI's First"; packages/shared kpis.ts
// KpiDraftSource, KpiTemplateContent, KpiPicksInput, KpiCalibrateInput, KpiSignInput). A template's metrics and a step's
// picks are lists of objects checked by the services with the shared rules (every problem in words), not here.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_MESSAGE = 'Choose a month as YYYY-MM, e.g. 2026-10.';
const COMMENT_LENGTH = `Keep the comment to ${KPI_COMMENT_MAX} characters or fewer.`;
const day = (label: string) => `${label}: choose a day from 1 to ${KPI_LAST_DEADLINE_DAY}.`;

/** The deadlines: each day sent replaces it (packages/shared kpiSettingsProblems checks them together). */
export class KpiSettingsDto {
  @IsOptional() @IsInt({ message: day('Self-rating by') }) @Min(1, { message: day('Self-rating by') }) @Max(KPI_LAST_DEADLINE_DAY, { message: day('Self-rating by') })
  selfRatingDay?: number;

  @IsOptional() @IsInt({ message: day('Manager’s scoring by') }) @Min(1, { message: day('Manager’s scoring by') }) @Max(KPI_LAST_DEADLINE_DAY, { message: day('Manager’s scoring by') })
  managerDay?: number;

  @IsOptional() @IsInt({ message: day('HR’s calibration by') }) @Min(1, { message: day('HR’s calibration by') }) @Max(KPI_LAST_DEADLINE_DAY, { message: day('HR’s calibration by') })
  hrDay?: number;

  @IsOptional() @IsInt({ message: day('Sign-off by') }) @Min(1, { message: day('Sign-off by') }) @Max(KPI_LAST_DEADLINE_DAY, { message: day('Sign-off by') })
  signOffDay?: number;
}

/** Where a new draft comes from: blank, a copy of the job title's newest published version, a sample, another template. */
export class KpiDraftDto {
  @IsIn(['blank', 'published', 'sample', 'template'], { message: 'Choose how to start the draft: blank, published, sample or template.' })
  from!: 'blank' | 'published' | 'sample' | 'template';

  @ValidateIf((o: KpiDraftDto) => o.from === 'sample') @IsString({ message: 'Choose a sample.' }) @MaxLength(40)
  sampleCode?: string;

  @ValidateIf((o: KpiDraftDto) => o.from === 'template') @IsUUID('all', { message: 'Choose the template to copy.' })
  templateId?: string;
}

/** A draft's content: the Attendance metric's points and the metrics (checked by kpiTemplateProblems). */
export class KpiTemplateContentDto {
  @Allow()
  attendancePoints!: unknown;

  @IsArray({ message: 'Send the metrics as a list.' }) @ArrayMaxSize(KPI_TEMPLATE_LIMITS.metrics, { message: `A template takes at most ${KPI_TEMPLATE_LIMITS.metrics} metrics.` })
  metrics!: unknown[];
}

/** A step's picks (the self-rating, the scoring): a criterion a metric, each with a comment; its overall comment; sent or saved. */
export class KpiPicksDto {
  @IsArray({ message: 'Send the picks as a list.' }) @ArrayMaxSize(60)
  picks!: unknown[];

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(KPI_COMMENT_MAX, { message: COMMENT_LENGTH })
  comment?: string | null;

  @IsBoolean({ message: 'Say whether the picks are sent (submit true) or saved for later (false).' })
  submit!: boolean;
}

/** HR's calibration: the picks changed, each with its reason, and HR's comment. */
export class KpiCalibrateDto {
  @IsArray({ message: 'Send the changes as a list (empty: none).' }) @ArrayMaxSize(60)
  changes!: unknown[];

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(KPI_COMMENT_MAX, { message: COMMENT_LENGTH })
  comment?: string | null;
}

/** "I've read it", with an optional comment. */
export class KpiSignDto {
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(KPI_COMMENT_MAX, { message: COMMENT_LENGTH })
  comment?: string | null;
}

/** ?scope=team|all&month=&status=&departmentId=. */
export class KpiListQueryDto {
  @IsIn(['team', 'all'], { message: 'Choose the scope: team or all.' })
  scope!: 'team' | 'all';

  @IsOptional() @Matches(MONTH, { message: MONTH_MESSAGE })
  month?: string;

  @IsOptional() @IsIn([...KPI_STATUSES], { message: `Choose a step: ${KPI_STATUSES.join(', ')}.` })
  status?: KpiStatus;

  @IsOptional() @IsUUID('all', { message: 'Choose the department.' })
  departmentId?: string;
}

/** ?scope=team|all&to=YYYY-MM&months=1..12. */
export class KpiHeatmapQueryDto {
  @IsIn(['team', 'all'], { message: 'Choose the scope: team or all.' })
  scope!: 'team' | 'all';

  @IsOptional() @Matches(MONTH, { message: MONTH_MESSAGE })
  to?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value))
  @IsInt({ message: 'Choose 1 to 12 months.' })
  @Min(1, { message: 'Choose 1 to 12 months.' })
  @Max(12, { message: 'Choose 1 to 12 months.' })
  months?: number;
}

/** ?month=YYYY-MM. */
export class KpiMonthQueryDto {
  @IsOptional() @Matches(MONTH, { message: MONTH_MESSAGE })
  month?: string;
}

/** ?month=YYYY-MM, required. */
export class KpiExportQueryDto {
  @Matches(MONTH, { message: MONTH_MESSAGE })
  month!: string;
}
