import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  PayloadTooLargeException,
  Post,
  StreamableFile,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser, DeletesRecords, DeveloperMaySee, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { XLSX_TYPE } from '../payroll/bank-files.js';
import { attachment } from '../templates/template-file.js';
import { LEAVE_FILE_TOO_LARGE, LEAVE_IMPORT_MAX_BYTES } from './leave-import-file.js';
import { LeaveImportPersonDto, LeaveImportTypeDto } from './leave-import.dto.js';
import { LeaveImportService } from './leave-import.service.js';

// Importing leave in bulk (owner, 21 October 2026: "how to import bulk leaves?"; "Both" and "Our Excel template"; Zoho
// People's leave export too): the template to fill, the upload read and kept for the review, HR's choices on it (who a
// person is, a Zoho type's mapping), Apply, Undo and the imports' history. HR, and the CEO for the C-level people (who
// HR doesn't see: owner, 19 October 2026); each service method checks again whose rows the caller applies or undoes. A
// Super Admin deletes an import with nothing left of it (every deletion is a Super Admin's: owner, 15 October 2026).

const ONE_FILE = { limits: { fileSize: LEAVE_IMPORT_MAX_BYTES, files: 1, fields: 2 }, defParamCharset: 'utf8' };

/** A file over the limit, said in words HR understand instead of the upload library's "File too large". */
@Catch(PayloadTooLargeException)
export class LeaveFileTooLargeFilter implements ExceptionFilter {
  catch(_err: PayloadTooLargeException, host: ArgumentsHost) {
    const status = HttpStatus.PAYLOAD_TOO_LARGE;
    host.switchToHttp().getResponse<Response>().status(status).json({ statusCode: status, message: LEAVE_FILE_TOO_LARGE });
  }
}

@Controller('leave/import')
export class LeaveImportController {
  constructor(private readonly imports: LeaveImportService) {}

  /** The template: Leaves taken, Balances and How to fill, with the leave types on and the employees the caller sees. */
  @Roles('hr', 'ceo')
  @DeveloperMaySee()
  @Get('template')
  @Header('Cache-Control', 'private, no-store')
  async template(@CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.imports.template(user);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }

  /** Every import, the latest first. */
  @Roles('hr', 'ceo')
  @Get()
  history() {
    return this.imports.history();
  }

  /** A multipart upload of `file` (the template filled in, or Zoho People's leave export, .xlsx): read and kept for the review. */
  @Roles('hr', 'ceo')
  @Post()
  @UseFilters(LeaveFileTooLargeFilter)
  @UseInterceptors(FileInterceptor('file', ONE_FILE))
  upload(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: SessionUser) {
    return this.imports.upload(file, user);
  }

  @Roles('hr', 'ceo')
  @Get(':id')
  view(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.imports.view(id, user);
  }

  /** { key, employeeId?: uuid | null, skipped?: boolean }: who a person of the file is. */
  @Roles('hr', 'ceo')
  @Patch(':id/people')
  choosePerson(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LeaveImportPersonDto, @CurrentUser() user: SessionUser) {
    return this.imports.choosePerson(id, dto, user);
  }

  /** { zohoType, typeId?: uuid | null, skipped?: boolean }: the system's type a Zoho leave type is imported as. */
  @Roles('hr', 'ceo')
  @Patch(':id/types')
  mapType(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LeaveImportTypeDto, @CurrentUser() user: SessionUser) {
    return this.imports.mapType(id, dto, user);
  }

  /** Applies the rows ready that are the caller's: the leave, then the balances, in one transaction. */
  @Roles('hr', 'ceo')
  @Post(':id/apply')
  @HttpCode(200)
  apply(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.imports.apply(id, user);
  }

  /** Removes what it made that is the caller's, while no payroll counting it is past its draft. */
  @Roles('hr', 'ceo')
  @Post(':id/undo')
  @HttpCode(200)
  undo(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.imports.undo(id, user);
  }

  /** A Super Admin deletes an import with nothing left of it: not applied, or undone. */
  @DeletesRecords()
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.imports.remove(id, user);
  }
}
