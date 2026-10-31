import { CHANGE_REQUEST_STATUSES, type ChangeRequestStatus } from '@trendlix/shared';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { TrimOrNull } from '../common/transforms.js';

// A new photo of themself the employee sends HR (owner, 31 October 2026: "allow them to upload a new photo as a request
// and approved from the HR"). The photo itself comes as the upload's file ("file"), checked by PhotoRequestsService.

/** The form field sent with the photo: a note for HR, optional. */
export class CreatePhotoRequestDto {
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(1000)
  note?: string | null;
}

/** HR's note on approving or rejecting a photo: optional either way (a photo needs no reason to be kept out). */
export class PhotoDecisionDto {
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(1000)
  note?: string | null;
}

/** Every status, as the change requests' list takes it. */
export const ALL_PHOTO_REQUESTS = 'all';

/** A status, or `all` for every request; none: those waiting (HR's queue). */
export class ListPhotoRequestsDto {
  @IsOptional() @IsIn([...CHANGE_REQUEST_STATUSES, ALL_PHOTO_REQUESTS], { message: 'Choose a status: pending, approved, rejected, cancelled or all.' })
  status?: ChangeRequestStatus | typeof ALL_PHOTO_REQUESTS;
}
