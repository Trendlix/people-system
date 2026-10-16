import { IsOptional, Matches } from 'class-validator';
import { Trim } from '../../common/transforms.js';
import { MONTH } from '../months.js';

// Payroll statistics (owner, 17 October 2026): ?from=YYYY-MM&to=YYYY-MM, this calendar year unless sent; with one only,
// that month's year from January, or to December (packages/shared requestedPeriod, as the Salary Raises report).

const MONTH_MESSAGE = 'Choose the months as YYYY-MM, e.g. 2026-01.';

export class StatisticsQueryDto {
  @Trim() @IsOptional() @Matches(MONTH, { message: MONTH_MESSAGE })
  from?: string;

  @Trim() @IsOptional() @Matches(MONTH, { message: MONTH_MESSAGE })
  to?: string;
}
