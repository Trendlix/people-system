import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

// The saved email password, sealed (owner, 23 October 2026: "why dont we add SMTP setup in the organization setup"; the
// plan told to the owner: "the password encrypted, never shown again"). AES-256-GCM with a random 12-byte IV on every
// save, kept as one text, "v1:iv:tag:ciphertext" (base64url), bound to what it is (the additional data), so a value moved
// to another column doesn't open.
//
// The key: no new step for the owner. It is derived (HKDF-SHA256, a fixed info "trendlix-mail-settings-v1") from
// JWT_SECRET, the one secret the API can't start without (auth.module.ts reads it with getOrThrow; docker-compose.yml
// refuses to start without it), so every server that runs the API has it and nothing new is set up. The derived key is
// used for nothing else, and HKDF keeps it apart from the session tokens' signatures. If JWT_SECRET ever changes (which
// signs everyone out too), the saved password can't be opened any more: the page says "The saved password can't be read
// any more: enter it again" (the key's fingerprint, kept beside it, tells without opening it), and the system falls back
// to the server's settings until it is entered again. Opened only to send.

const VERSION = 'v1';
const INFO = 'trendlix-mail-settings-v1';
const KEY_ID_INFO = 'trendlix-mail-settings-v1 key id';
const AAD = Buffer.from('mail_settings.password', 'utf8');
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** The key the email password is sealed with, from the server's JWT_SECRET. */
export function mailKeyOf(secret: string): Buffer {
  if (!secret) throw new Error('No secret to derive the email key from.');
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), INFO, 32));
}

/** A short fingerprint of a key (12 hex), kept beside the sealed password: says which key sealed it, never the key. */
export function keyIdOf(key: Buffer): string {
  return createHmac('sha256', key).update(KEY_ID_INFO).digest('hex').slice(0, 12);
}

/** Whether a fingerprint is this key's. */
export function sameKey(keyId: string | null | undefined, key: Buffer): boolean {
  if (!keyId) return false;
  const a = Buffer.from(keyId, 'utf8');
  const b = Buffer.from(keyIdOf(key), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A password sealed: "v1:iv:tag:ciphertext", a new IV each time. */
export function sealSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join(':');
}

/** A sealed password opened; null when it can't be (another key, changed, or not a sealed value): never throws. */
export function openSecret(sealed: string | null | undefined, key: Buffer): string | null {
  if (!sealed) return null;
  const parts = sealed.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const [, iv, tag, data] = parts.map((p) => Buffer.from(p, 'base64url'));
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
