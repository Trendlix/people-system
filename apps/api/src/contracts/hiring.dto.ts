import { Type } from 'class-transformer';
import { IsObject, ValidateNested } from 'class-validator';
import { CreateEmploymentDto } from '../employees/employment.dto.js';
import { CreateContractDto } from './contracts.dto.js';

// Hiring in one form (owner's decision, 16 October 2026: "there is no point of adding employment then adding contract"):
// the employment and the terms of its first contract, in one request. Each part is checked as it is on its own, and
// the messages of both come back together.

export class HireDto {
  /** The job, as Add employment took it on its own. */
  @IsObject({ message: 'Send the employment as an object.' })
  @ValidateNested()
  @Type(() => CreateEmploymentDto)
  employment: CreateEmploymentDto;

  /** The first contract's terms, as New contract takes them. It starts on the join date, so a start date is left out. */
  @IsObject({ message: "Send the contract's terms as an object." })
  @ValidateNested()
  @Type(() => CreateContractDto)
  contract: CreateContractDto;
}
