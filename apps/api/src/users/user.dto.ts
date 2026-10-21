import { ASSETS_ACCESS_LEVELS, ROLES, type AssetsAccess, type Role } from '@trendlix/shared';
import { Transform } from 'class-transformer';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, MaxLength } from 'class-validator';
import { NewPassword } from '../auth/password.dto.js';

// Sign-in emails are kept in lower case, so "Ahmed@TrendLIX.com" and "ahmed@trendlix.com" are the same account.
const Email = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));
const ROLE_MESSAGE = `Each role must be one of: ${ROLES.join(', ')}.`;

export class CreateUserDto {
  @Email()
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email: string;

  /** Temporary: the admin passes it on, and the person changes it after signing in. */
  @NewPassword()
  password: string;

  @IsArray()
  @ArrayNotEmpty({ message: 'Choose at least one role.' })
  @ArrayUnique({ message: 'Choose each role only once.' })
  @IsIn(ROLES, { each: true, message: ROLE_MESSAGE })
  roles: Role[];
}

// Send only what changes. The email cannot be changed.
export class UpdateUserDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty({ message: 'Choose at least one role.' })
  @ArrayUnique({ message: 'Choose each role only once.' })
  @IsIn(ROLES, { each: true, message: ROLE_MESSAGE })
  roles?: Role[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * Their Assets access (owner, 21 October 2026: "3 levels per user"): none, viewer, custodian or manager. A Super Admin
   * is a manager whatever is set; the CEO and Finance are at least viewers (packages/shared assetsAccessOf).
   */
  @IsOptional()
  @IsIn(ASSETS_ACCESS_LEVELS, { message: `Choose the Assets access: ${ASSETS_ACCESS_LEVELS.join(', ')}.` })
  assetsAccess?: AssetsAccess;
}

export class SetPasswordDto {
  @NewPassword()
  password: string;
}
