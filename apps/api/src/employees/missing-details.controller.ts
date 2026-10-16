import { Controller, Get, Header, StreamableFile } from '@nestjs/common';
import { Roles } from '../auth/decorators.js';
import { XLSX_TYPE } from '../payroll/bank-files.js';
import { attachment } from '../templates/template-file.js';
import { MissingDetailsService } from './missing-details.service.js';

// The Missing Details report: HR and the CEO, who see the employee file whose papers it lists (seesEmployeeFile).
// Registered before EmployeesController, so /employees/missing is never taken for a profile's /employees/:id.
@Controller('employees')
export class MissingDetailsController {
  constructor(private readonly missingDetails: MissingDetailsService) {}

  /** { generatedAt, rows: [{ id, employeeCode, fullNameEn, fullNameAr, standing, department, jobTitle, percent, missing }] } */
  @Roles('hr', 'ceo')
  @Get('missing')
  report() {
    return this.missingDetails.report();
  }

  /** The same report as an Excel workbook: "Missing details YYYY-MM-DD.xlsx". */
  @Roles('hr', 'ceo')
  @Get('missing.xlsx')
  @Header('Cache-Control', 'private, no-store')
  async workbook(): Promise<StreamableFile> {
    const file = await this.missingDetails.workbook();
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }
}
