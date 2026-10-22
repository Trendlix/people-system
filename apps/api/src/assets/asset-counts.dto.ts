import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ASSET_COUNT_LIMITS, ASSET_COUNT_SCOPES, ASSET_GROUPS, LABEL_SHEET, type AssetCountScopeKind, type AssetGroup } from '@trendlix/shared';
import { Trim, TrimOrNull } from '../common/transforms.js';

// What the Assets step 5 pages send (owner, 22 October 2026: "Assets step 5 (stock counts, label sheets, the Assets
// dashboard, exports) … work on this"; packages/shared asset-counts.ts). Each field checked here on its own, in words;
// the scope as a whole and the codes ticked are checked by the service with the shared rules.

const yes = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

/** "PK-CAM-0003,IT-LAP-0012" or repeated: a list of codes. */
const codeList = ({ value }: { value: unknown }) =>
  (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])
    .map((v) => (typeof v === 'string' ? v.trim() : v))
    .filter((v) => v !== '');

/** What a count covers: a group, a room or a kit (GET /assets/counts/sheet). */
export class AssetCountScopeDto {
  @IsIn(ASSET_COUNT_SCOPES, { message: 'Choose what to count: a group, a room or a kit.' })
  kind!: AssetCountScopeKind;

  @IsOptional() @IsIn(ASSET_GROUPS, { message: 'Choose the group to count.' })
  group?: AssetGroup;

  @IsOptional() @IsUUID('all', { message: 'Choose the room to count.' })
  roomId?: string;

  @IsOptional() @IsUUID('all', { message: 'Choose the kit to count.' })
  kitId?: string;
}

/** POST /assets/counts: the scope, the codes ticked as there, notes. */
export class AssetCountDto extends AssetCountScopeDto {
  @IsArray({ message: 'Send what was found as a list of codes.' })
  @ArrayMaxSize(ASSET_COUNT_LIMITS.found, { message: `A count takes at most ${ASSET_COUNT_LIMITS.found} assets.` })
  @IsString({ each: true, message: 'Send each code found as text.' })
  @MaxLength(200, { each: true, message: 'A code found is too long.' })
  found!: string[];

  @IsOptional() @TrimOrNull() @IsString() @MaxLength(ASSET_COUNT_LIMITS.notes, { message: `Keep the notes to ${ASSET_COUNT_LIMITS.notes} characters or fewer.` })
  notes?: string | null;
}

/** GET /assets/counts: the history's page. */
export class AssetCountsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt({ message: 'Choose a page.' }) @Min(1, { message: 'Choose a page.' }) @Max(100_000)
  page?: number;
}

/** POST /assets/counts/:id/lines/:code/lost: why, if said. */
export class MarkLostFromCountDto {
  @IsOptional() @TrimOrNull() @IsString() @MaxLength(1000, { message: 'Keep the notes to 1000 characters or fewer.' })
  notes?: string | null;
}

/** GET /assets/labels: the assets whose labels may print, by what was chosen; `codes` reads those exactly. */
export class AssetLabelsQueryDto {
  @IsOptional() @Transform(yes) @IsBoolean()
  unlabelled?: boolean;

  @IsOptional() @IsIn(ASSET_GROUPS, { message: 'Choose a group.' })
  group?: AssetGroup;

  @IsOptional() @IsUUID('all', { message: 'Choose a room.' })
  roomId?: string;

  @IsOptional() @IsUUID('all', { message: 'Choose a kit.' })
  kitId?: string;

  @IsOptional() @Trim() @IsString() @MaxLength(100, { message: 'Keep the search to 100 characters or fewer.' })
  q?: string;

  @IsOptional() @Transform(codeList) @IsArray() @ArrayMaxSize(LABEL_SHEET.maxLabels, { message: `Print at most ${LABEL_SHEET.maxLabels} labels at once.` })
  @IsString({ each: true }) @MaxLength(40, { each: true, message: 'A code is too long.' })
  codes?: string[];
}

/** POST /assets/labels/labelled: the labels printed and stuck on. */
export class AssetLabelledDto {
  @IsArray({ message: 'Send the labels printed as a list of codes.' })
  @ArrayMaxSize(LABEL_SHEET.maxLabels, { message: `Mark at most ${LABEL_SHEET.maxLabels} labels at once.` })
  @IsString({ each: true, message: 'Send each code as text.' })
  @MaxLength(40, { each: true, message: 'A code is too long.' })
  codes!: string[];
}
