import {
  Body,
  Controller,
  Delete,
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
import { DeletesRecords } from '../auth/decorators.js';
import { FileTooLargeFilter } from '../paperwork/file-too-large.filter.js';
import { PAPERWORK_MAX_BYTES } from '../paperwork/paperwork-file.js';
import { AssetKitsService } from './asset-kits.service.js';
import { AssetPhotosService } from './asset-photos.service.js';
import { AssetRoomsService } from './asset-rooms.service.js';
import { AssetSettingsService } from './asset-settings.service.js';
import { AssetSettingsAccess, AssetsLevel, AssetValues, CurrentAssetsCaller, type AssetsCaller } from './assets-access.js';
import { AssetSettingsDto, AssetValuesDto, CreateAssetDto, CreateKitDto, CreateRoomDto, ListAssetsQueryDto, UpdateAssetDto, UpdateKitDto, UpdateRoomDto } from './assets.dto.js';
import { AssetsService } from './assets.service.js';

// The Assets routes (owner, 21 October 2026: the Assets module, step 1; packages/shared assets.ts has every answer's
// shape). Each names the Assets access it needs, checked by AssetsGuard after the sign-in: anyone with access (a viewer
// and up) reads the register, an asset's page and photos, the rooms and the kits; a custodian or manager registers and
// edits assets, adds and replaces photos, makes and renames kits, marks a label printed; a manager keeps the rooms; the
// CEO, Finance and a Super Admin set the values (PATCH …/values) at any level, and only they get the values in any
// answer or send them; the settings are a manager's and theirs; deleting is a Super Admin's (the system's rule). The
// rooms', kits' and settings' controllers come before the assets' one in the module, so /assets/rooms is never read as
// an asset's code.

// File names are read as UTF-8, so Arabic names arrive intact; each photo at most 10 MB, as the employee file's papers.
const PHOTOS = { limits: { fileSize: PAPERWORK_MAX_BYTES, files: ASSET_PHOTOS_MAX, fields: 5 }, defParamCharset: 'utf8' };
const ONE_PHOTO = { limits: { fileSize: PAPERWORK_MAX_BYTES, files: 1, fields: 5 }, defParamCharset: 'utf8' };

@Controller('assets/rooms')
export class AssetRoomsController {
  constructor(private readonly rooms: AssetRoomsService) {}

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
}

@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly photos: AssetPhotosService,
  ) {}

  /** The register: ?q= (name, code, serial, holder), ?group= ?status= ?roomId= ?kitId= ?needsValues=1 ?page=. */
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
