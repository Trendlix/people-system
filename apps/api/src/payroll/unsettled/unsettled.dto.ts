import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { HOLD_RELEASE_METHODS, type HoldReleaseMethod } from '@trendlix/shared';
import { IsDateOnly } from '../../common/date-only.js';
import { Trim, TrimOrNull } from '../../common/transforms.js';
import { MAX_MONEY } from '../../contracts/contracts.dto.js';

// Unsettled (owner, 17 October 2026): a final settlement marked settled or reopened, held pay recorded as paid out.
// Dates: YYYY-MM-DD. Money: a number of EGP to the piaster. An empty note is no note.

const NOTE_LENGTH = 'Keep the note to 500 characters or fewer.';
const PAID_MESSAGE = 'Enter the amount paid in EGP, 0 or more, e.g. 18500.50.';

/** HR marks an ended employment's final settlement settled: the day, the amount paid, a note, the clearance if any. */
export class SettleFinalDto {
  @IsDateOnly('Enter the day the final dues were settled, as YYYY-MM-DD.')
  settledOn: string;

  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }, { message: PAID_MESSAGE })
  @Min(0, { message: PAID_MESSAGE })
  @Max(MAX_MONEY, { message: PAID_MESSAGE })
  amountPaid: number;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(500, { message: NOTE_LENGTH })
  note?: string | null;

  /** The "Clearance and dues" document generated for the ending (template slot clearance_dues). */
  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose the clearance and dues document.' })
  documentId?: string | null;
}

/** HR reopens one marked settled by mistake: why. */
export class ReopenFinalDto {
  @Trim() @IsString({ message: 'Say why it is reopened.' }) @MinLength(1, { message: 'Say why it is reopened.' }) @MaxLength(500, { message: NOTE_LENGTH })
  reason: string;
}

/** HR records held pay as paid out: the day, how, and a note. */
export class PaidOutDto {
  @IsDateOnly('Enter the day the held pay was paid out, as YYYY-MM-DD.')
  paidOn: string;

  @IsIn(HOLD_RELEASE_METHODS, { message: 'Choose how it was paid out: bank transfer, cash or with a later run.' })
  method: HoldReleaseMethod;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(500, { message: NOTE_LENGTH })
  note?: string | null;
}
