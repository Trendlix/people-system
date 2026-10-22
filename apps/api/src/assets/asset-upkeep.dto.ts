import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import {
  ACCESSORY_LIMITS,
  ASSET_MONEY_MAX,
  ASSET_QUANTITY_MAX,
  DISPOSAL_METHODS,
  DISPOSAL_TEXT_LIMITS,
  KIT_ITEMS_MAX,
  MAINTENANCE_KINDS,
  MAINTENANCE_TEXT_LIMITS,
  STOCK_MOVE_KINDS,
  STOCK_NOTE_MAX,
  type DisposalMethod,
  type MaintenanceKind,
  type StockMoveKind,
} from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';
import { Trim, TrimOrNull } from '../common/transforms.js';

// What the step-4 actions send (the owner's build order, 21 October 2026: "kits / stock / repairs / disposal"; owner, 22
// October 2026: accessories, "Both kinds"; packages/shared asset-accessories.ts and asset-upkeep.ts). Each field checked
// here on its own, in words; the rules between fields (the stock never below 0, one level of attaching, what may be
// disposed of) are the shared ones, checked by the services.

const keep = (max: number, what: string) => MaxLength(max, { message: `Keep the ${what} to ${max} characters or fewer.` });
const money = (what: string) => [
  IsNumber({ maxDecimalPlaces: 2 }, { message: `Enter the ${what} in EGP, with at most 2 decimals, e.g. 1500 or 1500.50.` }),
  Min(0, { message: `The ${what} can’t be below 0.` }),
  Max(ASSET_MONEY_MAX, { message: `The ${what} is too large.` }),
];
const apply = (decorators: PropertyDecorator[]): PropertyDecorator => (target, key) => decorators.forEach((d) => d(target, key));

/** A line of an asset's accessories' checklist. */
export class AccessoryDto {
  @Trim() @IsString({ message: 'Give each accessory a name, e.g. Charger.' }) @keep(ACCESSORY_LIMITS.name, 'accessory’s name')
  name!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 }, { message: `Give how many as a whole number from 1 to ${ACCESSORY_LIMITS.quantityMax}.` })
  @Min(1, { message: `Give how many as a whole number from 1 to ${ACCESSORY_LIMITS.quantityMax}.` })
  @Max(ACCESSORY_LIMITS.quantityMax, { message: `Give how many as a whole number from 1 to ${ACCESSORY_LIMITS.quantityMax}.` })
  quantity?: number;

  @IsOptional() @TrimOrNull() @IsString() @keep(ACCESSORY_LIMITS.serial, 'accessory’s serial number')
  serial?: string | null;

  @IsOptional() @TrimOrNull() @IsString() @keep(ACCESSORY_LIMITS.notes, 'accessory’s notes')
  notes?: string | null;
}

/** PUT /assets/:code/accessories: the whole checklist, in order (an empty list clears it). */
export class AccessoriesDto {
  @IsArray({ message: 'Send the accessories as a list.' })
  @ArrayMaxSize(ACCESSORY_LIMITS.perAsset, { message: `Keep the accessories to ${ACCESSORY_LIMITS.perAsset} lines or fewer.` })
  @ValidateNested({ each: true })
  @Type(() => AccessoryDto)
  items!: AccessoryDto[];
}

/** PATCH /assets/:code/parent: the main asset's code to attach it to; null detaches it. */
export class AttachDto {
  @IsOptional() @TrimOrNull() @IsString({ message: 'Enter the main asset’s code, e.g. PK-GMB-0001.' }) @keep(40, 'code')
  parentCode?: string | null;
}

/** POST /assets/:code/stock: a consumable used or restocked. */
export class StockMoveDto {
  @IsIn(STOCK_MOVE_KINDS, { message: 'Choose Use or Restock.' })
  kind!: StockMoveKind;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter how many, with at most 2 decimals.' })
  @Min(0.01, { message: 'Enter how many, above 0.' })
  @Max(ASSET_QUANTITY_MAX, { message: `Enter at most ${ASSET_QUANTITY_MAX.toLocaleString('en-US')}.` })
  amount!: number;

  @IsOptional() @TrimOrNull() @IsString() @keep(STOCK_NOTE_MAX, 'note')
  note?: string | null;
}

/** POST /assets/:code/maintenance: an entry of its maintenance log, by hand. */
export class MaintenanceDto {
  @IsIn(MAINTENANCE_KINDS, { message: 'Choose what it was: a repair, service, inspection, warranty claim or upgrade.' })
  kind!: MaintenanceKind;

  @IsOptional() @IsDateOnly('Enter the date as YYYY-MM-DD.')
  on?: string | null;

  @IsOptional() @TrimOrNull() @IsString() @keep(MAINTENANCE_TEXT_LIMITS.vendor, 'vendor')
  vendor?: string | null;

  /** The cost in EGP: from the CEO, Finance or a Super Admin only (403 from anyone else). */
  @IsOptional() @apply(money('cost'))
  cost?: number | null;

  @IsOptional() @TrimOrNull() @IsString() @keep(MAINTENANCE_TEXT_LIMITS.notes, 'notes')
  notes?: string | null;
}

/** POST /assets/:code/dispose: an Assets manager's. */
export class DisposeDto {
  @IsIn(DISPOSAL_METHODS, { message: 'Choose how it was disposed of: sold, scrapped, written off or donated.' })
  method!: DisposalMethod;

  @IsOptional() @IsDateOnly('Enter the disposal date as YYYY-MM-DD.')
  on?: string | null;

  /** The amount received in EGP: from the CEO, Finance or a Super Admin only (403 from anyone else). */
  @IsOptional() @apply(money('amount received'))
  amount?: number | null;

  @Trim() @IsString({ message: 'Say who approved the disposal.' }) @keep(DISPOSAL_TEXT_LIMITS.approvedBy, 'name of who approved it')
  approvedBy!: string;

  @IsOptional() @TrimOrNull() @IsString() @keep(DISPOSAL_TEXT_LIMITS.notes, 'notes')
  notes?: string | null;
}

/** PATCH /assets/:code/disposal: the amount received, set later by the CEO, Finance or a Super Admin. */
export class DisposalAmountDto {
  @IsOptional() @apply(money('amount received'))
  amount?: number | null;
}

/** PATCH /assets/kits/:id/items: assets put in the kit and taken out of it, by id. */
export class KitItemsDto {
  @IsOptional()
  @IsArray({ message: 'Choose the assets to add.' })
  @ArrayMaxSize(KIT_ITEMS_MAX, { message: `Add at most ${KIT_ITEMS_MAX} assets at a time.` })
  @IsUUID('all', { each: true, message: 'Choose the assets from the list.' })
  add?: string[];

  @IsOptional()
  @IsArray({ message: 'Choose the assets to take out.' })
  @ArrayMaxSize(KIT_ITEMS_MAX, { message: `Take out at most ${KIT_ITEMS_MAX} assets at a time.` })
  @IsUUID('all', { each: true, message: 'Choose the assets from the list.' })
  remove?: string[];

  /** Or by codes, as typed (PK-CAM-0003): added. */
  @IsOptional()
  @IsArray({ message: 'Type the codes of the assets to add.' })
  @ArrayMaxSize(KIT_ITEMS_MAX, { message: `Add at most ${KIT_ITEMS_MAX} assets at a time.` })
  @IsString({ each: true })
  @Matches(/^[A-Za-z]{2}-[A-Za-z]{2,4}-\d{4,}$/, { each: true, message: 'Type each code as on its label, e.g. PK-CAM-0003.' })
  addCodes?: string[];
}
