import { IsOptional, IsUUID } from 'class-validator';
import { EmptyIsUnset } from '../contracts/contracts.dto.js';
import { SalaryRaisesQueryDto } from '../contracts/raises.dto.js';

/**
 * The Leave report's filters (owner, 26 October 2026: "A month, or a range"), every one optional: the period as the
 * payroll reports take it (?from=YYYY-MM&to=YYYY-MM), this month in Cairo unless sent (one of them alone is that month),
 * a department (with its teams) or a team, and one employee.
 */
export class LeaveReportQueryDto extends SalaryRaisesQueryDto {
  /** A department (with its teams) or a team. */
  @EmptyIsUnset() @IsOptional() @IsUUID('all', { message: 'Choose the department or team from the list.' })
  departmentId?: string;

  /** One employee. */
  @EmptyIsUnset() @IsOptional() @IsUUID('all', { message: 'Choose the employee from the list.' })
  employeeId?: string;
}
