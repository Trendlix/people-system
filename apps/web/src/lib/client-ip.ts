// The visitor's IP address as this website (on Vercel) sees it: recorded with a job offer's answer (owner's request, 15
// October 2026), sent with a sign-in for its session (20 October 2026), and signed for a check-in's office network check
// (owner, 20 October 2026: "allow me to lock checkin's to wifi name or ip, whatever is right"; lib/signed-ip.ts). Vercel
// sets x-forwarded-for itself, the client's address first, and doesn't pass on one the browser sent, so its first entry
// is the visitor's. Pure code, tested; no "@/" imports.

type HeaderSource = Pick<Headers, 'get'>;

const IP = /^[0-9a-f.:]{2,45}$/i;

/**
 * The visitor's IP address: the first entry of x-forwarded-for (the client, as the deployment's proxy adds it), else
 * x-real-ip; undefined when neither holds an address.
 */
export function clientIp(h: HeaderSource): string | undefined {
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded && IP.test(forwarded)) return forwarded;
  const real = h.get('x-real-ip')?.trim();
  return real && IP.test(real) ? real : undefined;
}
