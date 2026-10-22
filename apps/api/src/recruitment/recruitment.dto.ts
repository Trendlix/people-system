import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import {
  APPLICATION_SOURCES,
  APPLICATION_STAGES,
  EMPLOYMENT_TYPES,
  HAND_STAGES,
  RECRUITMENT_LIMITS,
  VACANCY_STATUSES,
  WORK_ARRANGEMENTS,
  type ApplicationSource,
  type ApplicationStage,
  type EmploymentType,
  type HandStage,
  type WorkArrangement,
} from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';
import { Trim, TrimOrNull } from '../common/transforms.js';
import { EMPLOYMENT_TYPE_MESSAGE } from '../employees/employment.dto.js';

// What the recruitment pages send (owner, 22 October 2026: "where will we include the ATS?"; packages/shared
// recruitment.ts). A vacancy's questions are a list of objects checked by the service with the shared rules (every
// problem in words), not here. The careers page's form arrives as a multipart form: every field a string (the answers
// as JSON), read by the service.

const L = RECRUITMENT_LIMITS;
/** Present (even as null) means "change it"; for fields that cannot be empty, null is then refused. */
const Sent = () => ValidateIf((_o, v) => v !== undefined);
const MONEY_MESSAGE = 'Give the salary in EGP a month, e.g. 15000, or leave it empty.';
const HTML_MAX = 20_000;

class VacancyFieldsDto {
  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose the grade, or leave it empty.' })
  gradeId?: string | null;

  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose the hiring manager, or leave it empty.' })
  hiringManagerId?: string | null;

  @Sent() @IsInt({ message: `The headcount is a whole number from 1 to ${L.headcount}.` }) @Min(1, { message: `The headcount is a whole number from 1 to ${L.headcount}.` }) @Max(L.headcount, { message: `The headcount is a whole number from 1 to ${L.headcount}.` })
  headcount?: number;

  @Sent() @IsIn(WORK_ARRANGEMENTS, { message: 'Choose where the work is done.' })
  workArrangement?: WorkArrangement;

  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose the shift, or leave it empty.' })
  shiftId?: string | null;

  @IsOptional() @IsInt({ message: `The contract length is in whole months, from 1 to ${L.durationMonths}.` })
  durationMonths?: number | null;

  @IsOptional() @IsDateOnly('Give the closing date as a date, or leave it empty.')
  closingDate?: string | null;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: MONEY_MESSAGE }) @Min(0, { message: MONEY_MESSAGE }) @Max(L.salary, { message: MONEY_MESSAGE })
  salaryMin?: number | null;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: MONEY_MESSAGE }) @Min(0, { message: MONEY_MESSAGE }) @Max(L.salary, { message: MONEY_MESSAGE })
  salaryMax?: number | null;

  /** The public description, rich text cleaned as job descriptions are; left out on a new vacancy: its job title's JD. */
  @IsOptional() @IsString() @MaxLength(HTML_MAX * 10)
  about?: string | null;

  @IsOptional() @IsString() @MaxLength(HTML_MAX * 10)
  responsibilities?: string | null;

  @IsOptional() @IsString() @MaxLength(HTML_MAX * 10)
  requirements?: string | null;

  /** VacancyQuestion[]: checked by the service (vacancyQuestionsProblems). */
  @IsOptional() @IsArray({ message: 'Send the questions as a list.' })
  questions?: unknown[];
}

export class CreateVacancyDto extends VacancyFieldsDto {
  @IsUUID('all', { message: 'Choose the job title.' })
  jobTitleId!: string;

  /** The title on the careers page; the job title's name unless given. */
  @IsOptional() @Trim() @IsString() @MaxLength(L.title, { message: `Keep the title to ${L.title} characters or fewer.` })
  title?: string;

  @IsIn(EMPLOYMENT_TYPES, { message: EMPLOYMENT_TYPE_MESSAGE })
  employmentType!: EmploymentType;
}

export class UpdateVacancyDto extends VacancyFieldsDto {
  @Sent() @IsUUID('all', { message: 'Choose the job title.' })
  jobTitleId?: string;

