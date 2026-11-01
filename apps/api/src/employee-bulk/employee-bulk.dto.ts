import { EMPLOYEE_BULK_ACTIONS, EMPLOYEE_BULK_MAX, EMPLOYEE_BULK_MESSAGE_LIMITS, type EmployeeBulkAction } from '@trendlix/shared';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { TrimOrNull } from '../common/transforms.js';

// What the Employees list's bulk actions send (owner, 1 November 2026: "i want to select and create bulk actions"). The
// shapes are checked here, what each action needs by packages/shared employeeBulkProblems in the service.

export class EmployeeBulkDto {
  @IsIn(EMPLOYEE_BULK_ACTIONS, { message: 'Choose an action.' })
  action!: EmployeeBulkAction;

  @IsArray({ message: 'Choose people from the list.' })
  @ArrayMinSize(1, { message: 'Choose at least one person.' })
  @ArrayMaxSize(EMPLOYEE_BULK_MAX, { message: `Choose at most ${EMPLOYEE_BULK_MAX} people at once.` })
  @IsUUID('all', { each: true, message: 'Choose people from the list.' })
  employeeIds!: string[];

  @IsOptional() @IsString() @MaxLength(500)
  reason?: string | null;

  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose a manager.' })
  managerId?: string | null;

  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose a department or team.' })
  departmentId?: string | null;

  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose a shift.' })
  shiftId?: string | null;

  @IsOptional() @IsBoolean({ message: 'Choose on or off.' })
  on?: boolean;

  @IsOptional() @IsString() @MaxLength(EMPLOYEE_BULK_MESSAGE_LIMITS.title, { message: `Keep the title to ${EMPLOYEE_BULK_MESSAGE_LIMITS.title} characters.` })
  title?: string | null;

  @IsOptional() @IsString() @MaxLength(EMPLOYEE_BULK_MESSAGE_LIMITS.body, { message: `Keep the message to ${EMPLOYEE_BULK_MESSAGE_LIMITS.body} characters.` })
  body?: string | null;

  @IsOptional() @IsBoolean()
  email?: boolean;
}
