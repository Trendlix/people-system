import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ASSET_PHOTOS_MAX } from '@trendlix/shared';
import { ConnectorScope, CurrentActiveSession, DeletesRecords, DeveloperMaySee } from '../auth/decorators.js';
import type { ActiveSession } from '../auth/sessions.service.js';
import { FileTooLargeFilter } from '../paperwork/file-too-large.filter.js';
import { PAPERWORK_MAX_BYTES } from '../paperwork/paperwork-file.js';
import { AssetDraftImagesService } from './asset-draft-images.service.js';
import { AssetDraftsService } from './asset-drafts.service.js';
import { AssetKitsService } from './asset-kits.service.js';
import { AssetPhotosService } from './asset-photos.service.js';
import { AssetReportsService } from './asset-reports.service.js';
import { AssetRoomsService } from './asset-rooms.service.js';
import { AssetSettingsService } from './asset-settings.service.js';
import { KitItemsDto } from './asset-upkeep.dto.js';
import { AssetSettingsAccess, AssetsLevel, AssetValues, CurrentAssetsCaller, type AssetsCaller } from './assets-access.js';
import {
  AssetHoldersQueryDto,
  AssetSettingsDto,
  AssetStockQueryDto,
  AssetValuesDto,
  CreateAssetDto,
  CreateKitDto,
  CreateRoomDto,
  ListAssetsQueryDto,
  ProductImageDto,
  UpdateAssetDto,
  UpdateKitDto,
  UpdateRoomDto,
} from './assets.dto.js';
import { AssetsService } from './assets.service.js';
import { CustodyTermsDto } from './custody.dto.js';

// The Assets routes (owner, 21 October 2026: the Assets module, step 1; packages/shared assets.ts has every answer's
// shape). Each names the Assets access it needs, checked by AssetsGuard after the sign-in: anyone with access (a viewer
// and up) reads the register, an asset's page and photos, the rooms and the kits; a custodian or manager registers and
// edits assets, adds and replaces photos, makes and renames kits, marks a label printed; a manager keeps the rooms; the
// CEO, Finance and a Super Admin set the values (PATCH …/values) at any level, and only they get the values in any
// answer or send them; the settings are a manager's and theirs; deleting is a Super Admin's (the system's rule). The
// rooms', kits' and settings' controllers come before the assets' one in the module, so /assets/rooms is never read as
// an asset's code.
//
// Step 2, the Claude connector (owner, 21 October 2026: "the connection method"): its token reaches only the routes
// marked @ConnectorScope: the register's list and an asset's page, the rooms and kits, the reports, and the drafts
// (listing, reading, making and changing them). Confirming and discarding a draft, and everything else, stay the
// website's: a person does them. Then (owner, 21 October 2026: "let the mcp connector fetch the product photo and add
// it / yes build it") a draft's product images: added by the connector alone (the website's MCP endpoint fetched them),
// seen and removed on the website by a custodian or a manager.

// File names are read as UTF-8, so Arabic names arrive intact; each photo at most 10 MB, as the employee file's papers.
const PHOTOS = { limits: { fileSize: PAPERWORK_MAX_BYTES, files: ASSET_PHOTOS_MAX, fields: 5 }, defParamCharset: 'utf8' };
const ONE_PHOTO = { limits: { fileSize: PAPERWORK_MAX_BYTES, files: 1, fields: 5 }, defParamCharset: 'utf8' };
// a product image: one file (5 MB at most, checked by the service in its words), its link, source page and caption
const PRODUCT_IMAGE = { limits: { fileSize: PAPERWORK_MAX_BYTES, files: 1, fields: 3 }, defParamCharset: 'utf8' };

/** What a website session is told on the product images' add: only the connector adds them. */
export const PRODUCT_IMAGES_CONNECTOR_ONLY = 'Product images are added by Claude through the connector. Add a photo of the item itself on the draft’s page.';

@Controller('assets/rooms')
export class AssetRoomsController {
  constructor(private readonly rooms: AssetRoomsService) {}

  @ConnectorScope()
  @AssetsLevel('viewer')
  @Get()
  list() {
    return this.rooms.list();
  }

  @AssetsLevel('manager')
  @Post()
  create(@Body() dto: CreateRoomDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.rooms.create(dto, caller.user.id);
  }

  @AssetsLevel('manager')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoomDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.rooms.update(id, dto, caller.user.id);
  }

  @DeletesRecords()
  @AssetsLevel('manager')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.rooms.remove(id, caller.user);
  }
}

@Controller('assets/kits')
export class AssetKitsController {
  constructor(private readonly kits: AssetKitsService) {}

  @ConnectorScope()
  @AssetsLevel('viewer')
  @Get()
  list() {
    return this.kits.list();
  }

