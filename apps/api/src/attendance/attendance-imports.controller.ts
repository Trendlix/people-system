import { ArgumentsHost, Body, Catch, Controller, ExceptionFilter, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, PayloadTooLargeException, Post, UploadedFiles, UseFilters, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { AttendancePersonDto } from './attendance-imports.dto.js';
import { AttendanceImportsService } from './attendance-imports.service.js';
import { ZOHO_MAX_BYTES, ZOHO_MAX_FILES, ZOHO_TOO_LARGE } from './zoho-file.js';

// Attendance from Zoho People on a draft payroll run (owner, 19 October 2026: "Import Zoho now, replace it later"): HR
// uploads Zoho's attendance entries (one file with everyone or many, .xlsx), reviews who each person is and their month
// by the system's rules, confirms or picks those not matched, and applies it to the run's lines; the CEO sees the
// review and applies the C-level people's lines (the CEO fills them: owner, 19 October 2026), who HR doesn't see.

// The files (each .xlsx of up to 5 MB, at most 60): one more than the most is let through so the service can say so in
// words HR understand, rather than the upload library's.
const FILES = { limits: { fileSize: ZOHO_MAX_BYTES, files: ZOHO_MAX_FILES + 1, fields: 5 } };

/** A file over the limit, said in words HR understand instead of the upload library's "File too large". */
@Catch(PayloadTooLargeException)
export class AttendanceFileTooLargeFilter implements ExceptionFilter {
  catch(_err: PayloadTooLargeException, host: ArgumentsHost) {
    const status = HttpStatus.PAYLOAD_TOO_LARGE;
    host.switchToHttp().getResponse<Response>().status(status).json({ statusCode: status, message: ZOHO_TOO_LARGE });
  }
}

@Controller('payroll/runs/:id/attendance-imports')
export class AttendanceImportsController {
  constructor(private readonly imports: AttendanceImportsService) {}

  /** The run's imports, the latest first. */
  @Roles('hr', 'ceo')
  @Get()
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.imports.list(id);
  }

  /** A multipart upload of `files` (Zoho's attendance entries, .xlsx): read and kept for the review, nothing applied. */
  @Roles('hr')
  @Post()
  @UseFilters(AttendanceFileTooLargeFilter)
  @UseInterceptors(FilesInterceptor('files', ZOHO_MAX_FILES + 1, FILES))
  upload(@Param('id', ParseUUIDPipe) id: string, @UploadedFiles() files: Express.Multer.File[] | undefined, @CurrentUser() user: SessionUser) {
    return this.imports.upload(id, files, user);
  }

  @Roles('hr', 'ceo')
  @Get(':importId')
  view(@Param('id', ParseUUIDPipe) id: string, @Param('importId', ParseUUIDPipe) importId: string, @CurrentUser() user: SessionUser) {
    return this.imports.view(id, importId, user);
  }

  /** { key, employeeId?: uuid | null, skipped?: boolean }: who a person of the files is, HR's choice. */
  @Roles('hr', 'ceo')
  @Patch(':importId/people')
  choose(@Param('id', ParseUUIDPipe) id: string, @Param('importId', ParseUUIDPipe) importId: string, @Body() dto: AttendancePersonDto, @CurrentUser() user: SessionUser) {
    return this.imports.choose(id, importId, dto, user);
  }

  /** Fills the run's lines the caller fills from it: worked hours, no-show days, permission hours. */
  @Roles('hr', 'ceo')
  @Post(':importId/apply')
  @HttpCode(200)
  apply(@Param('id', ParseUUIDPipe) id: string, @Param('importId', ParseUUIDPipe) importId: string, @CurrentUser() user: SessionUser) {
    return this.imports.apply(id, importId, user);
  }
}
