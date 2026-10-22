import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import {
  ACCESSORY_LIMITS,
  ASSET_CLASSES,
  ASSET_CONDITIONS,
  ASSET_GROUPS,
  ASSET_MONEY_MAX,
  ASSET_QUANTITY_MAX,
  ASSET_STATUSES,
  ASSET_TEXT_LIMITS,
  ASSET_TYPE_CODES,
  ASSET_USEFUL_LIFE_MAX,
  PRODUCT_IMAGE_RULES,
  type AssetClass,
  type AssetCondition,
  type AssetGroup,
  type AssetStatus,
  type AssetType,
} from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';
import { Trim, TrimOrNull } from '../common/transforms.js';
import { AccessoryDto } from './asset-upkeep.dto.js';

// What the Assets pages send (owner, 21 October 2026; packages/shared assets.ts). Each field checked here on its own,
// in words; the rules between fields (what a group has, the status rules, the market value's range) are the shared
// ones, checked by the services (assetProblems, assetStatusProblem, assetValuesProblems). On an edit a field left out
// stays as it is and null clears it. The values travel apart (`values`, or PATCH …/values): only the CEO, Finance and a
// Super Admin send them.

const keep = (max: number, what: string) => MaxLength(max, { message: `Keep the ${what} to ${max} characters or fewer.` });
const money = (what: string) => [
  IsNumber({ maxDecimalPlaces: 2 }, { message: `Enter the ${what} in EGP, with at most 2 decimals, e.g. 45000 or 45000.50.` }),
  Min(0, { message: `The ${what} can’t be below 0.` }),
  Max(ASSET_MONEY_MAX, { message: `The ${what} is too large.` }),
];
const quantity = (what: string) => [
  IsNumber({ maxDecimalPlaces: 2 }, { message: `Enter the ${what} as a number, with at most 2 decimals.` }),
  Min(0, { message: `The ${what} can’t be below 0.` }),
  Max(ASSET_QUANTITY_MAX, { message: `The ${what} can be at most ${ASSET_QUANTITY_MAX.toLocaleString('en-US')}.` }),
];
const apply = (decorators: PropertyDecorator[]): PropertyDecorator => (target, key) => decorators.forEach((d) => d(target, key));

const GROUP_MESSAGE = `Choose the group: ${ASSET_GROUPS.join(', ')}.`;
const TYPE_MESSAGE = 'Choose the type from the list.';

/** The values (the CEO's, Finance's and a Super Admin's only): each sent replaces it, null clears it. */
export class AssetValuesDto {
  @IsOptional() @apply(money('purchase cost'))
  purchasePrice?: number | null;

  @IsOptional() @TrimOrNull() @IsString({ message: 'Enter the supplier.' }) @keep(ASSET_TEXT_LIMITS.supplier, 'supplier')
  supplier?: string | null;

  @IsOptional() @TrimOrNull() @IsString({ message: 'Enter the invoice number.' }) @keep(ASSET_TEXT_LIMITS.invoiceNo, 'invoice number')
  invoiceNo?: string | null;

  @IsOptional() @apply(money('low market value'))
  priceLow?: number | null;

  @IsOptional() @apply(money('market value'))
  marketValue?: number | null;

  @IsOptional() @apply(money('high market value'))
  priceHigh?: number | null;

  @IsOptional() @TrimOrNull() @IsString({ message: 'Enter the note.' }) @keep(ASSET_TEXT_LIMITS.priceNote, 'note')
  priceNote?: string | null;
}

/** The fields an asset has besides its name, group and type, each optional (null clears it). */
abstract class AssetFieldsDto {
  @IsOptional() @IsIn(ASSET_CLASSES, { message: 'Choose fixed or current.' })
  assetClass?: AssetClass;

  @IsOptional() @TrimOrNull() @IsString({ message: 'Enter the brand.' }) @keep(ASSET_TEXT_LIMITS.brand, 'brand')
  brand?: string | null;

  @IsOptional() @TrimOrNull() @IsString({ message: 'Enter the model.' }) @keep(ASSET_TEXT_LIMITS.model, 'model')
  model?: string | null;

  @IsOptional() @TrimOrNull() @IsString({ message: 'Enter the serial number.' }) @keep(ASSET_TEXT_LIMITS.serial, 'serial number')
  serial?: string | null;

  @IsOptional() @IsIn(ASSET_CONDITIONS, { message: 'Choose the condition.' })
  condition?: AssetCondition | null;

