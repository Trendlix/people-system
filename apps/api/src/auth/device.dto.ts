import { DEVICE_PLATFORMS, type DevicePlatform } from '@trendlix/shared';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Fingerprint sign-in in the app (owner, 20 October 2026: "Sign-in: Face ID / fingerprint after the first password
// sign-in"; apps/mobile/README.md, Phase 3): turning it on for the phone, and signing in with it.

/** POST /auth/devices: the phone the user is signed in on in the app, as it names itself. */
export class CreateDeviceDto {
  /** e.g. "Google Pixel 8"; kept tidied, at most 100 characters (an empty one is the platform's word). */
  @IsString()
  @MaxLength(200)
  deviceName: string;

  @IsIn(DEVICE_PLATFORMS, { message: 'Choose Android or iPhone.' })
  platform: DevicePlatform;
}

/** POST /auth/devices/sign-in: the credential the phone unlocked with the fingerprint. */
export class DeviceSignInDto {
  /** The credential's id (anything that isn't one is simply unknown: refused with a 401, like a wrong secret). */
  @IsString()
  @MaxLength(100)
  id: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  secret: string;

  /** The app's user agent, as the website saw it (the session is the app's whatever it says; kept with the session). */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  userAgent?: string;

  /** The person's IP address, as the website saw it: kept with the session, and counted for the limit on refusals. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ip?: string;
}
