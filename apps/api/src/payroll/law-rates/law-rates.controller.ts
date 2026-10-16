import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Put, SetMetadata } from '@nestjs/common';
import { CurrentUser, DeletesRecords, FORBIDDEN_MESSAGE, Roles } from '../../auth/decorators.js';
import type { SessionUser } from '../../auth/session-user.js';
import { PutLawRatesDto } from './law-rates.dto.js';
import { LawRatesService, ONLY_SUPER_ADMIN_CHANGES_LAW_RATES } from './law-rates.service.js';

/** The year in the address: a whole number. */
const Year = () => Param('year', new ParseIntPipe({ exceptionFactory: () => new BadRequestException('The year must be a whole number, e.g. 2027.') }));

// The rates set by law, by year (owner's request, 16 October 2026; Organization → Payroll): HR, Finance, the CEO and
// Admin read them, the Super Admin alone changes them (the tax brackets "editable by superadmin, to modify it if the
// law changed"), and deletes a year, like every deletion. The service checks the Super Admin again.
@Controller('payroll/law-rates')
export class LawRatesController {
  constructor(private readonly lawRates: LawRatesService) {}

  /** Every year's rates, oldest first, with who changed them last. */
  @Roles('hr', 'finance', 'ceo', 'admin')
  @Get()
  list() {
    return this.lawRates.list();
  }

  /** Adds a year's rates or replaces them: every value, the rates as fractions (0.11 for 11%). */
  @Roles('super_admin')
  @SetMetadata(FORBIDDEN_MESSAGE, ONLY_SUPER_ADMIN_CHANGES_LAW_RATES)
  @Put(':year')
  put(@Year() year: number, @Body() dto: PutLawRatesDto, @CurrentUser() user: SessionUser) {
    return this.lawRates.put(year, dto, user);
  }

  /** A year other than the earliest: the years it covered use the year before. */
  @DeletesRecords()
  @Delete(':year')
  @HttpCode(204)
  remove(@Year() year: number, @CurrentUser() user: SessionUser) {
    return this.lawRates.remove(year, user);
  }
}
