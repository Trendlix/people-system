import {
  HOME_COMMENT_MAX,
  HOME_DECISIONS,
  HOME_LABEL_MAX,
  HOME_RADIUS_DEFAULT,
  HOME_RADIUS_MAX,
  HOME_RADIUS_MIN,
  HOME_STATUSES,
  HOME_TYPES,
  LOCATION_ASK_RADIUS_MAX,
  LOCATION_ASK_RADIUS_MIN,
  LOCATION_REASON_MAX,
  LOCATION_VALIDITIES,
  type HomeDecision,
  type HomeStatus,
  type HomeType,
  type LocationValidity,
} from '@trendlix/shared';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateIf } from 'class-validator';
import { IsDateOnly } from '../common/date-only.js';
import { TrimOrNull } from '../common/transforms.js';

// Home locations (owner, 20 October 2026: "allow other users to request to add their home locations when working from
// home"; packages/shared home-locations.ts): the shapes here; what is wrong in words (the point, the label, the radius)
// from the shared checks, in the service. Since 24 October 2026 (owner: "(Home Location - Remote Site - Client Location)
// with a comment reason"): the type, the reason, the radius asked and the end date wished; the validity at HR's step and
// later.

const NUMBER = { allowNaN: false, allowInfinity: false } as const;
const POINT = 'Put your home on the map, or use your current location while at home.';
const RADIUS = `Enter the radius in whole metres from ${HOME_RADIUS_MIN} to ${HOME_RADIUS_MAX.toLocaleString('en-US')}, e.g. ${HOME_RADIUS_DEFAULT}.`;
const COMMENT = `Keep the comment to ${HOME_COMMENT_MAX} characters or fewer.`;

/** The employee's own request: the home's point (6 decimals are kept), the reading's accuracy when read on the device, and a label. */
export class CreateHomeLocationDto {
  @IsOptional() @Type(() => Number) @IsNumber(NUMBER, { message: POINT })
  latitude?: number | null;

  @IsOptional() @Type(() => Number) @IsNumber(NUMBER, { message: POINT })
  longitude?: number | null;

  /** Metres; none: the point was put on the map. */
  @IsOptional() @Type(() => Number) @IsNumber(NUMBER, { message: 'The location’s accuracy could not be read.' }) @Min(0, { message: 'The location’s accuracy could not be read.' })
  accuracy?: number | null;

  @TrimOrNull() @IsOptional() @IsString({ message: 'Write the label as text, e.g. Home, Nasr City.' }) @MaxLength(HOME_LABEL_MAX, { message: `Keep the label to ${HOME_LABEL_MAX} characters or fewer.` })
  label?: string | null;

  /** Home Location, Remote Site or Client Location (24 October 2026); none: a home asked as before (no reason needed). */
  @IsOptional() @IsIn(HOME_TYPES, { message: 'Choose the type: home location, remote site or client location.' })
  type?: HomeType;

  /** Why they need it (required with a type). */
  @TrimOrNull() @IsOptional() @IsString({ message: 'Write the reason as text.' }) @MaxLength(LOCATION_REASON_MAX, { message: `Keep the reason to ${LOCATION_REASON_MAX.toLocaleString('en-US')} characters or fewer.` })
  reason?: string | null;

  /** Whole metres from 25 to 500; none: 100. */
  @IsOptional() @Type(() => Number) @IsInt({ message: `Enter the radius in whole metres from ${LOCATION_ASK_RADIUS_MIN} to ${LOCATION_ASK_RADIUS_MAX}, e.g. ${HOME_RADIUS_DEFAULT}.` })
  radiusMetres?: number | null;

  /** A remote site's or a client location's end date wished, YYYY-MM-DD. */
  @ValidateIf((_o, v) => v !== undefined && v !== null && v !== '') @IsDateOnly('Enter the end date you wish as a date, e.g. 2026-12-31.')
  wishedEndDate?: string | null;
}

/** A stage's decision: approve or reject (a comment required to reject); at HR's step, the radius HR approves it with. */
export class DecideHomeLocationDto {
  @IsIn(HOME_DECISIONS, { message: 'Choose approve or reject.' })
  decision: HomeDecision;

  @TrimOrNull() @IsOptional() @IsString({ message: 'Write a comment.' }) @MaxLength(HOME_COMMENT_MAX, { message: COMMENT })
  comment?: string | null;

  /** HR's step only: whole metres; none: as asked. */
  @IsOptional() @Type(() => Number) @IsInt({ message: RADIUS })
  radiusMetres?: number | null;

  /** HR's step only (24 October 2026): until a date (with `validUntil`), until the contract ends, or (a client location) no end; none: the type's default. */
  @IsOptional() @IsIn(LOCATION_VALIDITIES, { message: 'Choose how long it lasts: until a date, until the contract ends, or no end.' })
  validity?: LocationValidity | null;

  @ValidateIf((_o, v) => v !== undefined && v !== null && v !== '') @IsDateOnly('Enter the date it lasts until, e.g. 2026-12-31.')
  validUntil?: string | null;
}

/** An approved home's or remote site's validity changed by HR (24 October 2026), with a comment if they give one. */
export class SetLocationValidityDto {
  @IsIn(LOCATION_VALIDITIES, { message: 'Choose how long it lasts: until a date or until the contract ends.' })
  validity: LocationValidity;

  @ValidateIf((_o, v) => v !== undefined && v !== null && v !== '') @IsDateOnly('Enter the date it lasts until, e.g. 2026-12-31.')
  validUntil?: string | null;

  @TrimOrNull() @IsOptional() @IsString({ message: 'Write a comment.' }) @MaxLength(HOME_COMMENT_MAX, { message: COMMENT })
  comment?: string | null;
}

/** HR (the CEO, the Super Admin) removing an approved home: why, if they say. */
export class RemoveHomeLocationDto {
  @TrimOrNull() @IsOptional() @IsString({ message: 'Write a comment.' }) @MaxLength(HOME_COMMENT_MAX, { message: COMMENT })
  comment?: string | null;
}

/** ?status=<a status, waiting (for the caller) or open>&employeeId=: all unless sent. */
export class ListHomeLocationsDto {
  @IsOptional() @IsIn([...HOME_STATUSES, 'waiting', 'open'], { message: `Choose a status: waiting, open, ${HOME_STATUSES.join(', ')}.` })
  status?: HomeStatus | 'waiting' | 'open';

  @IsOptional() @IsUUID('all', { message: 'Choose the employee.' })
  employeeId?: string;

  /** Home Location, Remote Site or Client Location (24 October 2026). */
  @IsOptional() @IsIn(HOME_TYPES, { message: `Choose a type: ${HOME_TYPES.join(', ')}.` })
  type?: HomeType;
}
