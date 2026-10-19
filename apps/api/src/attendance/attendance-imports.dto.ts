import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';

// Attendance imports (owner, 19 October 2026: Zoho People's attendance entries read on a draft payroll run). The files
// are a multipart upload (`files`, .xlsx, up to 60 of 5 MB each); HR's choice for a person is JSON.

/** Who a person of the files is: an employee HR picked or confirmed, none (back to the match by name), or skipped. */
export class AttendancePersonDto {
  /** The person's key in the import (their Zoho Employee Id, else their name as matched). */
  @IsString({ message: 'Send the person by their key.' }) @MinLength(1) @MaxLength(300)
  key: string;

  /** The employee they are; null: back to the match by name. Left out with `skipped`. */
  @ValidateIf((o: AttendancePersonDto) => o.employeeId !== undefined && o.employeeId !== null)
  @IsUUID('all', { message: 'Choose the employee from the list.' })
  employeeId?: string | null;

  /** Leave them out of the import. */
  @IsOptional() @IsBoolean({ message: 'Send whether the person is skipped as true or false.' })
  skipped?: boolean;
}
