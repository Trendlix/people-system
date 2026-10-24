import { Transform } from 'class-transformer';
import { Allow, ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
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
  FEEDBACK_NOTES_MAX,
  HIRING_SUGGESTIONS,
  INTERVIEW_KINDS,
  INTERVIEW_LIMITS,
  RECOMMENDATIONS,
  REJECTION_LIMITS,
  SUGGESTION_NOTE_MAX,
  type HiringSuggestion,
  type InterviewKind,
  type Recommendation,
  CV_BATCH_LIMIT,
  DICTIONARY_SKILL_NAMES,
  GENERAL_CV_SOURCES,
  GENERAL_CV_STATUSES,
  MOVE_STAGES,
  type CvSaveRow,
  type GeneralCvSource,
  type GeneralCvStatus,
  type MoveStage,
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

  /** The key skills each CV is checked for (22 October 2026): a list, or text with commas; checked by the service (keySkillsProblems). */
  @IsOptional() @Allow()
  keySkills?: unknown;
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

  /** Only those with at least these years of experience: the years typed, else the CV's (24 October 2026). */
  @IsOptional() @Transform(({ value }) => (value === '' || value === undefined ? undefined : Number(value))) @IsNumber() @Min(0) @Max(L.yearsExperience)
  minYears?: number;

  @IsOptional() @IsIn(APPLICATION_SOURCES)
  source?: ApplicationSource;

  /** Only those whose CV names this skill of the dictionary (skills-dictionary.ts; 24 October 2026). */
  @IsOptional() @IsIn(DICTIONARY_SKILL_NAMES, { message: 'Choose a skill from the list.' })
  skill?: string;

  /** `hide` (the default): not those filtered out; `only`: only them; `all`. */
  @IsOptional() @IsIn(['hide', 'only', 'all'])
  filtered?: 'hide' | 'only' | 'all';

  @IsOptional() @Trim() @IsString() @MaxLength(100)
  q?: string;

  /** Only those whose CV has at least this % of the vacancy's key skills (22 October 2026). */
  @IsOptional() @Transform(({ value }) => (value === '' || value === undefined ? undefined : Number(value))) @IsInt() @Min(0) @Max(100)
  minCvMatch?: number;

  /** `match` (the default): the screening match first; `cv`: the CV match first; `years`: the most experience first (24 October 2026). */
  @IsOptional() @IsIn(['match', 'cv', 'years'])
  sort?: 'match' | 'cv' | 'years';
}

export class MoveApplicationDto {
  @IsIn(HAND_STAGES, { message: 'Choose shortlisted, interview or rejected.' })
  to!: HandStage;

  /** Required to reject. */
  @IsOptional() @TrimOrNull() @IsString() @MaxLength(L.reason, { message: `Keep the reason to ${L.reason} characters or fewer.` })
  reason?: string | null;

  /** Phase 2: a rejection may email the candidate the rejection email (off unless sent). */
  @IsOptional() @IsBoolean({ message: 'Say whether to email the candidate.' })
  email?: boolean;
}

// ---------- Phase 2 (owner, 22 October 2026; packages/shared recruitment-hiring.ts) ----------

const IL = INTERVIEW_LIMITS;

/** Scheduling or rescheduling an interview: checked by the service with interviewProblems (every problem in words). */
export class InterviewDto {
  @IsString({ message: 'Choose the day of the interview.' }) @MaxLength(10)
  date!: string;

  /** HH:mm, 24 hours, in Cairo. */
  @IsString({ message: 'Choose the time of the interview.' }) @MaxLength(5)
  time!: string;

  @IsInt({ message: 'Give its length in minutes.' }) @Min(IL.minutesMin, { message: 'An interview takes 15 minutes at least.' }) @Max(IL.minutesMax, { message: 'An interview takes 8 hours at most.' })
  minutes!: number;

  @IsIn(INTERVIEW_KINDS, { message: 'Choose how it is held: in person, online or by phone.' })
  kind!: InterviewKind;

  @IsOptional() @TrimOrNull() @IsString() @MaxLength(IL.location, { message: `Keep the place to ${IL.location} characters or fewer.` })
  location?: string | null;

  @IsArray({ message: 'Choose who interviews them.' }) @IsUUID('all', { each: true, message: 'Choose the interviewers from the list.' })
  interviewerIds!: string[];

  @IsOptional() @TrimOrNull() @IsString() @MaxLength(IL.note, { message: `Keep the note to ${IL.note} characters or fewer.` })
  note?: string | null;
}

export class CancelInterviewDto {
  @IsOptional() @TrimOrNull() @IsString() @MaxLength(IL.reason, { message: `Keep the reason to ${IL.reason} characters or fewer.` })
  reason?: string | null;
}

export class InterviewOutcomeDto {
  @IsIn(['done', 'no_show'], { message: 'Choose done or no-show.' })
  outcome!: 'done' | 'no_show';
}

/** An interviewer's scorecard: checked by the service with feedbackProblems. */
export class FeedbackDto {
  @Allow()
  ratings!: Record<string, unknown>;

  @IsIn(RECOMMENDATIONS, { message: 'Choose your recommendation: strong yes, yes, no or strong no.' })
  recommendation!: Recommendation;

  @IsOptional() @TrimOrNull() @IsString() @MaxLength(FEEDBACK_NOTES_MAX, { message: `Keep the notes to ${FEEDBACK_NOTES_MAX} characters or fewer.` })
  notes?: string | null;
}

