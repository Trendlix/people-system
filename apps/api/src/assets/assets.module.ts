import { Module } from '@nestjs/common';
import { AssetKitsService } from './asset-kits.service.js';
import { AssetPhotosService } from './asset-photos.service.js';
import { AssetRoomsService } from './asset-rooms.service.js';
import { AssetSettingsService } from './asset-settings.service.js';
import { AssetsGuard } from './assets-access.js';
import { AssetKitsController, AssetRoomsController, AssetsController, AssetSettingsController } from './assets.controller.js';
import { AssetsService } from './assets.service.js';

/**
 * Assets (owner, 21 October 2026: "i want to add this module with a special permission to the system"; packages/shared
 * assets.ts), step 1: the Assets access per user and the values rule (AssetsGuard), the register (assets, their codes,
 * their photos), the rooms, the kits and the settings. Custody, stock, repairs, disposal, counts, labels and the AI are
 * the later steps. The rooms', kits' and settings' controllers first, so their paths are matched before an asset's code.
 */
@Module({
  controllers: [AssetRoomsController, AssetKitsController, AssetSettingsController, AssetsController],
  providers: [AssetsGuard, AssetSettingsService, AssetsService, AssetPhotosService, AssetRoomsService, AssetKitsService],
})
export class AssetsModule {}
