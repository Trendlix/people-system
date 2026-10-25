import { Body, Controller, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { AssetAccessoriesService } from './asset-accessories.service.js';
import { AccessoriesDto, AttachDto, BulkDisposeDto, DisposalAmountDto, DisposeDto, MaintenanceDto, StockMoveDto } from './asset-upkeep.dto.js';
import { AssetUpkeepService } from './asset-upkeep.service.js';
import { AssetsLevel, AssetValues, CurrentAssetsCaller, type AssetsCaller } from './assets-access.js';

// The step-4 actions of an asset's page (the owner's build order, 21 October 2026: "kits / stock / repairs / disposal";
// owner, 22 October 2026: accessories, "Both kinds"; packages/shared asset-accessories.ts and asset-upkeep.ts). Each
// names the Assets access it needs, checked by AssetsGuard after the sign-in: a custodian or a manager keeps the
// accessories' checklist, attaches and detaches, uses and restocks a consumable, and adds to the maintenance log; an
// Assets manager disposes of an asset; the CEO, Finance or a Super Admin set the amount a disposal received. None is
// open to the Claude connector. Registered before the assets' controller.

@Controller('assets')
export class AssetUpkeepController {
  constructor(
    private readonly accessories: AssetAccessoriesService,
    private readonly upkeep: AssetUpkeepService,
  ) {}

  /** Its accessories' checklist, replaced as a whole: { items: [{ name, quantity, serial, notes }] }. */
  @AssetsLevel('custodian')
  @Put(':code/accessories')
  setAccessories(@Param('code') code: string, @Body() dto: AccessoriesDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.accessories.setAccessories(code, dto, caller);
  }

  /** Attached to a main asset ({ parentCode }), or detached ({ parentCode: null }). */
  @AssetsLevel('custodian')
  @Patch(':code/parent')
  attach(@Param('code') code: string, @Body() dto: AttachDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.accessories.attach(code, dto.parentCode, caller);
  }

  /** A consumable used or restocked: { kind: 'use' | 'restock', amount, note }. */
  @AssetsLevel('custodian')
  @Post(':code/stock')
  @HttpCode(200)
  moveStock(@Param('code') code: string, @Body() dto: StockMoveDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.upkeep.moveStock(code, dto, caller);
  }

  /** An entry of its maintenance log, by hand. */
  @AssetsLevel('custodian')
  @Post(':code/maintenance')
  @HttpCode(200)
  addMaintenance(@Param('code') code: string, @Body() dto: MaintenanceDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.upkeep.addMaintenance(code, dto, caller);
  }

  /** Disposed of (an Assets manager): { asset, result }. */
  @AssetsLevel('manager')
  @Post(':code/dispose')
  @HttpCode(200)
  dispose(@Param('code') code: string, @Body() dto: DisposeDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.upkeep.dispose(code, dto, caller);
  }

  /**
   * Dispose selected on All Assets (an Assets manager; 25 October 2026): { codes (at most 200), method, date, approvedBy,
   * note } → { disposed, skipped }, each through the rules above.
   */
  @AssetsLevel('manager')
  @Post('bulk-dispose')
  @HttpCode(200)
  bulkDispose(@Body() dto: BulkDisposeDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.upkeep.bulkDispose(dto, caller);
  }

  /** The amount a disposal received: the CEO, Finance or a Super Admin. */
  @AssetValues()
  @Patch(':code/disposal')
  setDisposalAmount(@Param('code') code: string, @Body() dto: DisposalAmountDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.upkeep.setDisposalAmount(code, dto, caller);
  }
}
