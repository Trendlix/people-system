import { Transform, Type } from 'class-transformer';
import { IsObject, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { IsDateOnly } from '../common/date-only.js';
import { TrimOrNull } from '../common/transforms.js';

// Generating a document from a template (the profile's Employment tab). Dates: YYYY-MM-DD.

/** A query value sent empty counts as not sent. */
const EmptyIsUnset = () => Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : typeof value === 'string' ? value.trim() : value));

/** What is typed when generating: who a letter is addressed to and what it is for. */
export class DocumentInputsDto {
  @TrimOrNull() @IsOptional() @IsString({ message: 'Type who the letter is addressed to.' }) @MaxLength(200, { message: 'Keep "Addressed to" to 200 characters or fewer.' })
  letter_to?: string | null;

  @TrimOrNull() @IsOptional() @IsString({ message: 'Type the purpose of the letter.' }) @MaxLength(300, { message: 'Keep the purpose of the letter to 300 characters or fewer.' })
  letter_purpose?: string | null;
}

export class GenerateDocumentDto {
  @IsString({ message: 'Choose the document to generate.' })
  slotKey: string;

  /** A contract slot's contract version (needed there); for another document, the contract whose terms it prints. */
  @EmptyIsUnset() @IsOptional() @IsUUID('all', { message: 'Choose the contract version.' })
  contractId?: string;

  @IsOptional()
  @IsObject({ message: 'Send what was typed as an object.' })
  @ValidateNested()
  @Type(() => DocumentInputsDto)
  inputs?: DocumentInputsDto;

  /** The date printed on it; today in Cairo unless sent. */
  @EmptyIsUnset() @IsOptional() @IsDateOnly('Enter the date of the document.')
  documentDate?: string;

  /** For HR's own record, e.g. why it was generated again. */
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(500, { message: 'Keep the note to 500 characters or fewer.' })
  note?: string | null;
}

/** ?slotKey=&contractId= */
export class CheckDocumentDto {
  @EmptyIsUnset() @IsString({ message: 'Choose the document to check.' })
  slotKey: string;

  @EmptyIsUnset() @IsOptional() @IsUUID('all', { message: 'Choose the contract version.' })
  contractId?: string;
}