  /** Checked by the service (assetStatusProblem): custody and disposed are never set here. */
  @IsOptional() @IsIn(ASSET_STATUSES, { message: 'Choose the status.' })
  status?: AssetStatus;

  @IsOptional() @IsUUID('all', { message: 'Choose the room.' })
  roomId?: string | null;

  @IsOptional() @IsUUID('all', { message: 'Choose the kit.' })
  kitId?: string | null;

  @IsOptional() @apply(quantity('quantity'))
  quantity?: number | null;

  @IsOptional() @TrimOrNull() @IsString({ message: 'Enter the unit, e.g. roll or pack.' }) @keep(ASSET_TEXT_LIMITS.unit, 'unit')
  unit?: string | null;

  @IsOptional() @apply(quantity('reorder level'))
  reorderLevel?: number | null;

  @IsOptional() @IsDateOnly('Enter the purchase date as YYYY-MM-DD.')
  purchaseDate?: string | null;

  @IsOptional()
  @IsInt({ message: `Enter the useful life in whole years, from 1 to ${ASSET_USEFUL_LIFE_MAX}.` })
  @Min(1, { message: `Enter the useful life in whole years, from 1 to ${ASSET_USEFUL_LIFE_MAX}.` })
  @Max(ASSET_USEFUL_LIFE_MAX, { message: `Enter the useful life in whole years, from 1 to ${ASSET_USEFUL_LIFE_MAX}.` })
  usefulLifeYears?: number | null;

  @IsOptional() @IsDateOnly('Enter the warranty end as YYYY-MM-DD.')
  warrantyEnd?: string | null;

  @IsOptional() @TrimOrNull() @IsString({ message: 'Enter the notes.' }) @keep(ASSET_TEXT_LIMITS.notes, 'notes')
  notes?: string | null;

  /** The values, from the CEO, Finance or a Super Admin only (403 from anyone else). */
  @IsOptional() @ValidateNested() @Type(() => AssetValuesDto)
  values?: AssetValuesDto;

  /**
   * Step 4 (owner, 22 October 2026: accessories, "Both kinds"): its accessories' checklist, on Add and on a draft from
   * Claude (an asset's own changes on its page: PUT /assets/:code/accessories).
   */
  @IsOptional()
  @IsArray({ message: 'Send the accessories as a list.' })
  @ArrayMaxSize(ACCESSORY_LIMITS.perAsset, { message: `Keep the accessories to ${ACCESSORY_LIMITS.perAsset} lines or fewer.` })
  @ValidateNested({ each: true })
  @Type(() => AccessoryDto)
  accessories?: AccessoryDto[];

  /** Step 4: the main asset's code it is an accessory of, on Add and on a draft (null: none; an asset's own: PATCH …/parent). */
  @IsOptional() @TrimOrNull() @IsString({ message: 'Enter the main asset’s code, e.g. PK-GMB-0001.' }) @keep(40, 'code')
  parentCode?: string | null;
}

/** A new asset: its name, group and type at least; its class and useful life default to its group's. */
export class CreateAssetDto extends AssetFieldsDto {
  @Trim() @IsString({ message: 'Enter the asset’s name.' }) @MinLength(1, { message: 'Enter the asset’s name.' }) @keep(ASSET_TEXT_LIMITS.name, 'name')
  name!: string;

  @IsIn(ASSET_GROUPS, { message: GROUP_MESSAGE })
  group!: AssetGroup;

  @IsIn(ASSET_TYPE_CODES, { message: TYPE_MESSAGE })
  type!: AssetType;
}

/** An edit: only what changes. The code stays, whatever the group or type become. */
export class UpdateAssetDto extends AssetFieldsDto {
  @IsOptional() @Trim() @IsString({ message: 'Enter the asset’s name.' }) @MinLength(1, { message: 'Enter the asset’s name.' }) @keep(ASSET_TEXT_LIMITS.name, 'name')
  name?: string;

  @IsOptional() @IsIn(ASSET_GROUPS, { message: GROUP_MESSAGE })
  group?: AssetGroup;

  @IsOptional() @IsIn(ASSET_TYPE_CODES, { message: TYPE_MESSAGE })
  type?: AssetType;
}

const yes = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

/** GET /assets: the search and the filters (all optional), and the page. */
export class ListAssetsQueryDto {
  @IsOptional() @Trim() @IsString() @MaxLength(100, { message: 'Keep the search to 100 characters or fewer.' })
  q?: string;

