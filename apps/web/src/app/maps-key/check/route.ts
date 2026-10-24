import { keyCheckHtml } from '@/lib/google-maps';

// The page Check-in Setup → Google Maps' "Check the key" frames (owner, 24 October 2026: "Google Maps"): a page of the
// website's own, so Google judges the key by the website's address, as its restriction asks. It holds no key: the form
// sends it the key's script by postMessage once it has loaded, from the website itself only (lib/google-maps.ts
// keyCheckHtml). Signed-in visitors only (proxy.ts), framed by the website's own pages only (next.config.ts), never kept.

export function GET() {
  return new Response(keyCheckHtml(), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex',
    },
  });
}
