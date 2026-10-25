import { INTERVIEW_HOURS_LIMITS, INTERVIEW_KINDS, INTERVIEW_LIMITS, type HoursChange, type InterviewKind, type WeeklyWindow } from '@trendlix/shared';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';

// What the interview hours pages and "Find a time" send (owner, 25 October 2026: "Hours + calendar"; "HR only"). The
// shapes are checked here; the rules (the ranges on the quarter hour, the one-off changes, the notice and buffer only
// stricter than the company's, the days to look in) by packages/shared interview-availability.ts in the services, every
// problem in words. The ranges and changes are lists of plain objects: the service keeps only their known fields.

/** PUT /interview-hours/settings: the company's defaults. */
export class InterviewDefaultsDto {
  @IsInt({ message: 'Give the minimum notice in whole hours.' }) @Min(0, { message: 'Give the minimum notice in whole hours.' }) @Max(INTERVIEW_HOURS_LIMITS.noticeHoursMax, { message: 'The minimum notice is two weeks at most.' })
  noticeHours!: number;

  @IsInt({ message: 'Give the buffer in minutes.' }) @Min(0, { message: 'Give the buffer in minutes.' }) @Max(INTERVIEW_HOURS_LIMITS.bufferMinutesMax, { message: 'The buffer is two hours at most.' })
  bufferMinutes!: number;
}

/** PUT /me/interview-hours and /interview-hours/people/:employeeId: someone's hours (no ranges and no changes: none). */
export class InterviewHoursDto {
  @IsArray({ message: 'Give the weekly hours (none is fine).' }) @ArrayMaxSize(7 * INTERVIEW_HOURS_LIMITS.rangesPerDay, { message: 'Give each day at most 4 ranges.' })
  windows!: WeeklyWindow[];

  @IsArray({ message: 'Give the one-off changes as a list (none is fine).' }) @ArrayMaxSize(INTERVIEW_HOURS_LIMITS.changes, { message: `Keep to ${INTERVIEW_HOURS_LIMITS.changes} one-off changes.` })
  changes!: HoursChange[];

  @IsString({ message: 'Give the day the weekly hours count from.' }) @MaxLength(10)
  effectiveFrom!: string;

  @ValidateIf((_o, v) => v !== null && v !== undefined) @IsInt({ message: 'Give the notice in whole hours, or leave the company’s.' })
  noticeHours?: number | null;

  @ValidateIf((_o, v) => v !== null && v !== undefined) @IsInt({ message: 'Give the buffer in minutes, or leave the company’s.' })
  bufferMinutes?: number | null;
}

/** POST /recruitment/availability: "Find a time". */
export class AvailabilityDto {
  @IsArray({ message: 'Choose who interviews them first.' }) @ArrayMaxSize(INTERVIEW_LIMITS.interviewers, { message: `Choose at most ${INTERVIEW_LIMITS.interviewers} interviewers.` }) @IsUUID('all', { each: true, message: 'Choose the interviewers from the list.' })
  interviewerIds!: string[];

  @IsInt({ message: 'Choose the length: 30, 45, 60 or 90 minutes.' })
  minutes!: number;

  @IsIn(INTERVIEW_KINDS, { message: 'Choose how it is held: in person, online or by phone.' })
  kind!: InterviewKind;

  @IsString({ message: 'Choose the first day to look in.' }) @MaxLength(10)
  from!: string;

  @IsString({ message: 'Choose the last day to look in.' }) @MaxLength(10)
  to!: string;

  /** On a move: the interview moved, left out of their booked ones. */
  @IsOptional() @IsUUID('all', { message: 'The interview could not be read.' })
  interviewId?: string | null;
}

/** POST /recruitment/availability/check: a time typed by hand. */
export class TimeCheckDto {
  @IsArray({ message: 'Choose who interviews them first.' }) @ArrayMaxSize(INTERVIEW_LIMITS.interviewers, { message: `Choose at most ${INTERVIEW_LIMITS.interviewers} interviewers.` }) @IsUUID('all', { each: true, message: 'Choose the interviewers from the list.' })
  interviewerIds!: string[];

  @IsString({ message: 'Choose the day of the interview.' }) @MaxLength(10)
  date!: string;

  /** HH:mm, 24 hours, in Cairo. */
  @IsString({ message: 'Choose the time of the interview.' }) @MaxLength(5)
  time!: string;

  @IsInt({ message: 'Give its length in minutes.' }) @Min(INTERVIEW_LIMITS.minutesMin, { message: 'An interview takes 15 minutes at least.' }) @Max(INTERVIEW_LIMITS.minutesMax, { message: 'An interview takes 8 hours at most.' })
  minutes!: number;

  @IsIn(INTERVIEW_KINDS, { message: 'Choose how it is held: in person, online or by phone.' })
  kind!: InterviewKind;

  @IsOptional() @IsUUID('all', { message: 'The interview could not be read.' })
  interviewId?: string | null;
}
