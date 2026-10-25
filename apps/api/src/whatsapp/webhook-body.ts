import type { NextFunction, Request, Response } from 'express';

// Meta's webhook calls, read as they came (owner, 24 October 2026: "Directly to Meta"; the brief: "POST with the
// X-Hub-Signature-256 check against the app secret"): the signature is over the exact bytes Meta sent, so the body is
// kept as it came (req.rawBody) before it is read as JSON. Only for the webhook's address (configureApp); every other
// route is read by Nest's own parsers as before, which leave a body already read alone. At most 1 MB: Meta's calls are
// a few kilobytes. Named, so Nest still adds its own JSON parser for everything else (it looks for one named
// jsonParser).

/** The webhook's address on the API. */
export const WHATSAPP_WEBHOOK_ROUTE = '/api/public/whatsapp/webhook';

/**
 * Twilio's calls' addresses on the API (owner, 25 October 2026: "Add Twilio as a choice"): the status callback and the
 * incoming messages, form-encoded. Their signature is over the parameters as Twilio sent them, so they are read from the
 * exact bytes here too (the service reads them with URLSearchParams), never by Nest's urlencoded parser, which makes
 * nested objects of names with brackets.
 */
export const WHATSAPP_TWILIO_ROUTE = '/api/public/whatsapp/twilio';

const LIMIT = 1024 * 1024;

export function whatsappWebhookBody(req: Request, res: Response, next: NextFunction): void {
  readRaw(req, res, next, (raw) => (raw.length ? (JSON.parse(raw.toString('utf8')) as unknown) : {}));
}

/** Twilio's: the bytes kept (req.rawBody), the body left empty (the parameters are read from the bytes). */
export function twilioWebhookBody(req: Request, res: Response, next: NextFunction): void {
  readRaw(req, res, next, () => ({}));
}

function readRaw(req: Request, res: Response, next: NextFunction, parse: (raw: Buffer) => unknown): void {
  if (req.method !== 'POST') return next();
  const chunks: Buffer[] = [];
  let size = 0;
  let done = false;
  req.on('data', (chunk: Buffer) => {
    if (done) return;
    size += chunk.length;
    if (size > LIMIT) {
      done = true;
      res.status(413).json({ statusCode: 413, message: 'Too large.' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (done) return;
    done = true;
    const raw = Buffer.concat(chunks);
    (req as Request & { rawBody?: Buffer }).rawBody = raw;
    try {
      req.body = parse(raw);
    } catch {
      req.body = {};
    }
    next();
  });
  req.on('error', () => {
    if (done) return;
    done = true;
    next();
  });
}