  @IsOptional() @IsIn(ASSET_GROUPS, { message: GROUP_MESSAGE })
  group?: AssetGroup;

  @IsOptional() @IsIn(ASSET_STATUSES, { message: 'Choose a status.' })
  status?: AssetStatus;

  @IsOptional() @IsUUID('all', { message: 'Choose a room.' })
  roomId?: string;

  @IsOptional() @IsUUID('all', { message: 'Choose a kit.' })
  kitId?: string;

  /** Who holds it: part of their name or employee code (step 2, 21 October 2026: the Claude connector's search). */
  @IsOptional() @Trim() @IsString() @MaxLength(100, { message: 'Keep the holder’s name to 100 characters or fewer.' })
  holder?: string;

  /** The "Needs values" list: no purchase cost, not disposed (the CEO, Finance and a Super Admin only). */
  @IsOptional() @Transform(yes) @IsBoolean()
  needsValues?: boolean;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'Choose a page.' }) @Min(1, { message: 'Choose a page.' }) @Max(100_000)
  page?: number;
}

/** GET /assets/reports/holders: a person's name or employee code (step 2, the Claude connector's who_holds). */
export class AssetHoldersQueryDto {
  @IsOptional() @Trim() @IsString() @MaxLength(100, { message: 'Keep the name to 100 characters or fewer.' })
  q?: string;
}

/** GET /assets/reports/stock: ?reorder=1 for only those at or under their reorder level. */
export class AssetStockQueryDto {
  @IsOptional() @Transform(yes) @IsBoolean()
  reorder?: boolean;
}

export class CreateRoomDto {
  @Trim() @IsString({ message: 'Enter the room’s name.' }) @MinLength(1, { message: 'Enter the room’s name.' }) @keep(ASSET_TEXT_LIMITS.roomName, 'room’s name')
  name!: string;

  @IsOptional() @TrimOrNull() @IsString() @keep(ASSET_TEXT_LIMITS.roomNotes, 'notes')
  notes?: string | null;
}

export class UpdateRoomDto {
  @IsOptional() @Trim() @IsString({ message: 'Enter the room’s name.' }) @MinLength(1, { message: 'Enter the room’s name.' }) @keep(ASSET_TEXT_LIMITS.roomName, 'room’s name')
  name?: string;

  @IsOptional() @TrimOrNull() @IsString() @keep(ASSET_TEXT_LIMITS.roomNotes, 'notes')
  notes?: string | null;

  /** Archived: no longer offered for new assets; kept on the assets in it. */
  @IsOptional() @IsBoolean({ message: 'Say whether the room is archived.' })
  archived?: boolean;
}

export class CreateKitDto {
  @Trim() @IsString({ message: 'Enter the kit’s name.' }) @MinLength(1, { message: 'Enter the kit’s name.' }) @keep(ASSET_TEXT_LIMITS.kitName, 'kit’s name')
  name!: string;

  @IsOptional() @TrimOrNull() @IsString() @keep(ASSET_TEXT_LIMITS.kitNotes, 'notes')
  notes?: string | null;
}

export class UpdateKitDto {
  @IsOptional() @Trim() @IsString({ message: 'Enter the kit’s name.' }) @MinLength(1, { message: 'Enter the kit’s name.' }) @keep(ASSET_TEXT_LIMITS.kitName, 'kit’s name')
  name?: string;

  @IsOptional() @TrimOrNull() @IsString() @keep(ASSET_TEXT_LIMITS.kitNotes, 'notes')
  notes?: string | null;
}

export class AssetSettingsDto {
  @apply(money('capitalization threshold'))
  capitalizationThreshold!: number;
}

/**
 * A product image's details (owner, 21 October 2026: "let the mcp connector fetch the product photo and add it"), sent by
 * the website's MCP endpoint with the image it fetched (multipart `image`): the link it came from, its source page (both
 * https, checked by the service with productImageUrlProblem) and Claude's caption.
 */
export class ProductImageDto {
  @Trim() @IsString({ message: 'Send the image link.' }) @keep(PRODUCT_IMAGE_RULES.urlMax, 'image link')
  imageUrl!: string;

  @Trim() @IsString({ message: 'Send the page the image came from.' }) @keep(PRODUCT_IMAGE_RULES.urlMax, 'source page link')
  sourcePageUrl!: string;

  @IsOptional() @TrimOrNull() @IsString() @keep(PRODUCT_IMAGE_RULES.captionMax, 'caption')
  caption?: string | null;
}
