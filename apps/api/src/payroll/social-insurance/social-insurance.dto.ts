import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { SI_REGISTER_STATUSES, type SiRegisterStatus } from '@trendlix/shared';
import { EmptyIsUnset } from '../../contracts/contracts.dto.js';
import { MONTH } from '../months.js';

// The Social Insurance report's filters (owner, 27 October 2026: "is there a report for the social insurance? to be
// filled from the social insurance tab"; he chose all three views, the register filtered "by department and status"),
// every one optional: ?departmentId= on each view (a department with its teams, or a team), ?status= on the register
// (current employees unless sent), ?month=YYYY-MM on the contributions (this month in Cairo unless sent).

const DEPARTMENT_MESSAGE = 'Choose the department or team from the list.';

export class SiDepartmentQueryDto {
  /** A department (with its teams) or a team. */
  @EmptyIsUnset() @IsOptional() @IsUUID('all', { message: DEPARTMENT_MESSAGE })
  departmentId?: string;
}

export class SiRegisterQueryDto extends SiDepartmentQueryDto {
  /** current (the default), active, probation, on_leave, notice_period, former (the leavers) or all. */
  @EmptyIsUnset()
  @IsOptional()
  @IsIn(SI_REGISTER_STATUSES, { message: 'Choose a status: current, active, probation, on_leave, notice_period, former (the leavers) or all.' })
  status?: SiRegisterStatus;
}

export class SiContributionsQueryDto extends SiDepartmentQueryDto {
  @EmptyIsUnset() @IsOptional() @Matches(MONTH, { message: 'Choose the month as YYYY-MM, e.g. 2026-10.' })
  month?: string;
}
