import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

// What the Access tab, the Employees list and the public set-password pages send (owner, 22 October 2026: "any active
// employee with active contract should have access"; packages/shared employee-access.ts).

export class SignInEmailDto {
  @IsIn(['work', 'personal'], { message: 'Choose their work email or their personal email.' })
  choice!: 'work' | 'personal';
}

export class AccessLinkDto {
  /** email: sent by email (SMTP set up); copy: the link comes back once, to send by hand. */
  @IsIn(['email', 'copy'], { message: 'Choose to email the link or to copy it.' })
  mode!: 'email' | 'copy';
}

export class InvitationsDto {
  @IsOptional()
  @IsArray({ message: 'Send the people to invite as a list.' })
  @ArrayMaxSize(500, { message: 'Invite at most 500 people at once.' })
  @IsUUID('all', { each: true, message: 'Choose people from the list.' })
  employeeIds?: string[];

  @IsOptional()
  @IsBoolean()
  allNotInvited?: boolean;
}

export class CheckPasswordLinkDto {
  @IsString({ message: 'This link doesn’t work.' })
  @MaxLength(100)
  token!: string;
}

export class SetPasswordWithLinkDto {
  @IsString({ message: 'This link doesn’t work.' })
  @MaxLength(100)
  token!: string;

  @IsString({ message: 'Choose a password.' })
  @MaxLength(200)
  password!: string;
}

export class ForgotPasswordDto {
  @IsString({ message: 'Enter your sign-in email.' })
  @MaxLength(254)
  email!: string;
}
