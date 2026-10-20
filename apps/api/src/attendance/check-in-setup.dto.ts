import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNumber, IsObject, IsString, MaxLength, ValidateIf } from 'class-validator';
import { OFFICE_RADIUS_DEFAULT, OFFICE_RADIUS_MAX, OFFICE_RADIUS_MIN } from '@trendlix/shared';

// Attendance → Check-in Setup (owner, 20 October 2026: "Own page, several locations"; check-ins locked to the office
// network, the same day). The types here; what is wrong in words, from the shared checks (checkInLocationProblems,
// officeNetworksFrom), in the service.

/** Present (even as null) means "change it". */
const Sent = () => ValidateIf((_o, v) => v !== undefined);

const NAME = 'Name the location, e.g. Head office.';
const LATITUDE = "Enter the location's latitude from -90 to 90, e.g. 30.0596.";
const LONGITUDE = "Enter the location's longitude from -180 to 180, e.g. 31.3462.";
const RADIUS = `Enter the location's radius in whole metres from ${OFFICE_RADIUS_MIN} to ${OFFICE_RADIUS_MAX.toLocaleString('en-US')}, e.g. ${OFFICE_RADIUS_DEFAULT}.`;

/** A check-in location: its name, its point (up to 6 decimals are kept) and its radius, 150 metres unless sent. */
export class CreateCheckInLocationDto {
  @IsString({ message: NAME }) @MaxLength(500, { message: NAME })
  name: string;

  @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }, { message: LATITUDE })
  latitude: number;

  @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }, { message: LONGITUDE })
  longitude: number;

  @Sent() @Type(() => Number) @IsInt({ message: RADIUS })
  radiusMetres?: number;
}

/** A check-in location's changes: only what is sent. */
export class UpdateCheckInLocationDto {
  @Sent() @IsString({ message: NAME }) @MaxLength(500, { message: NAME })
  name?: string;

  @Sent() @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }, { message: LATITUDE })
  latitude?: number;

  @Sent() @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }, { message: LONGITUDE })
  longitude?: number;

  @Sent() @Type(() => Number) @IsInt({ message: RADIUS })
  radiusMetres?: number;
}

/**
 * The office networks, the whole list (each { label, range }: an IPv4 address, an IPv4 range or an IPv6 range), and the
 * switch "Lock check-ins to the office network". Switched on only with the key on both sides and at least one network.
 */
export class UpdateOfficeNetworksDto {
  @IsBoolean({ message: 'Send whether check-ins are locked to the office network as true or false.' })
  lock: boolean;

  @IsArray({ message: 'Send the office networks as a list.' })
  @ArrayMaxSize(100, { message: 'Enter at most 20 office networks.' })
  @IsObject({ each: true, message: 'Send each office network as its name and its address.' })
  networks: { label?: unknown; range?: unknown }[];
}

/**
 * The switch "Refuse check-ins and check-outs without a location" (owner, 20 October 2026: "Company switch +
 * exceptions"): on, a website press without a location is refused, unless HR exempts the person or it comes from an
 * office network the website signed.
 */
export class UpdateLocationRuleDto {
  @IsBoolean({ message: 'Send whether check-ins and check-outs without a location are refused as true or false.' })
  refuseWithoutLocation: boolean;
}
