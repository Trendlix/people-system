import { connection } from 'next/server';
import { API_URL } from '@/lib/api';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

// Serves the company logo from the API under the web domain, so the API address stays private.
export async function GET() {
  await connection();
  const res = await fetch(`${API_URL}/api/company/logo`).catch(() => null);
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
