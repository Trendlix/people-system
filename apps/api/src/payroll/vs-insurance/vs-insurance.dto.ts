import { IsOptional, Matches } from 'class-validator';
import { Trim } from '../../common/transforms.js';
import { MONTH } from '../months.js';

// The Payroll vs Social Insurance report (owner, 26 October 2026: "a comparison report between the actual payroll run and
// the social insurance data"): ?from=YYYY-MM&to=YYYY-MM, the latest run's month unless sent; with one of them only, that
// month alone (a month, or a range of months, as the Leave report takes it).

const MONTH_MESSAGE = 'Choose the months as YYYY-MM, e.g. 2026-01.';

export class VsInsuranceQueryDto {
  @Trim() @IsOptional() @Matches(MONTH, { message: MONTH_MESSAGE })
  from?: string;

  @Trim() @IsOptional() @Matches(MONTH, { message: MONTH_MESSAGE })
  to?: string;
}
