import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile, UploadedFile, UseFilters, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser, NotForDevelopers } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { FileTooLargeFilter } from '../paperwork/file-too-large.filter.js';
import { contentDisposition, PAPERWORK_MAX_BYTES } from '../paperwork/paperwork-file.js';
import { AssetRepairsService } from './asset-repairs.service.js';
import { AssetsLevel, CurrentAssetsCaller, type AssetsCaller } from './assets-access.js';
import { CustodyFilesService, type CustodyFile } from './custody-files.service.js';
import { CustodyListQueryDto, CustodyPeopleQueryDto, HandoverDto, LostFoundDto, RepairDto, ReturnDto } from './custody.dto.js';
import { CustodyService } from './custody.service.js';

// The custody routes (Assets step 3; packages/shared custody.ts has every answer's shape). Each names the Assets access
// it needs, checked by AssetsGuard after the sign-in: anyone with access (a viewer and up) reads the Custody list, a
// record and its signed copies, the holdings and an asset's history; a custodian or a manager hands over, receives back,
// attaches the signed copy, and sends an asset to repair and back, or marks it lost and found. My custody (owner, 21
// October 2026: "Yes, My custody") is anyone's own, with no Assets access needed. None of these is open to the Claude
// connector (its brief: "No custody actions through the connector"): it reads who holds what and the overdue returns
// through the reports. Registered before the assets' controller, so /assets/custody is never read as an asset's code.

// File names are read as UTF-8, so Arabic names arrive intact; at most 10 MB, as the employee file's papers.
const ONE_FILE = { limits: { fileSize: PAPERWORK_MAX_BYTES, files: 1, fields: 5 }, defParamCharset: 'utf8' };

/** A signed copy, shown in the browser (a PDF or a photo), never kept by it. */
function sent(res: Response, file: CustodyFile): StreamableFile {
  res.setHeader('Content-Disposition', contentDisposition(file.fileName));
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (file.type !== 'application/pdf') res.setHeader('Content-Security-Policy', "default-src 'none'");
  return new StreamableFile(file.data, { type: file.type, length: file.data.length });
}

@Controller('assets/custody')
export class CustodyController {
  constructor(
    private readonly custody: CustodyService,
    private readonly files: CustodyFilesService,
  ) {}

  /** ?filter=active|overdue|unsigned|closed|all (Active unless asked) &q= &page=. */
  @AssetsLevel('viewer')
  @Get()
  list(@Query() query: CustodyListQueryDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.custody.list(query, caller);
  }

  /** What the handover form chooses from. */
  @AssetsLevel('custodian')
  @Get('choices')
  choices(@CurrentAssetsCaller() caller: AssetsCaller) {
    return this.custody.choices(caller);
  }

  /** ?q= a name or an employee code: the holdings' cards; none: everyone holding something now. */
  @AssetsLevel('viewer')
  @Get('people')
  people(@Query() query: CustodyPeopleQueryDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.custody.people(query.q, caller);
  }

  @AssetsLevel('viewer')
  @Get('people/:employeeId')
  holdings(@Param('employeeId', ParseUUIDPipe) employeeId: string, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.custody.holdings(employeeId, caller);
  }

  /** A handover: { record, skipped }. */
  @AssetsLevel('custodian')
  @Post()
  handOver(@Body() dto: HandoverDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.custody.handOver(dto, caller);
  }

  @AssetsLevel('viewer')
  @Get(':code')
  get(@Param('code') code: string, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.custody.get(code, caller);
  }

  /** Items received back: { lines: [{ itemId, condition, notes }] }. */
  @AssetsLevel('custodian')
  @Post(':code/return')
  @HttpCode(200)
  receive(@Param('code') code: string, @Body() dto: ReturnDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.custody.receive(code, dto, caller);
  }

  /** The signed copy (the field `file`): a photo or a PDF. */
  @AssetsLevel('custodian')
  @Post(':code/signed')
  @UseFilters(FileTooLargeFilter)
  @UseInterceptors(FileInterceptor('file', ONE_FILE))
  attach(@Param('code') code: string, @UploadedFile() file: Express.Multer.File | undefined, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.files.attach(code, file, caller);
  }

  @AssetsLevel('viewer')
  @NotForDevelopers()
  @Get(':code/signed/:fileId')
  async signed(
    @Param('code') code: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @CurrentAssetsCaller() caller: AssetsCaller,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sent(res, await this.files.file(code, fileId, caller.user));
  }
}

/** My custody (owner, 21 October 2026: "Yes, My custody"): anyone's own, read only. */
@Controller('me/custody')
export class MyCustodyController {
  constructor(
    private readonly custody: CustodyService,
    private readonly files: CustodyFilesService,
  ) {}

  @Get()
  mine(@CurrentUser() user: SessionUser) {
    return this.custody.mine(user);
  }

  /** Their own signed form. */
  @NotForDevelopers()
  @Get(':code/files/:fileId')
  async file(@Param('code') code: string, @Param('fileId', ParseUUIDPipe) fileId: string, @CurrentUser() user: SessionUser, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return sent(res, await this.files.myFile(code, fileId, user));
  }
}

/** An asset's history and the actions of its page besides editing (custody and the repairs, lost and found). */
@Controller('assets')
export class AssetActionsController {
  constructor(
    private readonly custody: CustodyService,
    private readonly repairs: AssetRepairsService,
  ) {}

  /** Its custody history, its maintenance log and what its page may do now. */
  @AssetsLevel('viewer')
  @Get(':code/history')
  @Header('Cache-Control', 'private, no-store')
  history(@Param('code') code: string, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.custody.assetHistory(code, caller);
  }

  @AssetsLevel('custodian')
  @Post(':code/repair')
  @HttpCode(200)
  sendToRepair(@Param('code') code: string, @Body() dto: RepairDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.repairs.repair(code, dto, caller, false);
  }

  @AssetsLevel('custodian')
  @Post(':code/repair/back')
  @HttpCode(200)
  backFromRepair(@Param('code') code: string, @Body() dto: RepairDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.repairs.repair(code, dto, caller, true);
  }

  @AssetsLevel('custodian')
  @Post(':code/lost')
  @HttpCode(200)
  markLost(@Param('code') code: string, @Body() dto: LostFoundDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.repairs.lostOrFound(code, dto, caller, false);
  }

  @AssetsLevel('custodian')
  @Post(':code/found')
  @HttpCode(200)
  markFound(@Param('code') code: string, @Body() dto: LostFoundDto, @CurrentAssetsCaller() caller: AssetsCaller) {
    return this.repairs.lostOrFound(code, dto, caller, true);
  }
}
