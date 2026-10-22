import { Body, Controller, Get, Header, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, StreamableFile } from '@nestjs/common';
import { isAssetExport } from '@trendlix/shared';
import { XLSX_TYPE } from '../payroll/bank-files.js';
import { attachment } from '../templates/template-file.js';
import { AssetCountsService } from './asset-counts.service.js';
import { AssetDashboardService } from './asset-dashboard.service.js';
import { AssetExportsService } from './asset-exports.service.js';
import { AssetLabelsService } from './asset-labels.service.js';
import { AssetsLevel, CurrentAssetsCaller, type AssetsCaller } from './assets-access.js';
import { AssetCountDto, AssetCountScopeDto, AssetCountsQueryDto, AssetLabelledDto, AssetLabelsQueryDto, MarkLostFromCountDto } from './asset-counts.dto.js';
import { NotForDevelopers } from '../auth/decorators.js';

// The Assets step 5 routes (owner, 22 October 2026: "Assets step 5 (stock counts, label sheets, the Assets dashboard,
// exports) … work on this"; packages/shared asset-counts.ts has every answer's shape). Each names the Assets access it
// needs, checked by AssetsGuard after the sign-in: anyone with access (a viewer and up) reads the counts, the sheets,
// the dashboard, the label choices and downloads the exports (their money columns only for the CEO, Finance and a Super
// Admin); a custodian or a manager counts, marks a missing asset lost and marks labels printed. None is open to the
// Claude connector (it reads the counts due through the reports). Registered before the assets' controller in the
// module, so /assets/counts, /assets/dashboard, /assets/exports and /assets/labels are never read as an asset's code.

@Controller('assets/counts')
export class AssetCountsController {
  constructor(private readonly counts: AssetCountsService) {}

  /** The groups' schedule and the counts made: ?page=. */
  @AssetsLevel('viewer')
  @Get()
  list(@Query() query: AssetCountsQueryDto) {
    return this.counts.list(query.page);
  }

  /** What a count of ?kind=group&group= | room&roomId= | kit&kitId= expects now. */
  @AssetsLevel('viewer')
  @Get('sheet')
  sheet(@Query() query: AssetCountScopeDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.counts.sheet(query, caller);
  }

  @AssetsLevel('custodian')
  @Post()
  record(@Body() dto: AssetCountDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.counts.record(dto, caller);
  }

  @AssetsLevel('viewer')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.counts.get(id, caller);
  }

  /** A missing asset of the count marked lost (spec §6.5: a deliberate step). */
  @AssetsLevel('custodian')
  @Post(':id/lines/:code/lost')
  @HttpCode(200)
  markLost(@Param('id', ParseUUIDPipe) id: string, @Param('code') code: string, @Body() dto: MarkLostFromCountDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.counts.markLost(id, code, dto, caller);
  }
}

@Controller('assets/dashboard')
export class AssetDashboardController {
  constructor(private readonly dashboard: AssetDashboardService) {}

  @AssetsLevel('viewer')
  @Get()
  view(@CurrentAssetsCaller() caller: AssetsCaller) {
    return this.dashboard.view(caller);
  }
}

@Controller('assets/exports')
export class AssetExportsController {
  constructor(private readonly exports: AssetExportsService) {}

  /** An Excel workbook: register, custody, stock, maintenance or counts. */
  @AssetsLevel('viewer')
  @NotForDevelopers()
  @Get(':kind')
  @Header('Cache-Control', 'private, no-store')
  async download(@Param('kind') kind: string, @CurrentAssetsCaller() caller: AssetsCaller): Promise<StreamableFile> {
    if (!isAssetExport(kind)) throw new NotFoundException('Export not found.');
    const file = await this.exports.workbook(kind, caller);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }
}

@Controller('assets/labels')
export class AssetLabelsController {
  constructor(private readonly labels: AssetLabelsService) {}

  /** ?unlabelled=1 &group= &roomId= &kitId= &q=, or ?codes=A,B: the assets the sheets may print. */
  @AssetsLevel('viewer')
  @Get()
  choices(@Query() query: AssetLabelsQueryDto) {
    return this.labels.choices(query);
  }

  @AssetsLevel('custodian')
  @Post('labelled')
  @HttpCode(200)
  labelled(@Body() dto: AssetLabelledDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.labels.labelled(dto, caller);
  }
}
