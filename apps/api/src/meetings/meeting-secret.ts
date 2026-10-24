import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

// The meetings' secrets, sealed (owner, 24 October 2026: "can i link an online meeting service provider to automatically
// generate meeting links?"; the brief: "all sealed … never returned"): the providers' app secrets a Super Admin saves,
// each connection's refresh token, and the sign-in's state while the person is at the provider. AES-256-GCM with a
// random 12-byte IV each time, kept as one text "v1:iv:tag:ciphertext" (base64url), bound to what it is (the additional
// data names its purpose), so a value moved to another column, or a state passed off as a token, doesn't open.
//
// The key, as the email password's (mail-secret.ts): no new step for the owner. Derived (HKDF-SHA256) from JWT_SECRET,
// the one secret every server running the API has, with its own info "trendlix-meetings-v1", so it is used for nothing
// else and stays apart from the email password's key and the session tokens' signatures. If JWT_SECRET ever changes, the
// saved secrets and tokens can't be opened any more: the page says the secret must be entered again (the key's
// fingerprint kept beside it tells, without opening it), and each connection needs connecting again. Opened only to call
// the provider; never logged.

const VERSION = 'v1';
const INFO = 'trendlix-meetings-v1';
const KEY_ID_INFO = 'trendlix-meetings-v1 key id';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** What a sealed value is: its purpose is its additional data. */
export type MeetingSecretPurpose = 'client_secret' | 'user_client_secret' | 'refresh_token' | 'oauth_state';

const aadOf = (purpose: MeetingSecretPurpose) => Buffer.from(`meetings.${purpose}`, 'utf8');

/** The key the meetings' secrets are sealed with, from the server's JWT_SECRET. */
export function meetingKeyOf(secret: string): Buffer {
  if (!secret) throw new Error('No secret to derive the meetings key from.');
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), INFO, 32));
}

/** A short fingerprint of a key (12 hex), kept beside each sealed secret: says which key sealed it, never the key. */
export function meetingKeyIdOf(key: Buffer): string {
  return createHmac('sha256', key).update(KEY_ID_INFO).digest('hex').slice(0, 12);
}

/** Whether a fingerprint is this key's. */
export function sameMeetingKey(keyId: string | null | undefined, key: Buffer): boolean {
  if (!keyId) return false;
  const a = Buffer.from(keyId, 'utf8');
  const b = Buffer.from(meetingKeyIdOf(key), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A value sealed for its purpose: "v1:iv:tag:ciphertext", a new IV each time. */
export function sealMeetingSecret(plain: string, key: Buffer, purpose: MeetingSecretPurpose): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aadOf(purpose));
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join(':');
}

/** A sealed value opened; null when it can't be (another key, another purpose, changed, not a sealed value): never throws. */
export function openMeetingSecret(sealed: string | null | undefined, key: Buffer, purpose: MeetingSecretPurpose): string | null {
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
