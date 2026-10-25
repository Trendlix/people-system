import { careersBaseOf, CAREERS_BASE_PATH } from '@trendlix/shared';
import { originFromHeaders, originOfRequest } from './connector/site';

// The careers pages' public address on this website (25 October 2026: the owner is moving the careers pages to
// www.trendlix.com/careers, the main site proxying /careers/* here with a Next.js multi-zones rewrite; packages/shared
// careers-base.ts): CAREERS_BASE_URL when the deployment sets it ("https://www.trendlix.com/careers"), else this site's
// own address, as the request reached it, and /careers. LinkedIn's redirect URL (Recruitment Settings, and the sign-in's
// start) and the pages the sign-in returns to are built from it; nothing else is switched by it yet. Server code (it
// reads the environment); no "@/" imports, tested in careers-base.test.ts.

type HeaderSource = Pick<Headers, 'get'>;

/** From a page's or an action's headers; null when the site's address can't be read and none is set. */
export const careersBaseFrom = (h: HeaderSource, configured: string | undefined = process.env.CAREERS_BASE_URL): string | null => careersBaseOf(originFromHeaders(h), configured);

/** From a route handler's request: as careersBaseFrom, else the request's own address and /careers. */
export function careersBaseOfRequest(request: Pick<Request, 'url' | 'headers'>, configured: string | undefined = process.env.CAREERS_BASE_URL): string {
  const origin = originOfRequest(request);
  return careersBaseOf(origin, configured) ?? `${origin}${CAREERS_BASE_PATH}`;
}
