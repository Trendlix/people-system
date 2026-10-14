import { ROLES, type Role } from '@trendlix/shared';
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
}

export class SetPasswordDto {
  @NewPassword()
  password: string;
}
