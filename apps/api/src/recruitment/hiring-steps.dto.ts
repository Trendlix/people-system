import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { HIRING_BATCH_MAX, HIRING_SUGGESTIONS, SUGGESTION_NOTE_MAX, type HiringSuggestion } from '@trendlix/shared';
import { TrimOrNull } from '../common/transforms.js';

// The hiring steps' batches (owner, 29 October 2026: "HR Filteration and shortlisting - Manager view the shortlisted and
// accept or reject them"; "Tick several at once"): the applicants ticked, and the hiring manager's Accept or Reject with
// a note. What each applicant's turn is the service's (hiring-batches.ts), said in words.

/** HR's shortlist: the applicants ticked on the vacancy's list. */
export class ShortlistBatchDto {
  @IsArray({ message: 'Send the applicants to shortlist as a list of their ids.' })
  @ArrayMinSize(1, { message: 'Tick at least one applicant to shortlist.' })
  @ArrayMaxSize(HIRING_BATCH_MAX, { message: `Shortlist at most ${HIRING_BATCH_MAX} applicants at a time.` })
  @IsUUID('all', { each: true, message: 'Send each applicant as their application’s id.' })
  applicationIds: string[] = [];
}

/** The hiring manager's review of the shortlist: Accept (`next`) or Reject, the same for each ticked, with a note. */
export class ReviewBatchDto {
  @IsArray({ message: 'Send the applicants to review as a list of their ids.' })
  @ArrayMinSize(1, { message: 'Tick at least one applicant to accept or reject.' })
  @ArrayMaxSize(HIRING_BATCH_MAX, { message: `Accept or reject at most ${HIRING_BATCH_MAX} applicants at a time.` })
  @IsUUID('all', { each: true, message: 'Send each applicant as their application’s id.' })
  applicationIds: string[] = [];

  @IsIn(HIRING_SUGGESTIONS, { message: 'Choose Accept or Reject.' })
  decision!: HiringSuggestion;

  @IsOptional() @TrimOrNull() @IsString({ message: 'Write the note as text.' }) @MaxLength(SUGGESTION_NOTE_MAX, { message: `Keep the note to ${SUGGESTION_NOTE_MAX} characters or fewer.` })
  note?: string | null;
}
