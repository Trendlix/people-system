import { IsOptional, Matches } from 'class-validator';
import { Trim } from '../common/transforms.js';
import { MONTH } from '../payroll/months.js';

// Client hours (owner, 4 November 2026: "Full salary, hours tracked"): the month asked for.

export class ClientHoursQueryDto {
  /** The month, YYYY-MM; this month in Cairo when not sent. */
  @Trim() @IsOptional() @Matches(MONTH, { message: 'Choose the month as YYYY-MM, e.g. 2026-11.' })
  month?: string;
}