  @AssetsLevel('custodian')
  @Post()
  create(@Body() dto: CreateKitDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.kits.create(dto, caller.user.id);
  }

  @AssetsLevel('custodian')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateKitDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.kits.update(id, dto, caller.user.id);
  }

  /** Step 4: assets put in the kit and taken out of it: { add?: ids, addCodes?: codes, remove?: ids }. */
  @AssetsLevel('custodian')
  @Patch(':id/items')
  setItems(@Param('id', ParseUUIDPipe) id: string, @Body() dto: KitItemsDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.kits.setItems(id, dto, caller.user.id);
  }
}

@Controller('assets/settings')
export class AssetSettingsController {
  constructor(private readonly settings: AssetSettingsService) {}

  @AssetSettingsAccess()
  @Get()
  view() {
    return this.settings.view();
  }

  @AssetSettingsAccess()
  @Patch()
  update(@Body() dto: AssetSettingsDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.settings.update(dto, caller.user);
  }

  /**
   * The terms the custody forms print (step 3, the brief: "editable text, managers only"): { terms } one a term, with
   * { termsAr } the Arabic beside them (24 October 2026: "Arabic and English"), or { standard: true } for the standard
   * wording again, in both languages.
   */
  @AssetsLevel('manager')
  @Patch('terms')
  updateTerms(@Body() dto: CustodyTermsDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.settings.updateTerms(dto.standard ? null : (dto.terms ?? []), caller.user, dto.standard ? undefined : dto.termsAr);
  }
}

/**
 * The drafts from Claude (step 2; packages/shared asset-drafts.ts): a custodian or a manager lists and reads them, and
 * Claude makes and changes them through the connector in their name; confirming one (the Add form, filled in from it)
 * and discarding one are a person's, on the website.
 */
@Controller('assets/drafts')
export class AssetDraftsController {
  constructor(
    private readonly drafts: AssetDraftsService,
    private readonly images: AssetDraftImagesService,
  ) {}

  @ConnectorScope()
  @AssetsLevel('custodian')
  @Get()
  list(@CurrentAssetsCaller() caller: AssetsCaller) {
    return this.drafts.list(caller);
  }

