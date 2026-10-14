import { applyDecorators } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

/** A password being set: a temporary one from an admin, or a person's own new one. */
export const NewPassword = (label = 'The password') =>
  applyDecorators(
    IsString(),
    MinLength(PASSWORD_MIN_LENGTH, { message: `${label} must be at least ${PASSWORD_MIN_LENGTH} characters.` }),
    MaxLength(PASSWORD_MAX_LENGTH, { message: `${label} must be at most ${PASSWORD_MAX_LENGTH} characters.` }),
  );

export class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: 'Enter your current password.' })
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @NewPassword('The new password')
  newPassword: string;
}
