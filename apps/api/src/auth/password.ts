import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// scrypt parameters; stored with each hash so they can be raised later without breaking old hashes.
const N = 2 ** 16;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const MAXMEM = 128 * N * R * 2;

// Format: scrypt$N$r$p$<salt base64>$<hash base64>
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    ...cost,
    maxmem: 128 * cost.N * cost.r * 2,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
