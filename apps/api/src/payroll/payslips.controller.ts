import { BadRequestException, Controller, Get, Header, Param, ParseUUIDPipe, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { pdfFile, wantsDownload } from '../pdf/pdf-file.js';
import { attachment } from '../templates/template-file.js';
import { isPayslipLanguage } from './payslip-content.js';
import { PayslipsService } from './payslips.service.js';

// Payslips (owner's decisions, 16 October 2026): HR, Finance and the CEO download them, like the run's other files
// (salary data). A run's English payslips as a ZIP once it is marked paid; a line's payslip in English or Arabic as a
// protected PDF, drawn the first time it is asked for; and the employee file's list of months paid. The employee file's
// route is here rather than in the employees module, with the rest of the payslips.
@Controller()
export class PayslipsController {
  constructor(private readonly payslips: PayslipsService) {}

  /** The run's English payslips (.zip): "Payslips 2026-10.zip", one "Payslip 2026-10 EMP-0007.pdf" each. */
  @Roles('hr', 'finance', 'ceo')
  @Get('payroll/runs/:id/payslips')
  @Header('Cache-Control', 'private, no-store')
  async run(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.payslips.runZip(id, user);
    return new StreamableFile(file.data, { type: 'application/zip', length: file.data.length, disposition: attachment(file.fileName) });
  }

  /** A line's payslip, en or ar, as a protected PDF shown in the browser (saved with ?download=1). */
  @Roles('hr', 'finance', 'ceo')
  @Get('payroll/lines/:lineId/payslip/:language')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async line(
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Param('language') language: string,
    @Query('download') download: string | undefined,
    @CurrentUser() user: SessionUser,
  ): Promise<StreamableFile> {
    if (!isPayslipLanguage(language)) throw new BadRequestException('Choose the payslip’s language: en (English) or ar (Arabic).');
    return pdfFile(await this.payslips.lineFile(lineId, language, user), wantsDownload(download));
  }

  /** The employee's months paid, newest first, with which payslips are drawn. */
  @Roles('hr', 'finance', 'ceo')
  @Get('employees/:id/payslips')
  employee(@Param('id', ParseUUIDPipe) id: string) {
    return this.payslips.employeePayslips(id);
  }
}
