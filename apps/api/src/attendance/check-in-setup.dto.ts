import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsNumber, IsObject, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { GPS_ROUGH_DEFAULT, GPS_ROUGH_MAX, GPS_ROUGH_MIN, LINK_PEOPLE_MAX, OFFICE_RADIUS_DEFAULT, OFFICE_RADIUS_MAX, OFFICE_RADIUS_MIN } from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';

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

  /** A client location's last day (24 October 2026), YYYY-MM-DD; null: no end. Sent for the office's: refused. */
  @ValidateIf((_o, v) => v !== undefined && v !== null) @IsDateOnly('Enter the date the client location lasts until, e.g. 2026-12-31.')
  validUntil?: string | null;
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

/**
 * The switch "Refuse Office staff's check-ins and check-outs outside the check-in locations" (owner, 24 October 2026:
 * "Yes, add a GPS lock too"), and the accuracy past which a reading is too rough, whole metres from 50 to 500.
 */
export class UpdateGpsLockDto {
  @IsBoolean({ message: 'Send whether Office staff’s check-ins are locked to the check-in locations as true or false.' })
  lock: boolean;

  @Sent() @Type(() => Number) @IsInt({ message: `Enter the accuracy past which a reading is too rough in whole metres from ${GPS_ROUGH_MIN} to ${GPS_ROUGH_MAX}, e.g. ${GPS_ROUGH_DEFAULT}.` })
  roughMetres?: number;
}

/**
 * The people linked to a sub-location in one go (owner, 20 October 2026: "shown with their name and linked users"): their
 * employee ids, 1 to 100; those already linked are left as they are.
 */
export class LinkPeopleDto {
  @IsArray({ message: 'Send the people to link as a list of their ids.' })
  @ArrayMinSize(1, { message: 'Choose at least one person to link.' })
  @ArrayMaxSize(LINK_PEOPLE_MAX, { message: `Link at most ${LINK_PEOPLE_MAX} people at a time.` })
  @IsUUID('all', { each: true, message: 'Send each person as their employee id.' })
  employeeIds: string[];
}
