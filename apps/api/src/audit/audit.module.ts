import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditContextInterceptor } from './audit-context.js';
import { AuditService } from './audit.service.js';

@Global()
@Module({
  providers: [AuditService, { provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor }],
  exports: [AuditService],
})
export class AuditModule {}
