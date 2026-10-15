import 'server-only';
import { connection } from 'next/server';
import { API_URL } from './api';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Serves the company logo or thumbnail from the API under the web domain, so the API address stays private: the routes
 * /company-logo and /company-thumbnail (public: lib/public-paths.ts). Only an image of a kind the API takes is passed on.
 * Asked for with the image's version in the address (lib/brand.ts), so the five minutes' caching never shows an old one.
 */
export async function companyImage(image: 'logo' | 'thumbnail'): Promise<Response> {
  await connection();
  const res = await fetch(`${API_URL}/api/company/${image}`).catch(() => null);
  const type = res?.headers.get('content-type') ?? '';
  if (!res?.ok || !IMAGE_TYPES.has(type)) return new Response('Not found', { status: 404 });

  return new Response(res.body, {
    headers: {
      'content-type': type,
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  });
}
