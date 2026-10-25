import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

export const CAREERS_KEY_HEADER = 'x-careers-key';

export function careersKeyOk(sent: unknown, key: string | undefined = process.env.CAREERS_KEY): boolean {
  const expected = key?.trim();
  if (!expected || expected.length < 32 || typeof sent !== 'string') return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class CareersKeyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!careersKeyOk(ctx.switchToHttp().getRequest<Request>().headers[CAREERS_KEY_HEADER])) throw new UnauthorizedException();
    return true;
  }
}
