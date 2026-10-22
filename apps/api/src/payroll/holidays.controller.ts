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
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser, DeletesRecords, DeveloperMaySee, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { todayInCairo } from '../common/date-only.js';
import { attachment } from '../templates/template-file.js';
import { XLSX_TYPE } from './bank-files.js';
import { IMPORT_MAX_BYTES } from './holidays-import.js';
import { HolidayFileTooLargeFilter } from './holidays-import.filter.js';
import { ConfirmHolidayImportDto, CreateHolidayDto, HolidaysQueryDto, UpdateHolidayDto } from './holidays.dto.js';
import { HolidaysService } from './holidays.service.js';

// The official holidays (Organization → Holidays, owner's request of 16 October 2026; its own tab since the owner's
// "make holiday a separate tab" the same day): every signed-in user reads them, as they aren't sensitive, for the
// employee's dashboard (owner, 17 October 2026: "the dashboard may contain the data he might need such as Holidays";
// before, HR, Finance, the CEO and Admin, as the payroll settings); HR and Admin add and change them, and import a
// year's list from a file (owner's request, 16 October 2026: "allow me to import yearly holiday list"); a Super Admin
// removes one (every deletion is a Super Admin's: owner's decision, 15 October 2026).

// One holiday list (.xlsx or .csv, told apart by its content) of up to 1 MB, and the fingerprint to confirm it with.
const ONE_LIST = { limits: { fileSize: IMPORT_MAX_BYTES, files: 1, fields: 2 } };

@Controller('payroll/holidays')
export class HolidaysController {
  constructor(private readonly holidays: HolidaysService) {}

  /** ?year=YYYY: that year's, in date order; every holiday without it. Any signed-in user. */
  @Get()
  list(@Query() query: HolidaysQueryDto) {
    return this.holidays.list(query.year);
  }

  /**
   * The template to fill in for an import, as an Excel workbook ("Holidays template 2027.xlsx"): the columns Date,
   * Until, Name (English), Name (Arabic), an example row in ?year= (this year without it) and a sheet on the formats.
   */
  @Roles('hr', 'admin')
  @DeveloperMaySee()
  @Get('template.xlsx')
  @Header('Cache-Control', 'private, no-store')
  async template(@Query() query: HolidaysQueryDto): Promise<StreamableFile> {
    const file = await this.holidays.template(query.year ?? Number(todayInCairo().slice(0, 4)));
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }

  /**
   * Step 1 of an import: the file (`file`, .xlsx or .csv) read, nothing saved. { fingerprint, rows, days: [{ row,
   * date, nameEn, nameAr, status: new | on_file | clash | duplicate, onFile?, firstRow? }], problems: [{ row, message }] }.
   */
  @Roles('hr', 'admin')
  @Post('import/preview')
  @HttpCode(200)
  @UseFilters(HolidayFileTooLargeFilter)
  @UseInterceptors(FileInterceptor('file', ONE_LIST))
  previewImport(@UploadedFile() file: Express.Multer.File | undefined) {
    return this.holidays.previewImport(file);
  }

  /**
   * Step 2: the same file again with the preview's `fingerprint`; the new days added, all or none. Answers the preview
   * as checked at that moment, with `imported`: the holidays added, in date order.
   */
  @Roles('hr', 'admin')
  @Post('import')
  @UseFilters(HolidayFileTooLargeFilter)
  @UseInterceptors(FileInterceptor('file', ONE_LIST))
  importFile(@UploadedFile() file: Express.Multer.File | undefined, @Body() dto: ConfirmHolidayImportDto, @CurrentUser() user: SessionUser) {
    return this.holidays.importFile(file, dto.fingerprint, user);
  }

  /** { date: 'YYYY-MM-DD', nameEn, nameAr? } */
  @Roles('hr', 'admin')
  @Post()
  create(@Body() dto: CreateHolidayDto, @CurrentUser() user: SessionUser) {
    return this.holidays.create(dto, user);
  }

  @Roles('hr', 'admin')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateHolidayDto, @CurrentUser() user: SessionUser) {
    return this.holidays.update(id, dto, user);
  }

  @DeletesRecords()
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.holidays.remove(id, user);
  }
}
