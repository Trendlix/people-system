import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { readToken } from '../auth/auth.guard.js';
import type { AuditService } from './audit.service.js';
import { auditContextOf, runInAuditContext, type AuditContext, type AuditedRequest } from './audit-context.js';
import { auditOriginOf } from './audit-origin.js';
import { isRecordedRefusal, refusedEntry } from './audit-refused.js';

// Every request, as it comes in and as it is answered, for the audit log (owner, 31 October 2026: "i want a log for all
// actions taken on the system ,, same as the one on trendlix website"): where it came from is read once, before
// anything else (audit-origin.ts), for the entries it writes (audit-context.ts); and a change a signed-in person was
// refused is written as the refusal is answered (audit-refused.ts), unless the service already wrote why (a check-in
// refused off the office network …): just before the answer goes, so the entry is there as soon as the person reads
// the refusal, or once it has gone for an answer sent another way. Never in the way: a failure here is logged and the
// request goes on as ever.

type AuditedExpressRequest = Request & AuditedRequest & { auditContext?: AuditContext };

const logger = new Logger('AuditRequests');

/** The middleware (configureApp, after the cookies are read): `key` is WEB_KEY, read on each request. */
export function auditRequests(audit: AuditService, key: () => string | undefined = () => process.env.WEB_KEY) {
  return (req: AuditedExpressRequest, res: Response, next: NextFunction): void => {
    try {
      req.auditOrigin = auditOriginOf(req.headers, readToken(req), key(), Date.now(), req.socket?.remoteAddress);
    } catch (err) {
      logger.warn(`Where a request came from could not be read: ${(err as Error).message}`);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      let written = false;
      const write = (body: unknown): Promise<void> => {
        if (written) return Promise.resolve();
        written = true;
        return recordRefusal(audit, req, res.statusCode, body).catch((err: Error) => logger.warn(`A refused request could not be logged: ${err.message}`));
      };
      // the answer's message, kept with a refusal (never what was sent); the answer waits for the entry
      const json = res.json.bind(res);
      res.json = (value: unknown) => {
        if (!isRecordedRefusal(req.method, res.statusCode, routeOf(req)) || !req.user) return json(value);
        void write(value).finally(() => json(value));
        return res;
      };
      res.on('finish', () => void write(undefined));
    }
    next();
  };
}

/** The pattern of the address the request matched (/api/leave/requests/:id), or null. */
function routeOf(req: AuditedExpressRequest): string | null {
  const route = (req as { route?: { path?: unknown } }).route?.path;
  return typeof route === 'string' ? `${req.baseUrl ?? ''}${route}` : null;
}

async function recordRefusal(audit: AuditService, req: AuditedExpressRequest, status: number, body: unknown): Promise<void> {
  const userId = req.user?.id;
  const path = routeOf(req);
  if (!userId || !path || !isRecordedRefusal(req.method, status, path)) return;
  // the context the request ran in (the interceptor's), else as the guard left it (refused by the guard itself)
  const context = req.auditContext ?? auditContextOf(req);
  if (context.refusalWritten) return;
  await runInAuditContext(context, () => audit.record(refusedEntry(userId, req.method, path, status, req.params, body)));
}
