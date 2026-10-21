import { Module } from '@nestjs/common';
import { AssetDraftsService } from './asset-drafts.service.js';
import { AssetKitsService } from './asset-kits.service.js';
import { AssetPhotosService } from './asset-photos.service.js';
import { AssetRepairsService } from './asset-repairs.service.js';
import { AssetReportsService } from './asset-reports.service.js';
import { AssetRoomsService } from './asset-rooms.service.js';
import { AssetSettingsService } from './asset-settings.service.js';
import { AssetsGuard } from './assets-access.js';
import { AssetDraftsController, AssetKitsController, AssetReportsController, AssetRoomsController, AssetsController, AssetSettingsController } from './assets.controller.js';
import { AssetsService } from './assets.service.js';
import { CustodyFilesService } from './custody-files.service.js';
import { CustodyNoticesService } from './custody-notices.service.js';
import { CustodySchedulerService } from './custody-scheduler.service.js';
import { AssetActionsController, CustodyController, MyCustodyController } from './custody.controller.js';
import { CustodyService } from './custody.service.js';

/**
 * Assets (owner, 21 October 2026: "i want to add this module with a special permission to the system"; packages/shared
 * assets.ts), step 1: the Assets access per user and the values rule (AssetsGuard), the register (assets, their codes,
 * their photos), the rooms, the kits and the settings. Custody, stock, repairs, disposal, counts, labels and the AI are
 * the later steps. The rooms', kits' and settings' controllers first, so their paths are matched before an asset's code.
 * Step 2 (owner, 21 October 2026: "the connection method"): the drafts from Claude and the reports the connector reads,
 * their controllers before the assets' one too. Step 3, custody: handing over and receiving back, the signed copies, the
 * holdings, My custody, an asset's history and its repairs, lost and found, and the daily check (started by main.ts);
 * the custody controller before the assets' one, so /assets/custody is never read as an asset's code.
 */
@Module({
  controllers: [
    AssetRoomsController,
    AssetKitsController,
    AssetSettingsController,
    AssetDraftsController,
    AssetReportsController,
    CustodyController,
    MyCustodyController,
    AssetActionsController,
    AssetsController,
  ],
  providers: [
    AssetsGuard,
    AssetSettingsService,
    AssetsService,
    AssetPhotosService,
    AssetRoomsService,
    AssetKitsService,
    AssetDraftsService,
    AssetReportsService,
    CustodyService,
    CustodyFilesService,
    CustodyNoticesService,
    CustodySchedulerService,
    AssetRepairsService,
  ],
  exports: [CustodySchedulerService],
})
export class AssetsModule {}
