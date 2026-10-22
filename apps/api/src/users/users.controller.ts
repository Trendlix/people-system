import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { CreateUserDto, SetPasswordDto, UpdateUserDto } from './user.dto.js';
import { UsersService } from './users.service.js';

// Only admins manage sign-in accounts: the role applies to every endpoint here. A Super Admin is an admin too; only a
// Super Admin gives or takes away that role, or changes a Super Admin's account (see UsersService).
@Roles('admin')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** ?only=other: the accounts not linked to an employee (the Users page); else every account (the View-as list). */
  @Get()
  list(@Query('only') only?: string) {
    return this.users.list(only === 'other' ? 'other' : undefined);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() user: SessionUser) {
    return this.users.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: SessionUser) {
    return this.users.update(id, dto, user);
  }

  @Put(':id/password')
  @HttpCode(204)
  setPassword(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPasswordDto, @CurrentUser() user: SessionUser) {
    return this.users.setPassword(id, dto, user);
  }
}
