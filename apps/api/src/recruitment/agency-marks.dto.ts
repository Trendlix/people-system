import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../common/transforms.js';

// A company HR marks a marketing agency, or not one (owner, 27 October 2026: "Name words + your list").

const COMPANY = 'Write the company’s name, e.g. Publicis Egypt.';

export class SetAgencyMarkDto {
  @Trim() @IsString({ message: COMPANY }) @MinLength(2, { message: COMPANY }) @MaxLength(200, { message: 'Keep the company’s name to 200 characters or fewer.' })
  company: string = '';

  /** True: a marketing agency; false: not one, whatever its name says. */
  @IsBoolean({ message: 'Say whether it is a marketing agency: true or false.' })
  agency: boolean;
}
