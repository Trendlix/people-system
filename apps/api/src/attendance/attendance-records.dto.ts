import { DAY_SOURCE_CHOICES, RECORD_REASON_MAX, RECORD_SOURCES } from '@trendlix/shared';
import { IsIn, IsString, MaxLength } from 'class-validator';
import { IsDateOnly } from '../common/date-only.js';
import { Trim } from '../common/transforms.js';

// A person's attendance records (owner, 31 October 2026: "delete one of them" — "as a super admin"; "zoho or system";
// attendance-records.service.ts): the shapes; the reason's words, the month's lock and what is there are the service's.

/** ?date=YYYY-MM-DD: the day whose records are read. */
export class DayRecordsQueryDto {
  @Trim() @IsDateOnly('Choose the day, e.g. 2026-10-20.')
  date: string;
}

/** A record removed: its day, its source, its id as the day's records give it, and why. */
export class RemoveRecordDto {
  @Trim() @IsDateOnly('Choose the day, e.g. 2026-10-20.')
  date: string;

  @IsIn(RECORD_SOURCES, { message: 'Choose the record’s source: system or zoho.' })
  source: string;

  @Trim() @IsString({ message: 'Choose the record to remove.' }) @MaxLength(100, { message: 'Choose the record to remove.' })
  recordId: string;

  /** Why: required, at most 500 characters (the service says so in words). */
  @IsString({ message: 'Write why, e.g. A double press at the door.' }) @MaxLength(RECORD_REASON_MAX + 200, { message: `Keep the reason to ${RECORD_REASON_MAX} characters.` })
  reason: string;
}

/** The source a day with both uses, and why. */
export class ChooseDaySourceDto {
  @Trim() @IsDateOnly('Choose the day, e.g. 2026-10-20.')
  date: string;

  @IsIn(DAY_SOURCE_CHOICES, { message: 'Choose the source the day uses: zoho or system.' })
  source: string;

  @IsString({ message: 'Write why, e.g. The door reader missed the morning.' }) @MaxLength(RECORD_REASON_MAX + 200, { message: `Keep the reason to ${RECORD_REASON_MAX} characters.` })
  reason: string;
}
