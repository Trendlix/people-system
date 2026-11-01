import { PING_OFF_REASONS, type PingOffReason } from '@trendlix/shared';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';

// An hourly location ping from the app while checked in (owner, 1 November 2026: "can the devices ping every 1 hour
// their location?"): the point read in the background, or why there is none.

export class LocationPingDto {
  @IsOptional() @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-90) @Max(90)
  latitude?: number | null;

  @IsOptional() @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-180) @Max(180)
  longitude?: number | null;

  @IsOptional() @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0)
  accuracy?: number | null;

  @IsOptional() @IsBoolean()
  mock?: boolean | null;

  /** No point: the app isn't allowed the location all the time, or the phone's location is off. */
  @IsOptional() @IsIn(PING_OFF_REASONS)
  off?: PingOffReason | null;
}

/** PUT /attendance/check-in-setup/location-pings: the company's switch. */
export class LocationPingsSettingDto {
  @IsBoolean({ message: 'Say whether the app reads the location every hour while checked in, as true or false.' })
  enabled!: boolean;
}
