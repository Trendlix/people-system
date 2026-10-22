import { Transform } from 'class-transformer';
import { Allow, ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { KPI_COMMENT_MAX, KPI_LAST_DEADLINE_DAY, KPI_LIBRARY, KPI_STATUSES, KPI_TEMPLATE_LIMITS, type KpiStatus } from '@trendlix/shared';
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

/**
 * The next KPI framework (owner, 21 October 2026: "Fully flexible"): its pillars, in order, the Attendance metric's
 * pillar and the month they apply from (packages/shared kpiPillarSetProblems and kpiFrameworkMonthProblems check them
 * together). `nextId`: the next framework the page changed (null: it had none), so a change made meanwhile isn't
 * overwritten; left out, the next one is changed, or made.
 */
export class KpiFrameworkDto {
  /**
   * A department's or a team's own pillars (owner, 22 October 2026: "i need pillars to each department", then "Yes, add
   * team pillars"); null or left out: the company's.
   */
  @IsOptional() @IsUUID('all', { message: 'Choose a department.' })
  departmentId?: string | null;

  /** A department or a team only: the level above's pillars again from `appliesFrom` (a team its department's; no pillars sent). */
  @IsOptional() @IsBoolean({ message: 'Say whether it takes the pillars above it again.' })
  followsCompany?: boolean;

  @Matches(MONTH, { message: 'Choose the month the pillars apply from, e.g. 2026-11.' })
  appliesFrom!: string;

  @ValidateIf((o: KpiFrameworkDto) => o.followsCompany !== true)
  @IsString({ message: 'Choose the pillar the Attendance metric counts in.' })
  @MaxLength(40, { message: 'Choose the pillar the Attendance metric counts in.' })
  attendancePillar?: string;

  @ValidateIf((o: KpiFrameworkDto) => o.followsCompany !== true)
  @IsArray({ message: 'Send the pillars as a list.' })
  @ArrayMaxSize(20, { message: 'A framework takes at most 8 pillars.' })
  pillars?: unknown[];

  @IsOptional() @IsUUID('all', { message: 'Reload the page and try again.' })
  nextId?: string | null;
}

/**
 * Where a new draft comes from: blank, a copy of the job title's newest published version, a sample, another template,
 * or a role of the KPI role library (owner, 21 October 2026: "can you add templetes for all departments and job roles").
 */
export class KpiDraftDto {
  @IsIn(['blank', 'published', 'sample', 'template', 'library'], { message: 'Choose how to start the draft: blank, published, sample, template or library.' })
  from!: 'blank' | 'published' | 'sample' | 'template' | 'library';

  @ValidateIf((o: KpiDraftDto) => o.from === 'sample') @IsString({ message: 'Choose a sample.' }) @MaxLength(40)
  sampleCode?: string;

  @ValidateIf((o: KpiDraftDto) => o.from === 'template') @IsUUID('all', { message: 'Choose the template to copy.' })
  templateId?: string;

  @ValidateIf((o: KpiDraftDto) => o.from === 'library') @IsIn(KPI_LIBRARY.map((t) => t.key), { message: 'Choose a role from the library.' })
  libraryKey?: string;
}

/** The drafts to publish at once ("Publish selected drafts"), by their ids. */
export class KpiPublishDraftsDto {
  @IsArray({ message: 'Send the drafts to publish as a list.' })
  @ArrayMinSize(1, { message: 'Choose the drafts to publish.' })
  @ArrayMaxSize(1000, { message: 'Publish at most 1,000 drafts at once.' })
  @IsUUID('all', { each: true, message: 'Choose the drafts to publish.' })
  templateIds!: string[];
}

/** A draft's content: the Attendance metric's points and the metrics (checked by kpiTemplateProblems). */
export class KpiTemplateContentDto {
  @Allow()
  attendancePoints!: unknown;

  @IsArray({ message: 'Send the metrics as a list.' }) @ArrayMaxSize(KPI_TEMPLATE_LIMITS.metrics, { message: `A template takes at most ${KPI_TEMPLATE_LIMITS.metrics} metrics.` })
  metrics!: unknown[];

  /**
   * The job title's own weights for its pillars, by key (owner, 22 October 2026: "wights can be changed for each
   * department and Job title"); null: its department's; left out: those it has kept. Checked by the service
   * (packages/shared kpiWeightsProblems).
   */
  @Allow()
  weights?: unknown;
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

/**
 * A practice scorecard to start (owner, 22 October 2026: "Practice scorecards"; packages/shared KpiPracticeStartInput):
 * whom, the month (default: this one) and the version (default: the job title's newest, a draft when it has one).
 */
export class KpiPracticeStartDto {
  @IsUUID('all', { message: 'Choose the employee.' })
  employeeId!: string;

  @IsOptional() @Matches(MONTH, { message: MONTH_MESSAGE })
  month?: string | null;

  @IsOptional() @IsUUID('all', { message: 'Choose a version of the job title’s KPI template.' })
  templateId?: string | null;
}

/** A practice scorecard's sign-off, standing in for the employee or for the scorer's side: "I've read it". */
export class KpiPracticeSignDto extends KpiSignDto {
  @IsIn(['employee', 'manager'], { message: 'Choose whom you sign for: the employee or the manager.' })
  as!: 'employee' | 'manager';
}

/** DELETE /kpis/practice?mine=true: only the practice scorecards the caller started; left out, every one. */
export class KpiPracticeDeleteQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === 'true' || value === '1' ? true : value === 'false' || value === '0' ? false : value))
  @IsBoolean({ message: 'Say whether to delete only yours: mine=true or mine=false.' })
  mine?: boolean;
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
