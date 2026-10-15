import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ContractSettingsService } from './contract-settings.service.js';
import { UpdateContractSettingsDto, UpdateEndingRuleDto } from './contracts.dto.js';
import { EndingRulesService } from './ending-rules.service.js';

// The contract defaults and the ending rules: every signed-in user reads them (the screens need them); HR and Admin
// change them in Settings.
@Controller('contract-settings')
export class ContractSettingsController {
  constructor(private readonly settings: ContractSettingsService) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Roles('hr', 'admin')
  @Patch()
  update(@Body() dto: UpdateContractSettingsDto, @CurrentUser() user: SessionUser) {
    return this.settings.update(dto, user);
  }
}

@Controller('ending-rules')
export class EndingRulesController {
  constructor(private readonly rules: EndingRulesService) {}

  @Get()
  list() {
    return this.rules.list();
  }

  @Roles('hr', 'admin')
  @Patch(':key')
  update(@Param('key') key: string, @Body() dto: UpdateEndingRuleDto, @CurrentUser() user: SessionUser) {
    return this.rules.update(key, dto, user);
  }
}
