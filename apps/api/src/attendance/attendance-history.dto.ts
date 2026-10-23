import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { HISTORY_FILTERS, HISTORY_PERIODS, type HistoryFilter, type HistoryPeriod } from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';

// A person's attendance history (owner, 23 October 2026: "Attendance history on the profile"; packages/shared
// attendance-history.ts): ?period=this_month|last_3_months|this_year|since_joining|custom (this month unless sent), a
// custom range's from and to, the log's filter and page.

export class AttendanceHistoryQueryDto {
  @IsOptional() @IsIn(HISTORY_PERIODS, { message: `Choose the period: ${HISTORY_PERIODS.join(', ')}.` })
  period?: HistoryPeriod;

  @IsOptional() @IsDateOnly('Enter the first day of the range, e.g. 2026-01-01.')
  from?: string;

  @IsOptional() @IsDateOnly('Enter the last day of the range, e.g. 2026-06-30.')
  to?: string;

  @IsOptional() @IsIn(HISTORY_FILTERS, { message: `Choose what the log shows: ${HISTORY_FILTERS.join(', ')}.` })
  only?: HistoryFilter;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'Choose the page as a whole number, e.g. 2.' }) @Min(1, { message: 'Choose the page as a whole number, e.g. 2.' }) @Max(10_000, { message: 'Choose the page as a whole number, e.g. 2.' })
  page?: number;
}
