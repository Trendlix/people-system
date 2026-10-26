import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';
import { EXEMPTION_PEOPLE_MAX } from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';

// People exempt from check-in (owner, 25 October 2026: "allow me to select people that are not eligable for attendance
// checkins and outs, trat them as if they achived their full working hours"). The types here; what is wrong in words,
// from the shared checks (exemptionInputProblems), in the service.

/** One reason and one period for one person (the profile) or several (Check-in Setup's "Add people"). */
export class AddCheckInExemptionsDto {
  @IsArray({ message: 'Send the people to exempt as a list of their ids.' })
  @ArrayMinSize(1, { message: 'Choose at least one person to exempt from check-in.' })
  @ArrayMaxSize(EXEMPTION_PEOPLE_MAX, { message: `Exempt at most ${EXEMPTION_PEOPLE_MAX} people at a time.` })
  @IsUUID('all', { each: true, message: 'Send each person as their employee id.' })
  employeeIds: string[];

  /** Required; checked in the service, so a blank one is told in words. */
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString({ message: 'Write why they are exempt from check-in.' })
  reason?: string | null;

  /** YYYY-MM-DD, for everyone; none: each their own when `ownStart`, else today. */
  @ValidateIf((_o, v) => v !== undefined && v !== null && v !== '')
  @IsDateOnly('Enter the first day of the exemption, e.g. 2026-11-01.')
  startDate?: string | null;

  /**
   * With no startDate: each person from their own first day, their contract's start, else their join date (owner, 26
   * October 2026: "auto fill his contract start date in the exempt from date"; CheckInExemptionsService.add).
   */
  @IsOptional()
  @IsBoolean({ message: 'Send whether each person starts on their own start date as true or false.' })
  ownStart?: boolean;

  /** YYYY-MM-DD; none: no end. */
  @ValidateIf((_o, v) => v !== undefined && v !== null && v !== '')
  @IsDateOnly('Enter the last day of the exemption, e.g. 2026-11-30, or leave it empty for no end date.')
  endDate?: string | null;
}
