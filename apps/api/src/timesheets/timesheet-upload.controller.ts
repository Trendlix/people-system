import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  PayloadTooLargeException,
  Post,
  StreamableFile,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser, DeveloperMaySee, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { XLSX_TYPE } from '../payroll/bank-files.js';
import { attachment } from '../templates/template-file.js';
import { HOURS_FILE_TOO_LARGE, TIMESHEET_UPLOAD_MAX_BYTES } from './timesheet-upload-file.js';
import { TimesheetUploadService, UPLOADS_FOR_OTHERS } from './timesheet-upload.service.js';

// Uploading hours from a file (owner, 5 November 2026: "how to upload a bulk time log?"; asked, "Our own Excel
// template", "each person and HR", HR's "Sent to the approver"). The template for the caller; someone on timesheets
// uploads their own (`send`: 'true' sends the weeks for approval too); HR, the CEO or a Super Admin uploads anyone's,
// each week sent to whoever approves it. The service checks every row and who may again.

const ONE_FILE = { limits: { fileSize: TIMESHEET_UPLOAD_MAX_BYTES, files: 1, fields: 2 }, defParamCharset: 'utf8' };

/** A file over the limit, said in words instead of the upload library's "File too large". */
@Catch(PayloadTooLargeException)
export class HoursFileTooLargeFilter implements ExceptionFilter {
  catch(_err: PayloadTooLargeException, host: ArgumentsHost) {
    const status = HttpStatus.PAYLOAD_TOO_LARGE;
    host.switchToHttp().getResponse<Response>().status(status).json({ statusCode: status, message: HOURS_FILE_TOO_LARGE });
  }
}

@Controller()
export class TimesheetUploadController {
  constructor(private readonly uploads: TimesheetUploadService) {}

  /** The template: Hours and How to fill, with the active clients and the employees whose codes go in it (no money in it). */
  @DeveloperMaySee()
  @Get('timesheets/upload/template')
  @Header('Cache-Control', 'private, no-store')
  async template(@CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.uploads.template(user);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }

  /** A multipart upload of `file` (.xlsx) and `send` ('true' sends the weeks for approval too): the caller's own hours. */
  @Post('me/timesheet/upload')
  @HttpCode(200)
  @UseFilters(HoursFileTooLargeFilter)
  @UseInterceptors(FileInterceptor('file', ONE_FILE))
  uploadMine(@UploadedFile() file: Express.Multer.File | undefined, @Body() body: { send?: unknown }, @CurrentUser() user: SessionUser) {
    return this.uploads.uploadMine(file, body?.send === 'true' || body?.send === true, user);
  }

  /** A multipart upload of `file` (.xlsx): anyone's hours by their codes, each week sent to whoever approves it. */
  @Roles(...UPLOADS_FOR_OTHERS)
  @Post('timesheets/upload')
  @HttpCode(200)
  @UseFilters(HoursFileTooLargeFilter)
  @UseInterceptors(FileInterceptor('file', ONE_FILE))
  uploadForOthers(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: SessionUser) {
    return this.uploads.uploadForOthers(file, user);
  }
}
