import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(1, { message: 'Enter your password.' })
  @MaxLength(200)
  password: string;

  /**
   * The browser's or the app's user agent, as the website saw it (it signs in on the person's behalf, so the API sees the
   * website's own): an app sign-in ends with "TrendLIXPeople" and starts an app session (see session-rules.ts). Without
   * it, the request's own.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  userAgent?: string;

  /** The person's IP address, as the website saw it; kept with the session to show where it was signed in. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ip?: string;
}
