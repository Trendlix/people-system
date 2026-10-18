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
  Query,
  StreamableFile,
  UploadedFiles,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { REIMBURSEMENT_RECEIPTS_MAX } from '@trendlix/shared';
import { CurrentUser, DeletesRecords, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { contentDisposition } from '../paperwork/paperwork-file.js';
import { RECEIPT_UPLOAD, ReceiptUploadFilter } from './receipts.js';
import { ReimbursementTypesService } from './reimbursement-types.service.js';
import {
  CreateReimbursementDto,
  CreateReimbursementTypeDto,
  DecideReimbursementDto,
  ListReimbursementsDto,
  MyReimbursementTypesQueryDto,
  UpdateReimbursementTypeDto,
} from './reimbursements.dto.js';
import { ReimbursementsService } from './reimbursements.service.js';

// Reimbursements (owner, 18 October 2026: "allow the employee to add reimbursement request … for specific preset up
// conditions", "in the setup i need to enter for it a cap"). The types: HR adds and changes them in Payroll Setup;
// Finance and the CEO read them, and an Admin or Super Admin too, as Payroll Setup's other sections (only a Super Admin
// deletes one, one without claims). The employee's own: the types they may claim, their claims, a new one with its
// receipts, and cancelling one still open. Deciding and seeing them: the claim's direct manager, HR and Finance in turn,
// the CEO reading (checked by the service, which tells anyone else a claim isn't there).

@Controller('reimbursement-types')
export class ReimbursementTypesController {
  constructor(private readonly types: ReimbursementTypesService) {}

  @Roles('hr', 'finance', 'ceo', 'admin')
  @Get()
  list() {
    return this.types.list();
  }

  @Roles('hr')
  @Post()
  create(@Body() dto: CreateReimbursementTypeDto, @CurrentUser() user: SessionUser) {
    return this.types.create(dto, user);
  }

  /** Each field sent; the conditions changed apply to the claims sent after. HR turns one off with { active: false }. */
  @Roles('hr')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReimbursementTypeDto, @CurrentUser() user: SessionUser) {
    return this.types.update(id, dto, user);
  }

  @DeletesRecords()
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.types.remove(id, user);
  }
}

/** The employee's own: anyone signed in with an employee profile. */
@Controller('me')
export class MyReimbursementsController {
  constructor(private readonly claims: ReimbursementsService) {}

  /** ?expenseDate=YYYY-MM-DD: the types they may claim, with what their claims take of each one's caps in its month and year. */
  @Get('reimbursement-types')
  types(@Query() query: MyReimbursementTypesQueryDto, @CurrentUser() user: SessionUser) {
    return this.claims.typesForMe(query.expenseDate, user);
  }

  @Get('reimbursements')
  mine(@CurrentUser() user: SessionUser) {
    return this.claims.mine(user);
  }

  /** A form: typeId, expenseDate, amount, description, and up to REIMBURSEMENT_RECEIPTS_MAX files as `receipts`. */
  @Post('reimbursements')
  @UseFilters(ReceiptUploadFilter)
  @UseInterceptors(FilesInterceptor('receipts', REIMBURSEMENT_RECEIPTS_MAX + 1, RECEIPT_UPLOAD))
  create(@Body() dto: CreateReimbursementDto, @UploadedFiles() files: Express.Multer.File[] | undefined, @CurrentUser() user: SessionUser) {
    return this.claims.create(dto, files, user);
  }

  @Post('reimbursements/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.claims.cancel(id, user);
  }
}

@Controller('reimbursements')
export class ReimbursementsController {
  constructor(private readonly claims: ReimbursementsService) {}

  /** ?status=<a status, or waiting>&employeeId=: HR, Finance and the CEO everyone's; a manager those sent to them. */
  @Get()
  list(@Query() query: ListReimbursementsDto, @CurrentUser() user: SessionUser) {
    return this.claims.list(query, user);
  }

  /** { waiting }: how many wait for the caller's decision. */
  @Get('counts')
  counts(@CurrentUser() user: SessionUser) {
    return this.claims.counts(user);
  }

  @Get(':id')
  one(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.claims.one(id, user);
  }

  @Get(':id/receipts/:receiptId')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async receipt(@Param('id', ParseUUIDPipe) id: string, @Param('receiptId', ParseUUIDPipe) receiptId: string, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const { data, type, fileName } = await this.claims.receipt(id, receiptId, user);
    return new StreamableFile(data, { type, length: data.length, disposition: contentDisposition(fileName) });
  }

  /** { decision: approve | approve_other | reject, amount? (approve_other), comment? (required but to approve) }. */
  @Post(':id/decide')
  @HttpCode(200)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideReimbursementDto, @CurrentUser() user: SessionUser) {
    return this.claims.decide(id, dto, user);
  }
}
