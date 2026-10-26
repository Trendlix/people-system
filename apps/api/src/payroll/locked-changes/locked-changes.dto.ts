import { IsOptional, IsString, MaxLength } from 'class-validator';
import { TrimOrNull } from '../../common/transforms.js';

// A leave or attendance change made after the month's payroll moved on, marked handled by HR (27 October 2026): an
// optional note, e.g. the month it was corrected on. An empty note is no note.

export class HandleLockedChangeDto {
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(500, { message: 'Keep the note to 500 characters or fewer.' })
  note?: string | null;
}
