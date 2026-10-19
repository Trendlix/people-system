import { CHECK_IN_LOCATION_ERRORS, PUNCH_KINDS, type CheckInLocationError, type PunchKind } from '@trendlix/shared';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';

// A press of Check in or Check out (owner, 19 October 2026: "Check-in through the system (phone or web with the office
// location check …)"): in or out, and what the browser read of where it is, its point and accuracy in metres, or why
// it couldn't (refused, unavailable, too slow). Never a time: the server's is the punch's. The point is read to tell
// office from remote and dropped, never kept.

export class PunchDto {
  @IsIn(PUNCH_KINDS, { message: 'Choose to check in or check out.' })
  kind: PunchKind;

  @IsOptional() @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'The location could not be read.' }) @Min(-90, { message: 'The location could not be read.' }) @Max(90, { message: 'The location could not be read.' })
  latitude?: number | null;

  @IsOptional() @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'The location could not be read.' }) @Min(-180, { message: 'The location could not be read.' }) @Max(180, { message: 'The location could not be read.' })
  longitude?: number | null;

  @IsOptional() @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'The location could not be read.' }) @Min(0, { message: 'The location could not be read.' })
  accuracy?: number | null;

  /** Why there is no point: refused, unavailable, too slow (the browser's), or not asked (a browser without it). */
  @IsOptional() @IsIn(CHECK_IN_LOCATION_ERRORS, { message: `Say why the location is missing: ${CHECK_IN_LOCATION_ERRORS.join(', ')}.` })
  locationError?: CheckInLocationError | null;
}
