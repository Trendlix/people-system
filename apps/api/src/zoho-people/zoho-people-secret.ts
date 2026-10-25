import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

// Zoho People's secrets, sealed (owner, 25 October 2026: "Yes, daily + backfill"; the brief: "Seal this connection's
// tokens with its own info string, trendlix-zoho-people-v1"): the connection's refresh token, and the sign-in's state
// while the Super Admin is at Zoho. As the calendars' (calendar-secret.ts): AES-256-GCM with a random 12-byte IV each
// time, one text "v1:iv:tag:ciphertext" (base64url), bound to what it is (the additional data "zoho_people.<purpose>"),
// so a value moved to another column, or a state passed off as a token, doesn't open. The key is derived (HKDF-SHA256)
// from JWT_SECRET with its own info, so it is used for nothing else: not the calendars', the meetings' nor the email
// password's. If JWT_SECRET ever changes, the token can't be opened any more (the fingerprint kept beside it tells,
// without opening it) and the page says to connect again. Opened only to call Zoho; never logged.

const VERSION = 'v1';
const INFO = 'trendlix-zoho-people-v1';
const KEY_ID_INFO = 'trendlix-zoho-people-v1 key id';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** What a sealed value is: its purpose is its additional data. */
export type ZohoPeopleSecretPurpose = 'refresh_token' | 'oauth_state';

const aadOf = (purpose: ZohoPeopleSecretPurpose) => Buffer.from(`zoho_people.${purpose}`, 'utf8');

/** The key Zoho People's secrets are sealed with, from the server's JWT_SECRET. */
export function zohoPeopleKeyOf(secret: string): Buffer {
  if (!secret) throw new Error('No secret to derive the Zoho People key from.');
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), INFO, 32));
}

/** A short fingerprint of a key (12 hex), kept beside the sealed token: says which key sealed it, never the key. */
export function zohoPeopleKeyIdOf(key: Buffer): string {
  return createHmac('sha256', key).update(KEY_ID_INFO).digest('hex').slice(0, 12);
}

/** Whether a fingerprint is this key's. */
export function sameZohoPeopleKey(keyId: string | null | undefined, key: Buffer): boolean {
  if (!keyId) return false;
  const a = Buffer.from(keyId, 'utf8');
  const b = Buffer.from(zohoPeopleKeyIdOf(key), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A value sealed for its purpose: "v1:iv:tag:ciphertext", a new IV each time. */
export function sealZohoPeopleSecret(plain: string, key: Buffer, purpose: ZohoPeopleSecretPurpose): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aadOf(purpose));
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join(':');
}

/** A sealed value opened; null when it can't be (another key, another purpose, changed, not a sealed value): never throws. */
export function openZohoPeopleSecret(sealed: string | null | undefined, key: Buffer, purpose: ZohoPeopleSecretPurpose): string | null {
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
