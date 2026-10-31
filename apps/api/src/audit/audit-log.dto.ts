import { AUDIT_MODULES, AUDIT_RESULTS, SIGN_IN_OUTCOMES, type AuditModule, type AuditResult, type SignInOutcome } from '@trendlix/shared';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { IsDateOnly } from '../common/date-only.js';

// The Audit Log's filters (owner, 19 October 2026: "an Audit Log page showing who changed what and when"), as the query
// of GET /audit and GET /audit/export: every one optional, an empty one as if not sent.

const EmptyIsUnset = () => Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : typeof value === 'string' ? value.trim() : value));

/** A whole number typed in the address ("2", or with Arabic digits). */
const NumberOf = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const typed = value.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
    return typed === '' ? undefined : Number(typed);
  });

/** An action or a kind of record as the log writes it: lower case and underscores, e.g. view_restricted. */
const KEY = /^[a-z][a-z_]{0,63}$/;

/** The entries per page unless asked: about fifty, the newest first. */
export const PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export class AuditQueryDto {
  /** From this day (Cairo), YYYY-MM-DD. */
  @EmptyIsUnset() @IsOptional() @IsDateOnly('Enter the first day, e.g. 2026-10-01.')
  from?: string;

  /** To this day (Cairo), YYYY-MM-DD, the whole day. */
  @EmptyIsUnset() @IsOptional() @IsDateOnly('Enter the last day, e.g. 2026-10-31.')
  to?: string;

  /** Who did it: the user, or the Super Admin who did it while viewing as someone. */
  @EmptyIsUnset() @IsOptional() @IsUUID('all', { message: 'Choose who did it.' })
  userId?: string;

  @EmptyIsUnset() @IsOptional() @Matches(KEY, { message: 'Choose an action from the list.' })
  action?: string;

  @EmptyIsUnset() @IsOptional() @Matches(KEY, { message: 'Choose a kind of record from the list.' })
  entityType?: string;

  /** One record, by its id. */
  @EmptyIsUnset() @IsOptional() @IsUUID('all', { message: 'Enter the record’s id as the system writes it, e.g. 0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e.' })
  entityId?: string;

  /** Everything about one person (an employee's History). */
  @EmptyIsUnset() @IsOptional() @IsUUID('all', { message: 'Choose the employee.' })
  employeeId?: string;

  /** Text anywhere in what changed, or the address or city it came from, whatever the case. */
  @EmptyIsUnset() @IsOptional() @IsString({ message: 'Search with one text.' }) @MaxLength(200, { message: 'Search with at most 200 characters.' })
  q?: string;

  /** The part of the system (31 October 2026): attendance, leave, payroll, assets, recruitment … */
  @EmptyIsUnset() @IsOptional() @IsIn(AUDIT_MODULES, { message: 'Choose a module from the list.' })
  module?: AuditModule;

  /** Succeeded or refused (31 October 2026). */
  @EmptyIsUnset() @IsOptional() @IsIn(AUDIT_RESULTS, { message: 'Choose Succeeded or Refused.' })
  result?: AuditResult;

  /** The page, 1 for the newest. */
  @NumberOf() @IsOptional() @IsInt({ message: 'Choose the page as a whole number, e.g. 2.' }) @Min(1, { message: 'Choose page 1 or later.' }) @Max(100000, { message: 'Choose an earlier page.' })
  page?: number;

  /** Entries per page: 50 unless asked, at most 100. */
  @NumberOf() @IsOptional() @IsInt({ message: `Show between 1 and ${MAX_PAGE_SIZE} entries a page.` }) @Min(1, { message: `Show between 1 and ${MAX_PAGE_SIZE} entries a page.` }) @Max(MAX_PAGE_SIZE, { message: `Show between 1 and ${MAX_PAGE_SIZE} entries a page.` })
  limit?: number;

  /** Only entries older than this one (its id): the page after it, for a caller paging by where it stopped. */
  @EmptyIsUnset() @IsOptional() @Matches(/^[1-9]\d{0,18}$/, { message: 'Send the id of the last entry seen, e.g. 1234.' })
  before?: string;
}

/**
 * The Sign-ins tab's filters (owner, 31 October 2026: "Every sign-in in its own tab … with its own filters"), as the
 * query of GET /audit/sign-ins and its export: the days, the outcome, and text in the email, the address or the
 * browser; paged as the log is.
 */
export class SignInsQueryDto {
  /** From this day (Cairo), YYYY-MM-DD. */
  @EmptyIsUnset() @IsOptional() @IsDateOnly('Enter the first day, e.g. 2026-10-01.')
  from?: string;

  /** To this day (Cairo), YYYY-MM-DD, the whole day. */
  @EmptyIsUnset() @IsOptional() @IsDateOnly('Enter the last day, e.g. 2026-10-31.')
  to?: string;

  @EmptyIsUnset() @IsOptional() @IsIn(SIGN_IN_OUTCOMES, { message: 'Choose an outcome from the list.' })
  outcome?: SignInOutcome;

  /** Text in the email, the address, the city or the browser, whatever the case. */
  @EmptyIsUnset() @IsOptional() @IsString({ message: 'Search with one text.' }) @MaxLength(200, { message: 'Search with at most 200 characters.' })
  q?: string;

  /** The page, 1 for the newest. */
  @NumberOf() @IsOptional() @IsInt({ message: 'Choose the page as a whole number, e.g. 2.' }) @Min(1, { message: 'Choose page 1 or later.' }) @Max(100000, { message: 'Choose an earlier page.' })
  page?: number;

  /** Entries per page: 50 unless asked, at most 100. */
  @NumberOf() @IsOptional() @IsInt({ message: `Show between 1 and ${MAX_PAGE_SIZE} entries a page.` }) @Min(1, { message: `Show between 1 and ${MAX_PAGE_SIZE} entries a page.` }) @Max(MAX_PAGE_SIZE, { message: `Show between 1 and ${MAX_PAGE_SIZE} entries a page.` })
  limit?: number;
}
