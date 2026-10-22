import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ConnectorTokensService } from '../connector/connector-tokens.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { DeveloperInterceptor } from './developer.interceptor.js';
import { DeviceCredentialsService } from './device-credentials.service.js';
import { SessionsService } from './sessions.service.js';
import { UserDevicesController } from './user-devices.controller.js';
import { UserSessionsController } from './user-sessions.controller.js';
import { ViewAsController } from './view-as.controller.js';
import { ViewAsService } from './view-as.service.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('JWT_SECRET') }),
    }),
  ],
  controllers: [AuthController, ViewAsController, UserSessionsController, UserDevicesController],
  // the Claude connector's tokens, checked by the guard (21 October 2026)
  // the Developer role's masking and file refusals (22 October 2026), after the guard on every request
  providers: [
    AuthService,
    SessionsService,
    DeviceCredentialsService,
    ViewAsService,
    ConnectorTokensService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: DeveloperInterceptor },
  ],
})
export class AuthModule {}