/** The hiring manager's suggestion. */
export class SuggestionDto {
  @IsIn(HIRING_SUGGESTIONS, { message: 'Suggest the next step or a rejection.' })
  suggestion!: HiringSuggestion;

  @IsOptional() @TrimOrNull() @IsString() @MaxLength(SUGGESTION_NOTE_MAX, { message: `Keep the note to ${SUGGESTION_NOTE_MAX} characters or fewer.` })
  note?: string | null;
}

/** The rejection email's words (empty: the standard). */
export class RecruitmentSettingsDto {
  @IsOptional() @TrimOrNull() @IsString() @MaxLength(REJECTION_LIMITS.subject, { message: `Keep the subject to ${REJECTION_LIMITS.subject} characters or fewer.` })
  rejectionSubject?: string | null;

  @IsOptional() @TrimOrNull() @IsString() @MaxLength(REJECTION_LIMITS.text, { message: `Keep the English text to ${REJECTION_LIMITS.text} characters or fewer.` })
  rejectionEn?: string | null;

  @IsOptional() @TrimOrNull() @IsString() @MaxLength(REJECTION_LIMITS.text, { message: `Keep the Arabic text to ${REJECTION_LIMITS.text} characters or fewer.` })
  rejectionAr?: string | null;
}

/** ?year= and ?departmentId= for the analytics. */
export class AnalyticsQueryDto {
  @IsOptional() @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value))) @IsInt({ message: 'Choose a year, e.g. 2026.' }) @Min(2000) @Max(2100)
  year?: number;

  @IsOptional() @IsUUID('all', { message: 'Choose a department from the list.' })
  departmentId?: string;
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

// ---------- general CVs and the bulk upload (owner, 22 October 2026; packages/shared general-cvs.ts) ----------

/** "Send us your CV" on the careers page, as a multipart form: every field a string, read and checked by the service. */
export class GeneralCvFormDto {
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

  /** The area of interest: a department's id, or none with `areaOther`. */
  @IsOptional() @IsString() @MaxLength(40)
  departmentId?: string;

  @IsOptional() @IsString() @MaxLength(200)
  areaOther?: string;

  /** "true" when the consent is ticked. */
  @IsOptional() @IsString() @MaxLength(10)
  consent?: string;

  /** The honeypot: a field people never see, so never fill in. */
  @IsOptional() @IsString() @MaxLength(1000)
  website?: string;

  /** The person's address and browser, as the website saw them. */
  @IsOptional() @IsString() @MaxLength(100)
  ip?: string;

  @IsOptional() @IsString() @MaxLength(500)
  userAgent?: string;
}

/** HR's Add a CV: the general form's fields, how it came, who referred them and HR's notes. */
export class AddGeneralCvDto extends GeneralCvFormDto {
  @IsOptional() @IsString() @MaxLength(40)
  source?: string;

  @IsOptional() @IsString() @MaxLength(400)
  referrer?: string;

  @IsOptional() @IsString() @MaxLength(4000)
  notes?: string;
}

export class ListGeneralCvsDto {
  /** A status, or all; none: all but those archived. */
  @IsOptional() @IsIn([...GENERAL_CV_STATUSES, 'all'], { message: 'Choose a status.' })
  status?: GeneralCvStatus | 'all';

  @IsOptional() @IsIn(GENERAL_CV_SOURCES, { message: 'Choose a source.' })
  source?: GeneralCvSource;

  @IsOptional() @IsUUID('all')
  departmentId?: string;

  @IsOptional() @Trim() @IsString() @MaxLength(100)
  q?: string;

  /** Only those with at least these years of experience: the years typed, else the CV's (24 October 2026). */
  @IsOptional() @Transform(({ value }) => (value === '' || value === undefined ? undefined : Number(value))) @IsNumber() @Min(0) @Max(L.yearsExperience)
  minYears?: number;

  /** Only those whose CV names this skill of the dictionary (skills-dictionary.ts; 24 October 2026). */
  @IsOptional() @IsIn(DICTIONARY_SKILL_NAMES, { message: 'Choose a skill from the list.' })
  skill?: string;
}

export class MoveGeneralCvDto {
  @IsUUID('all', { message: 'Choose the vacancy.' })
  vacancyId!: string;

  @IsOptional() @IsIn(MOVE_STAGES, { message: 'Choose Applied or Shortlisted.' })
  stage?: MoveStage;
}

export class GeneralCvNotesDto {
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(L.notes, { message: `Keep the notes to ${L.notes} characters or fewer.` })
  notes?: string | null;
}

/** A bulk upload's target: a vacancy, or (none) the general CVs. */
export class CvUploadTargetDto {
  @IsOptional() @IsUUID('all', { message: 'Choose the vacancy.' })
  vacancyId?: string;
}

/** The rows of a bulk upload, as HR checked them: each checked by the service. */
export class CvSaveDto extends CvUploadTargetDto {
  @IsArray({ message: 'Send the rows as a list.' }) @ArrayMaxSize(CV_BATCH_LIMIT, { message: `A batch takes at most ${CV_BATCH_LIMIT} CVs.` })
  rows!: CvSaveRow[];
}

/** Discarding a batch (or one CV of it, `id`). */
export class CvDiscardDto extends CvUploadTargetDto {
  @IsOptional() @IsUUID('all')
  id?: string;
}
