import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { DECISION_STEPS, FEEDBACK_MAX, HIRING_BATCH_MAX, STEP_OUTCOMES, type DecisionStep, type StepOutcome } from '@trendlix/shared';
import { TrimOrNull } from '../common/transforms.js';

// The batches (owner, 29 October 2026: "Tick several at once"; the recruitment tree, 3 November 2026): the applicants
// ticked, sent to Review 1, or decided at their step with one outcome, its reasons and feedback. What each applicant's
// turn is the service's (hiring-batches.ts), said in words.

/** HR's Send to Review 1: the applicants ticked on the vacancy's list. */
export class SendToReviewBatchDto {
  @IsArray({ message: 'Send the applicants as a list of their ids.' })
  @ArrayMinSize(1, { message: 'Tick at least one applicant to send to Review 1.' })
  @ArrayMaxSize(HIRING_BATCH_MAX, { message: `Send at most ${HIRING_BATCH_MAX} applicants at a time.` })
  @IsUUID('all', { each: true, message: 'Send each applicant as their application’s id.' })
  applicationIds: string[] = [];
}

/** A step decided for several at once: the step they are at, the outcome, a rejection's reasons, the feedback. */
export class DecideBatchDto {
  @IsArray({ message: 'Send the applicants as a list of their ids.' })
  @ArrayMinSize(1, { message: 'Tick at least one applicant.' })
  @ArrayMaxSize(HIRING_BATCH_MAX, { message: `Decide at most ${HIRING_BATCH_MAX} applicants at a time.` })
  @IsUUID('all', { each: true, message: 'Send each applicant as their application’s id.' })
  applicationIds: string[] = [];

  @IsIn(DECISION_STEPS, { message: 'Choose the step they are at.' })
  stage!: DecisionStep;

  @IsIn(STEP_OUTCOMES, { message: 'Choose the outcome.' })
  outcome!: StepOutcome;

  @IsOptional() @IsArray({ message: 'Send the reasons as a list.' }) @ArrayMaxSize(12) @IsString({ each: true })
  reasons?: string[];

  @IsOptional() @TrimOrNull() @IsString({ message: 'Write the feedback as text.' }) @MaxLength(FEEDBACK_MAX, { message: `Keep the feedback to ${FEEDBACK_MAX} characters or fewer.` })
  feedback?: string | null;
}
