import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators.js';
import type { SessionUser } from '../../auth/session-user.js';
import { OrgChartService } from './org-chart.service.js';

@Controller('org-chart')
export class OrgChartController {
  constructor(private readonly chart: OrgChartService) {}

  /** Everything the org chart draws, in one read: everyone signed in; the people's names for HR, the CEO and Finance only. */
  @Get()
  get(@CurrentUser() user: SessionUser) {
    return this.chart.get(user);
  }
}
