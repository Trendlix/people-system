import { IsOptional, IsString, IsUUID, Matches, ValidateIf } from 'class-validator';

// Recount past days (owner, 26 October 2026): From and To as months (YYYY-MM), optionally one shift. The range (at most
// 12 months, up to this month) is checked in the service, in words.
export class RecountDaysDto {
  @IsString({ message: 'Choose the first month to recount.' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Choose the first month to recount, e.g. 2026-09.' })
  from: string;

  @IsString({ message: 'Choose the last month to recount.' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Choose the last month to recount, e.g. 2026-10.' })
  to: string;

  /** One shift; none: everyone. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID('all', { message: 'Send the shift as its id, or leave it out for everyone.' })
  shiftId?: string | null;
}
