import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../../auth/decorators.js';
import type { SessionUser } from '../../auth/session-user.js';
import { CreateShiftDto, UpdateShiftDto } from './shift.dto.js';
import { ShiftsService } from './shifts.service.js';

@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get()
  list() {
    return this.shifts.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.shifts.get(id);
  }

  @Roles('hr', 'admin')
  @Post()
  create(@Body() dto: CreateShiftDto, @CurrentUser() user: SessionUser) {
    return this.shifts.create(dto, user.id);
  }

  @Roles('hr', 'admin')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateShiftDto, @CurrentUser() user: SessionUser) {
    return this.shifts.update(id, dto, user.id);
  }

  @Roles('hr', 'admin')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.shifts.remove(id, user.id);
  }
}
