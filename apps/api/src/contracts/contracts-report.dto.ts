import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import {
  CONTRACT_FORMS,
  CONTRACTS_REPORT_SHOWS,
  CONTRACTS_REPORT_STATUSES,
  EMPLOYMENT_TYPES,
  type ContractForm,
  type ContractsReportShow,
  type ContractsReportStatus,
  type EmploymentType,
} from '@trendlix/shared';
import { EMPLOYMENT_TYPE_MESSAGE } from '../employees/employment.dto.js';
import { EmptyIsUnset, EndingWithinDays, FORM_MESSAGE, SEARCH_LENGTH_MESSAGE, SEARCH_MESSAGE } from './contracts.dto.js';
import { SalaryRaisesQueryDto } from './raises.dto.js';

/**
 * The Contracts report's filters (owner, 25 October 2026: "A report under Reports", "Dates and status"), every one
 * optional: the period as the Salary Raises report takes it (?from=YYYY-MM&to=YYYY-MM, this calendar year in Cairo
 * unless sent), and the Contracts page's filters (?q=, ?form=, ?type=, ?endingWithin=), with a status of its own
 * (Signed unless sent), the department or team, and what to show.
 */
export class ContractsReportQueryDto extends SalaryRaisesQueryDto {
  /** signed (active, ended and superseded: the default), active, draft, ended, superseded or all. */
  @EmptyIsUnset()
  @IsOptional()
  @IsIn(CONTRACTS_REPORT_STATUSES, { message: 'Choose a status: signed (active, ended and superseded), active, draft, ended, superseded or all.' })
  status?: ContractsReportStatus;

  /** latest (one row per employment: the default) or every (every version). */
  @EmptyIsUnset() @IsOptional() @IsIn(CONTRACTS_REPORT_SHOWS, { message: 'Choose what to show: latest (the latest version per employment) or every (every version).' })
  show?: ContractsReportShow;

  /** The employee's name (English or Arabic), employee code or the contract number; case doesn't matter. */
  @EmptyIsUnset() @IsOptional() @IsString({ message: SEARCH_MESSAGE }) @MaxLength(100, { message: SEARCH_LENGTH_MESSAGE })
  q?: string;

  /** The contract's length: fixed, open_ended or specific_job. */
  @EmptyIsUnset() @IsOptional() @IsIn(CONTRACT_FORMS, { message: FORM_MESSAGE })
  form?: ContractForm;

  /** The employment's type. */
  @EmptyIsUnset() @IsOptional() @IsIn(EMPLOYMENT_TYPES, { message: EMPLOYMENT_TYPE_MESSAGE })
  type?: EmploymentType;

  /** A department (with its teams) or a team. */
  @EmptyIsUnset() @IsOptional() @IsUUID('all', { message: 'Choose the department or team from the list.' })
  departmentId?: string;

  /** Active contracts that end within this many days of today, those already past their end included. */
  @EndingWithinDays()
  endingWithin?: number;
}