  @Sent() @Trim() @IsString() @MaxLength(L.title, { message: `Keep the title to ${L.title} characters or fewer.` })
  title?: string;

  @Sent() @IsIn(EMPLOYMENT_TYPES, { message: EMPLOYMENT_TYPE_MESSAGE })
  employmentType?: EmploymentType;
}

export class ListVacanciesDto {
  /** A status, `active` (draft, waiting, open, on hold: the default) or `all`. */
  @IsOptional() @IsIn([...VACANCY_STATUSES, 'active', 'all'], { message: 'Choose which vacancies to list.' })
  status?: string;

  @IsOptional() @Trim() @IsString() @MaxLength(100)
  q?: string;
}

/** A reason: required to send back, optional to close. */
export class VacancyReasonDto {
  @IsOptional() @TrimOrNull() @IsString() @MaxLength(L.reason, { message: `Keep the reason to ${L.reason} characters or fewer.` })
  reason?: string | null;
}

export class ListApplicationsDto {
  @IsOptional() @IsUUID('all')
  vacancyId?: string;

  @IsOptional() @IsIn(APPLICATION_STAGES, { message: 'Choose a stage.' })
  stage?: ApplicationStage;

  /** Only those with a match of at least this %. */
  @IsOptional() @Transform(({ value }) => (value === '' || value === undefined ? undefined : Number(value))) @IsInt() @Min(0) @Max(100)
  minMatch?: number;

  /** Only those with at least these years of experience. */
  @IsOptional() @Transform(({ value }) => (value === '' || value === undefined ? undefined : Number(value))) @IsNumber() @Min(0) @Max(L.yearsExperience)
  minYears?: number;

  @IsOptional() @IsIn(APPLICATION_SOURCES)
  source?: ApplicationSource;

  /** `hide` (the default): not those filtered out; `only`: only them; `all`. */
  @IsOptional() @IsIn(['hide', 'only', 'all'])
  filtered?: 'hide' | 'only' | 'all';

  @IsOptional() @Trim() @IsString() @MaxLength(100)
  q?: string;
}

export class MoveApplicationDto {
  @IsIn(HAND_STAGES, { message: 'Choose shortlisted, interview or rejected.' })
  to!: HandStage;

  /** Required to reject. */
  @IsOptional() @TrimOrNull() @IsString() @MaxLength(L.reason, { message: `Keep the reason to ${L.reason} characters or fewer.` })
  reason?: string | null;
}

export class ApplicationNotesDto {
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(L.notes, { message: `Keep the notes to ${L.notes} characters or fewer.` })
  notes?: string | null;
}

/** The careers page's form, as a multipart form: every field a string, read and checked by the service. */
export class ApplyDto {
  @IsOptional() @IsString() @MaxLength(400)
  fullName?: string;

  @IsOptional() @IsString() @MaxLength(400)
  email?: string;

  @IsOptional() @IsString() @MaxLength(100)
  mobile?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  linkedin?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  portfolio?: string;

  @IsOptional() @IsString() @MaxLength(20)
  yearsExperience?: string;

  @IsOptional() @IsString() @MaxLength(200)
  noticePeriod?: string;

  @IsOptional() @IsString() @MaxLength(30)
  expectedSalary?: string;

  /** The answers, as JSON: { [question key]: answer }. */
  @IsOptional() @IsString() @MaxLength(20_000)
  answers?: string;

  /** "true" when the consent is ticked. */
  @IsOptional() @IsString() @MaxLength(10)
  consent?: string;

  /** ?src= of the link they came by. */
  @IsOptional() @IsString() @MaxLength(40)
  source?: string;

  /** The honeypot: a field people never see, so never fill in. */
  @IsOptional() @IsString() @MaxLength(1000)
  website?: string;

  /** The applicant's address and browser, as the website saw them. */
  @IsOptional() @IsString() @MaxLength(100)
  ip?: string;

  @IsOptional() @IsString() @MaxLength(500)
  userAgent?: string;
}
