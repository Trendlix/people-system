import { createHmac, hkdfSync } from 'node:crypto';
import type { DeveloperDigest } from '@trendlix/shared';

// The key a developer's pseudonyms are read with (owner, 23 October 2026, as a developer: "in developer view use ****
// instead of IDs"; told: names become a stable tag that isn't the real code, "Employee 7K3Q"). A tag is a keyed hash
// (HMAC-SHA256) of the person's record id (packages/shared developer.ts tagFromDigest), so a developer, who sees ids in
// the answers and the links, can't work a tag out from an id, nor check a guessed email against a hidden one.
//
// The key: no new step for the owner. It is derived (HKDF-SHA256, its own info "trendlix-developer-tags-v1") from
// JWT_SECRET, the one secret the API can't start without (auth.module.ts reads it with getOrThrow; docker-compose.yml
// refuses to start without it), as the email settings' key is (mail/mail-secret.ts, another info): HKDF keeps the two
// keys and the session tokens' signatures apart. Nothing is stored with it: if JWT_SECRET ever changes (which signs
// everyone out too), every tag changes once, and stays the same from then on.

const INFO = 'trendlix-developer-tags-v1';

/** The key a developer's tags are read with, from the server's JWT_SECRET. */
export function developerTagKeyOf(secret: string): Buffer {
  if (!secret) throw new Error('No secret to derive the developer tags’ key from.');
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), INFO, 32));
}

/** The keyed digest a tag is read from: HMAC-SHA256 of a text (a record's id, an email) under the key. */
export function developerDigestOf(key: Buffer): DeveloperDigest {
  return (text: string) => createHmac('sha256', key).update(text, 'utf8').digest();
}
