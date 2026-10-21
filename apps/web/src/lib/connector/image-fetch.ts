import 'server-only';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request } from 'node:https';
import { Readable } from 'node:stream';
import { PRODUCT_IMAGE_RULES } from '@trendlix/shared';
import { fetchProductImage, pinnedLookup, type ImageFetchDeps, type ResolvedAddress } from './image-guard';
import { shrinkWithSharp } from './image-shrink';

// The product image fetch on the server (owner, 21 October 2026: "let the mcp connector fetch the product photo and add
// it / yes build it"), run by the MCP route on Vercel: the guard's rules (image-guard.ts) with this server's own
// lookups. The host is looked up once (every address, checked by the guard) and the request connects to a checked
// address only, its TLS still checked against the host's name, so a second, different answer can never be used. Made
// smaller with sharp when the server has it (Next.js installs it with itself, and keeps it outside the bundle): at most
// 1600 px a side, as JPEG 85% on white, its metadata dropped, so what is kept is the server's own encoding; without
// sharp the image is kept as fetched (still checked by its bytes, here and by the API).

const USER_AGENT = 'TrendlixPeople/1.0 (+https://people.trendlix.com; product image for an asset draft)';
const NULL_BODY = new Set([204, 205, 304]);

/** Every address of the host, as the system resolves it. */
async function lookup(hostname: string): Promise<ResolvedAddress[]> {
  const found = await dnsLookup(hostname, { all: true, verbatim: true });
  return found.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
}

/** One GET to the checked address, redirects not followed, the answer as a web Response (its body streamed). */
function get(url: URL, address: ResolvedAddress, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        headers: { accept: 'image/jpeg,image/png,image/webp;q=0.9,*/*;q=0.1', 'accept-encoding': 'identity', 'user-agent': USER_AGENT },
        lookup: pinnedLookup(address),
        agent: false,
        signal,
        timeout: PRODUCT_IMAGE_RULES.timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status > 599) {
          res.destroy();
          reject(new Error(`Unexpected status ${status}`));
          return;
        }
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) for (const v of value) headers.append(key, v);
          else if (typeof value === 'string') headers.set(key, value);
        }
        if (NULL_BODY.has(status)) {
          res.resume();
          resolve(new Response(null, { status, headers }));
          return;
        }
        resolve(new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, { status, headers }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
    req.end();
  });
}

export const productImageDeps: ImageFetchDeps = { lookup, get, shrink: shrinkWithSharp };

/** The connector's product image fetch: the guard with this server's lookups, request and sharp. */
export const fetchProductImageOnline = (url: string) => fetchProductImage(url, productImageDeps);
