import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';

// Importing leave (owner, 21 October 2026: "how to import bulk leaves?"): the file is a multipart upload (`file`, .xlsx);
// HR's choices on the review are JSON.

/** Who a person of the file is: an employee HR picked or confirmed, none (back to the match), or skipped. */
export class LeaveImportPersonDto {
  /** The person's key in the import (their code, Zoho id or name as matched). */
  @IsString({ message: 'Send the person by their key.' }) @MinLength(1) @MaxLength(300)
  key: string;

  /** The employee they are; null: back to the match by code or name. Left out with `skipped`. */
  @ValidateIf((o: LeaveImportPersonDto) => o.employeeId !== undefined && o.employeeId !== null)
  @IsUUID('all', { message: 'Choose the employee from the list.' })
  employeeId?: string | null;

  /** Leave them out of the import. */
  @IsOptional() @IsBoolean({ message: 'Send whether the person is skipped as true or false.' })
  skipped?: boolean;
}

/**
 * A Zoho leave type's mapping: the system's type it is imported as, work-from-home days (`wfh`; owner, 21 October 2026:
 * "Yes, as approved WFH days"), official duty days (`od`; 26 October 2026), skipped, or back to the default (none sent).
 */
export class LeaveImportTypeDto {
  /** Zoho's leave type as the file writes it. */
  @IsString({ message: 'Send the Zoho leave type.' }) @MinLength(1) @MaxLength(200)
  zohoType: string;

  @ValidateIf((o: LeaveImportTypeDto) => o.typeId !== undefined && o.typeId !== null)
  @IsUUID('all', { message: 'Choose a leave type from the list.' })
  typeId?: string | null;

  @IsOptional() @IsBoolean({ message: 'Send whether the type is skipped as true or false.' })
  skipped?: boolean;

  /** Its rows imported as work-from-home days, not leave. */
  @IsOptional() @IsBoolean({ message: 'Send whether the rows are work-from-home days as true or false.' })
  wfh?: boolean;

  /** Its rows imported as official duty, not leave. */
  @IsOptional() @IsBoolean({ message: 'Send whether the rows are official duty days as true or false.' })
  od?: boolean;
}
