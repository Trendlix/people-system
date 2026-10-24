import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

// WhatsApp's secrets, sealed (owner, 24 October 2026: "how to make whatsapp notifications?", "Directly to Meta"; the
// brief: "sealed: AES-256-GCM, key from HKDF of JWT_SECRET with info trendlix-whatsapp-v1, never returned"): the system
// user's permanent access token, and the app secret Meta signs the webhook's calls with. AES-256-GCM with a random
// 12-byte IV each time, kept as one text "v1:iv:tag:ciphertext" (base64url), bound to what it is (the additional data
// names its purpose), so the token moved to the secret's column doesn't open.
//
// The key, as the email password's and the meetings' (mail-secret.ts, meeting-secret.ts): no new step for the owner.
// Derived (HKDF-SHA256) from JWT_SECRET, which every server running the API has, with its own info, so it is used for
// nothing else. If JWT_SECRET ever changes, the saved token and secret can't be opened any more: the page says to paste
// them again (the key's fingerprint, kept beside each, tells without opening it), and nothing is sent meanwhile. Opened
// only to call Meta or to check a webhook's signature; never logged.

const VERSION = 'v1';
const INFO = 'trendlix-whatsapp-v1';
const KEY_ID_INFO = 'trendlix-whatsapp-v1 key id';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** What a sealed value is: its purpose is its additional data. */
export type WhatsAppSecretPurpose = 'access_token' | 'app_secret';

const aadOf = (purpose: WhatsAppSecretPurpose) => Buffer.from(`whatsapp.${purpose}`, 'utf8');

/** The key WhatsApp's secrets are sealed with, from the server's JWT_SECRET. */
export function whatsappKeyOf(secret: string): Buffer {
  if (!secret) throw new Error('No secret to derive the WhatsApp key from.');
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), INFO, 32));
}

/** A short fingerprint of a key (12 hex), kept beside each sealed secret: says which key sealed it, never the key. */
export function whatsappKeyIdOf(key: Buffer): string {
  return createHmac('sha256', key).update(KEY_ID_INFO).digest('hex').slice(0, 12);
}

/** Whether a fingerprint is this key's. */
export function sameWhatsAppKey(keyId: string | null | undefined, key: Buffer): boolean {
  if (!keyId) return false;
  const a = Buffer.from(keyId, 'utf8');
  const b = Buffer.from(whatsappKeyIdOf(key), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A value sealed for its purpose: "v1:iv:tag:ciphertext", a new IV each time. */
export function sealWhatsAppSecret(plain: string, key: Buffer, purpose: WhatsAppSecretPurpose): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aadOf(purpose));
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join(':');
}

/** A sealed value opened; null when it can't be (another key, another purpose, changed, not a sealed value): never throws. */
export function openWhatsAppSecret(sealed: string | null | undefined, key: Buffer, purpose: WhatsAppSecretPurpose): string | null {
  if (!sealed) return null;
  const parts = sealed.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const [, iv, tag, data] = parts.map((p) => Buffer.from(p, 'base64url'));
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aadOf(purpose));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** A new webhook verify token: 32 URL-safe characters (packages/shared WHATSAPP_VERIFY_TOKEN). */
export const newVerifyToken = (): string => randomBytes(24).toString('base64url');
