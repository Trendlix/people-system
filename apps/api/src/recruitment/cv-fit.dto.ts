import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { RECRUITMENT_LIMITS } from '@trendlix/shared';
import { Trim, TrimOrNull } from '../common/transforms.js';

// What the CV fit's pages send (owner, 25 October 2026: "Full CV fit score"; "and if it recomended to another position
// based on the CV"; packages/shared cv-fit.ts): a vacancy's texts to suggest its key skills from, and the CV to add to a
// vacancy it is recommended for.

const HTML_MAX = 200_000;

/** POST /recruitment/key-skills/suggest: the vacancy form's title and texts as typed (nothing is saved). */
export class SuggestKeySkillsDto {
  @Trim() @IsString() @MaxLength(RECRUITMENT_LIMITS.title, { message: `Keep the title to ${RECRUITMENT_LIMITS.title} characters or fewer.` })
  title!: string;

  /** The job title chosen, whose name is read too. */
  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose the job title, or leave it empty.' })
  jobTitleId?: string | null;

  @IsOptional() @IsString() @MaxLength(HTML_MAX)
  requirements?: string | null;

  @IsOptional() @IsString() @MaxLength(HTML_MAX)
  responsibilities?: string | null;

  @IsOptional() @IsString() @MaxLength(HTML_MAX)
  about?: string | null;
}

/** POST /recruitment/vacancies/:id/recommended/add: an applicant's CV, or a general CV's (one of them). */
export class AddRecommendedDto {
  @IsOptional() @IsUUID('all', { message: 'Choose the applicant.' })
  applicationId?: string;

  @IsOptional() @IsUUID('all', { message: 'Choose the general CV.' })
  generalCvId?: string;
}
