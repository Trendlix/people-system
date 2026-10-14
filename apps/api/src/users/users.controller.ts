import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { CreateUserDto, SetPasswordDto, UpdateUserDto } from './user.dto.js';
import { UsersService } from './users.service.js';

// Only admins manage sign-in accounts: the role applies to every endpoint here.
@Roles('admin')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() user: SessionUser) {
    return this.users.create(dto, user.id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: SessionUser) {
    return this.users.update(id, dto, user);
  }

  @Put(':id/password')
  @HttpCode(204)
  setPassword(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPasswordDto, @CurrentUser() user: SessionUser) {
    return this.users.setPassword(id, dto, user.id);
  }
}