  @ConnectorScope()
  @AssetsLevel('custodian')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.drafts.get(id, caller);
  }

  @ConnectorScope()
  @AssetsLevel('custodian')
  @Post()
  create(@Body() dto: CreateAssetDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.drafts.create(dto, caller);
  }

  @ConnectorScope()
  @AssetsLevel('custodian')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAssetDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.drafts.update(id, dto, caller);
  }

  /** Confirm: the Add form's body, as for POST /assets; the new asset (its code given now). */
  @AssetsLevel('custodian')
  @Post(':id/confirm')
  confirm(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateAssetDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.drafts.confirm(id, dto, caller);
  }

  @AssetsLevel('custodian')
  @Post(':id/discard')
  @HttpCode(200)
  discard(@Param('id', ParseUUIDPipe) id: string, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.drafts.discard(id, caller);
  }

  /**
   * A product image (the connector's alone): the bytes the website's MCP endpoint fetched from the link Claude found
   * (the field `image`), with `imageUrl`, `sourcePageUrl` and `caption`; at most 3 a draft still waiting. The draft's
   * product images after.
   */
  @ConnectorScope()
  @AssetsLevel('custodian')
  @Post(':id/product-images')
  @UseFilters(FileTooLargeFilter)
  @UseInterceptors(FileInterceptor('image', PRODUCT_IMAGE))
  addProductImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: ProductImageDto,
    @CurrentAssetsCaller() caller: AssetsCaller,
    @CurrentActiveSession() session: ActiveSession,
  ) {
    if (session?.kind !== 'connector') throw new ForbiddenException(PRODUCT_IMAGES_CONNECTOR_ONLY);
    return this.images.add(id, file, dto, caller);
  }

  /** A product image, for the draft's page (kept by the browser for ten minutes, as an asset's photos). */
  @AssetsLevel('custodian')
  @DeveloperMaySee()
  @Get(':id/product-images/:imageId')
  @Header('Cache-Control', 'private, max-age=600')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async productImage(@Param('id', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string): Promise<StreamableFile> {
    const { data, type } = await this.images.file(id, imageId);
    return new StreamableFile(data, { type, length: data.length });
  }

  /** Remove on the draft's page (a custodian or a manager): taken off a draft still waiting; not a record's delete. */
  @AssetsLevel('custodian')
  @Delete(':id/product-images/:imageId')
  @HttpCode(204)
  removeProductImage(@Param('id', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.images.remove(id, imageId, caller);
  }
}

/** What the connector reads besides the register (step 2): anyone with Assets access, never a value. */
@Controller('assets/reports')
export class AssetReportsController {
  constructor(private readonly reports: AssetReportsService) {}

  /** ?q= a person's name or employee code: what they hold. */
  @ConnectorScope()
  @AssetsLevel('viewer')
  @Get('holders')
  holders(@Query() query: AssetHoldersQueryDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.reports.holders(query.q, caller.user);
  }

  @ConnectorScope()
  @AssetsLevel('viewer')
  @Get('overdue')
  overdue(@CurrentAssetsCaller() caller: AssetsCaller) {
    return this.reports.overdue(caller.user);
  }

  /** ?reorder=1: only those at or under their reorder level. */
  @ConnectorScope()
  @AssetsLevel('viewer')
  @Get('stock')
  stock(@Query() query: AssetStockQueryDto) {
    return this.reports.stock(query.reorder === true);
  }

  @ConnectorScope()
  @AssetsLevel('viewer')
  @Get('counts-due')
  countsDue() {
    return this.reports.countsDue();
  }
}

@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly photos: AssetPhotosService,
  ) {}

  /** The register: ?q= (name, code, serial, holder), ?group= ?status= ?roomId= ?kitId= ?holder= ?needsValues=1 ?page=. */
  @ConnectorScope()
  @AssetsLevel('viewer')
  @Get()
  list(@Query() query: ListAssetsQueryDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.assets.list(query, caller);
  }

  @AssetsLevel('custodian')
  @Post()
  create(@Body() dto: CreateAssetDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.assets.create(dto, caller);
  }

  /** An asset's page by its code (the address in its QR label). */
  @ConnectorScope()
  @AssetsLevel('viewer')
  @Get(':code')
  get(@Param('code') code: string, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.assets.get(code, caller);
  }

  @AssetsLevel('custodian')
  @Patch(':code')
  update(@Param('code') code: string, @Body() dto: UpdateAssetDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.assets.update(code, dto, caller);
  }

  /** The values: the CEO, Finance or a Super Admin, whatever their Assets level. */
  @AssetValues()
  @Patch(':code/values')
  updateValues(@Param('code') code: string, @Body() dto: AssetValuesDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.assets.updateValues(code, dto, caller);
  }

  /** Its label printed: when, kept on it. */
  @AssetsLevel('custodian')
  @Post(':code/labeled')
  @HttpCode(200)
  labeled(@Param('code') code: string, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.assets.markLabeled(code, caller);
  }

  @DeletesRecords()
  @AssetsLevel('manager')
  @Delete(':code')
  @HttpCode(204)
  remove(@Param('code') code: string, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.assets.remove(code, caller);
  }

  /** A photo, kept by the browser for ten minutes (a list of assets doesn't load every photo on every visit). */
  @AssetsLevel('viewer')
  @DeveloperMaySee()
  @Get(':code/photos/:photoId')
  @Header('Cache-Control', 'private, max-age=600')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async photo(@Param('code') code: string, @Param('photoId', ParseUUIDPipe) photoId: string): Promise<StreamableFile> {
    const { data, type } = await this.photos.file(code, photoId);
    return new StreamableFile(data, { type, length: data.length });
  }

  /** Photos added (the field `photos`, up to 6 an asset in all): the asset's photos after. */
  @AssetsLevel('custodian')
  @Post(':code/photos')
  @UseFilters(FileTooLargeFilter)
  @UseInterceptors(FilesInterceptor('photos', ASSET_PHOTOS_MAX, PHOTOS))
  addPhotos(@Param('code') code: string, @UploadedFiles() files: Express.Multer.File[] | undefined, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.photos.add(code, files, caller);
  }

  /** A photo's file replaced (the field `photo`). */
  @AssetsLevel('custodian')
  @Put(':code/photos/:photoId')
  @UseFilters(FileTooLargeFilter)
  @UseInterceptors(FileInterceptor('photo', ONE_PHOTO))
  replacePhoto(
    @Param('code') code: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentAssetsCaller() caller: AssetsCaller,
  ) {
    return this.photos.replace(code, photoId, file, caller);
  }

  /** A photo made the first, the one the lists show. */
  @AssetsLevel('custodian')
  @Post(':code/photos/:photoId/first')
  @HttpCode(200)
  firstPhoto(@Param('code') code: string, @Param('photoId', ParseUUIDPipe) photoId: string, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.photos.makeFirst(code, photoId, caller);
  }

  @DeletesRecords()
  @AssetsLevel('manager')
  @Delete(':code/photos/:photoId')
  @HttpCode(204)
  removePhoto(@Param('code') code: string, @Param('photoId', ParseUUIDPipe) photoId: string, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.photos.remove(code, photoId, caller);
  }
}
