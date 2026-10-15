import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

// Sign-in accounts for colleagues: roles, deactivation and temporary passwords. Admins (and Super Admins) only.
@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
