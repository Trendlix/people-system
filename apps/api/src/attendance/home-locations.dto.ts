import { HOME_COMMENT_MAX, HOME_DECISIONS, HOME_LABEL_MAX, HOME_RADIUS_DEFAULT, HOME_RADIUS_MAX, HOME_RADIUS_MIN, HOME_STATUSES, type HomeDecision, type HomeStatus } from '@trendlix/shared';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { TrimOrNull } from '../common/transforms.js';

// Home locations (owner, 20 October 2026: "allow other users to request to add their home locations when working from
// home"; packages/shared home-locations.ts): the shapes here; what is wrong in words (the point, the label, the radius)
// from the shared checks, in the service.

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
}
