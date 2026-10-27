import { Controller, Get, Header, Param, ParseUUIDPipe, StreamableFile } from '@nestjs/common';
import { CurrentUser, NotForDevelopers, Roles } from '../../auth/decorators.js';
import type { SessionUser } from '../../auth/session-user.js';
import { attachment } from '../../templates/template-file.js';
import { XLSX_TYPE } from '../bank-files.js';
import { EtaFileService, type EtaCheck } from './eta.service.js';

// The ETA salary-tax file of an approved payroll, beside the register and the bank files (owner, 27 October 2026),
// and the check the page shows before it: who is in it, and where ETA's tax differs from the payroll's.
@Controller('payroll/runs')
export class PayrollEtaController {
  constructor(private readonly eta: EtaFileService) {}

  @Roles('hr', 'finance', 'ceo')
  @NotForDevelopers()
  @Get(':id/files/eta')
  @Header('Cache-Control', 'private, no-store')
  async file(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.eta.file(id, user);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }

  @Roles('hr', 'finance', 'ceo')
  @NotForDevelopers()
  @Get(':id/files/eta/check')
  @Header('Cache-Control', 'private, no-store')
  check(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<EtaCheck> {
    return this.eta.check(id, user);
  }
}
