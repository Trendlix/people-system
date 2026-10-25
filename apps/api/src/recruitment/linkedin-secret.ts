import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

// "Fill in with LinkedIn"'s secrets, sealed (owner, 25 October 2026: "can i use linkedin to complete the data?"; the
// brief: "sealed as the others are (AES-256-GCM, HKDF of JWT_SECRET), info string trendlix-linkedin-v1; never sent back
// to the browser, only 'set'"): the LinkedIn app's client secret; the sign-in's state (the form, the browser's half, the
// nonce, the redirect URL, ten minutes) while the person is at LinkedIn; and what LinkedIn gave (the name, the email,
// whether LinkedIn verified it, two hours) while they fill in the form. AES-256-GCM with a random 12-byte IV each time,
// kept as one text "v1:iv:tag:ciphertext" (base64url), bound to what it is (the additional data names its purpose), so
// a state never opens as a result, nor a result as the secret.
//
// The key, as the email password's, the meetings' and WhatsApp's: derived (HKDF-SHA256) from JWT_SECRET, which every
// server running the API has, with its own info, so it is used for nothing else. If JWT_SECRET ever changes, the saved
// secret can't be opened any more: the settings say to paste it again (the key's fingerprint, kept beside it, tells
// without opening it), and the forms don't show the button meanwhile. Never logged.

const VERSION = 'v1';
const INFO = 'trendlix-linkedin-v1';
const KEY_ID_INFO = 'trendlix-linkedin-v1 key id';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** What a sealed value is: its purpose is its additional data. */
export type LinkedInSecretPurpose = 'client_secret' | 'oauth_state' | 'result';

const aadOf = (purpose: LinkedInSecretPurpose) => Buffer.from(`linkedin.${purpose}`, 'utf8');

/** The key LinkedIn's secrets are sealed with, from the server's JWT_SECRET. */
export function linkedinKeyOf(secret: string): Buffer {
  if (!secret) throw new Error('No secret to derive the LinkedIn key from.');
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), INFO, 32));
}

/** A short fingerprint of a key (12 hex), kept beside the sealed secret: says which key sealed it, never the key. */
export function linkedinKeyIdOf(key: Buffer): string {
  return createHmac('sha256', key).update(KEY_ID_INFO).digest('hex').slice(0, 12);
}

/** Whether a fingerprint is this key's. */
export function sameLinkedInKey(keyId: string | null | undefined, key: Buffer): boolean {
  if (!keyId) return false;
  const a = Buffer.from(keyId, 'utf8');
  const b = Buffer.from(linkedinKeyIdOf(key), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A value sealed for its purpose: "v1:iv:tag:ciphertext", a new IV each time. */
export function sealLinkedIn(plain: string, key: Buffer, purpose: LinkedInSecretPurpose): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aadOf(purpose));
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join(':');
}

/** A sealed value opened; null when it can't be (another key, another purpose, changed, not a sealed value): never throws. */
export function openLinkedIn(sealed: string | null | undefined, key: Buffer, purpose: LinkedInSecretPurpose): string | null {
  if (!sealed || sealed.length > 8000) return null;
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

/** A sealed JSON object opened; null when it can't be or isn't an object. */
export function openLinkedInJson(sealed: string | null | undefined, key: Buffer, purpose: LinkedInSecretPurpose): Record<string, unknown> | null {
  const plain = openLinkedIn(sealed, key, purpose);
  if (!plain) return null;
  try {
    const v = JSON.parse(plain) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Whether two texts are the same, in constant time. */
export function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** A new random value (the browser's half of the state, the nonce): URL-safe, 32 characters. */
export const randomToken = (): string => randomBytes(24).toString('base64url');
