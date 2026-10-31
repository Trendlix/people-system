import { IsOptional, IsString, MaxLength } from 'class-validator';

// Signing in with a code by email (owner, 31 October 2026: "and i can add OTP via Mail for app login"; packages/shared
// login-codes.ts): the shapes only; what the email and the code must be is the service's to say.

/** POST /auth/email-code: the email to send a code to. */
export class EmailCodeDto {
  @IsString({ message: 'Enter your sign-in email.' })
  @MaxLength(254)
  email!: string;
}

/** POST /auth/email-code/sign-in: the email and its code; the website passes on the person's user agent and address. */
export class EmailCodeSignInDto {
  @IsString({ message: 'Enter your sign-in email.' })
  @MaxLength(254)
  email!: string;

  /** The 6 digits from the email (spaces, and Arabic-Indic digits, taken). */
  @IsString({ message: 'Enter the 6-digit code from the email.' })
  @MaxLength(20)
  code!: string;

  /** The browser's or the app's user agent, as the website saw it (as LoginDto's): an app's starts an app session. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  userAgent?: string;

  /** The person's IP address, as the website saw it. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ip?: string;
}
