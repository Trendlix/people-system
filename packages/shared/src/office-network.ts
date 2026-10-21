// Locking check-ins to the office network (owner, 20 October 2026: "allow me to lock checkin's to wifi name or ip,
// whatever is right"). The office's public IP, not the Wi-Fi name: a browser can't read the Wi-Fi's name, a phone's
// hotspot can be given any name, and the address is seen the same way on the website and in the app. The owner then
// chose: off the office network a check-in or check-out is refused, with the way out (an attendance correction, or HR
// recording the time, which is never locked); those whose employment is Office are locked, Hybrid, Outdoor, Indoor and
// outdoor and Work from home are not, and HR exempts anyone with "Can check in from anywhere" on the profile. The
// networks are kept on Attendance → Check-in Setup (owner, 20 October 2026: "Own page, several locations"): each a name
// and an IPv4 address, an IPv4 range or an IPv6 range (an IPv6 office line has its /64), with the switch "Lock check-ins
// to the office network". The address a check-in comes from is the one the website saw, signed with a key the website
// and the API share (WEB_KEY, deploy/web-key.sh), so a call made straight to the API can't claim the office's. Without
// the key on either side the lock can't be in force, and no one is refused for its lack. No employee's address is ever
// kept: a punch keeps only the matched network's name. Pure: the API decides with these and the web shows the same words.

// ---------- IP addresses ----------

/** An IP address: IPv4 as 32 bits, IPv6 as 128. An IPv4-mapped IPv6 address (::ffff:41.33.10.2) is its IPv4 one. */
export interface IpAddress {
  family: 4 | 6;
  value: bigint;
}

const BITS = { 4: 32, 6: 128 } as const;

/** "41.33.10.2" as 32 bits; null unless four numbers 0–255 without leading zeros (010 could be read as octal). */
function v4Value(text: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!m) return null;
  let value = 0;
  for (const part of m.slice(1)) {
    if (part.length > 1 && part.startsWith('0')) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

/** The 16-bit groups of one side of "::", the last one possibly a dotted IPv4 address (two groups); null if not. */
function groupsOf(part: string, dottedAllowed: boolean): number[] | null {
  if (part === '') return [];
  const pieces = part.split(':');
  const out: number[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (p.includes('.')) {
      const v4 = dottedAllowed && i === pieces.length - 1 ? v4Value(p) : null;
      if (v4 === null) return null;
      out.push(Math.floor(v4 / 65536), v4 % 65536);
    } else if (/^[0-9a-f]{1,4}$/i.test(p)) out.push(parseInt(p, 16));
    else return null;
  }
  return out;
}

/** "2001:db8::1" as 128 bits; null unless an IPv6 address (no zone: "fe80::1%eth0" is refused). */
function v6Value(text: string): bigint | null {
  if (!/^[0-9a-f:.]+$/i.test(text)) return null;
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = groupsOf(halves[0], halves.length === 1);
  const tail = halves.length === 2 ? groupsOf(halves[1], true) : [];
  if (!head || !tail) return null;
  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    groups = [...head, ...Array<number>(fill).fill(0), ...tail];
  } else {
    if (head.length !== 8) return null;
    groups = head;
  }
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(g), 0n);
}

const MAPPED_PREFIX = 0xffffn; // ::ffff:0:0/96

/** An IP address as typed or as a request carries it; null when it isn't one. */
export function parseIp(text: string | null | undefined): IpAddress | null {
  const s = (text ?? '').trim();
  if (!s) return null;
  if (s.includes(':')) {
    const value = v6Value(s);
    if (value === null) return null;
    // an IPv4 address carried as IPv6 (a dual-stack server's way of showing it): the IPv4 address itself
    if (value >> 32n === MAPPED_PREFIX) return { family: 4, value: value & 0xffffffffn };
    return { family: 6, value };
  }
  const v4 = v4Value(s);
  return v4 === null ? null : { family: 4, value: BigInt(v4) };
}

/** An address as the pages show it: "41.33.10.2", or IPv6 in its short form, lower case ("2001:db8::1"). */
export function formatIp(ip: IpAddress): string {
  if (ip.family === 4) {
    const v = Number(ip.value);
    return [24, 16, 8, 0].map((shift) => Math.floor(v / 2 ** shift) % 256).join('.');
  }
  const groups = Array.from({ length: 8 }, (_, i) => Number((ip.value >> BigInt(112 - 16 * i)) & 0xffffn));
  // the longest run of two or more zero groups becomes "::" (the first, if two are as long: RFC 5952)
  let best = { at: -1, length: 0 };
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > best.length && j - i >= 2) best = { at: i, length: j - i };
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (best.at < 0) return hex.join(':');
  return `${hex.slice(0, best.at).join(':')}::${hex.slice(best.at + best.length).join(':')}`;
}

/** An address as the pages show it from text: normalised (an IPv4-mapped one as IPv4), or null when it isn't one. */
export const normalizedIp = (text: string | null | undefined): string | null => {
  const ip = parseIp(text);
  return ip ? formatIp(ip) : null;
};

// ---------- networks ----------

/** A network: its first address and the bits that are fixed (41.33.10.0/24; a single address is /32 or /128). */
export interface IpNetwork {
  family: 4 | 6;
  base: bigint;
  prefix: number;
}

const maskOf = (family: 4 | 6, prefix: number): bigint => {
  const bits = BITS[family];
  return ((1n << BigInt(bits)) - 1n) ^ ((1n << BigInt(bits - prefix)) - 1n);
};

/** Whether an address is in a network (an IPv4 address never is in an IPv6 network, and the other way). */
export function ipInNetwork(ip: IpAddress, network: IpNetwork): boolean {
  return ip.family === network.family && (ip.value & maskOf(network.family, network.prefix)) === network.base;
}

/** A network as the setting keeps it: "41.33.10.2" for one IPv4 address, else "41.33.10.0/24", "2001:db8:1:2::/64". */
export function formatNetwork(n: IpNetwork): string {
  const base = formatIp({ family: n.family, value: n.base });
  return n.family === 4 && n.prefix === 32 ? base : `${base}/${n.prefix}`;
}

/** The narrowest ranges an office network may be: an IPv4 /16, an IPv6 /32 (wider would let most of a provider in). */
export const NETWORK_PREFIX_MIN = { 4: 16, 6: 32 } as const;

/** The examples the messages give. */
const EXAMPLES = 'e.g. 41.33.10.2, 41.33.10.0/24 or 2001:db8:1234:5678::/64';

/** Addresses inside a network, never seen from outside it: private, loopback, link-local, shared (carrier-grade NAT). */
const PRIVATE: readonly string[] = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16', '::/127', 'fc00::/7', 'fe80::/10'];
const PRIVATE_NETWORKS: IpNetwork[] = PRIVATE.map((range) => {
  const [address, bits] = range.split('/');
  const ip = parseIp(address)!;
  return { family: ip.family, base: ip.value, prefix: Number(bits) };
});

/** Whether an address can't be the office's public one: inside a network (private, loopback, link-local, shared). */
export const isPrivateIp = (ip: IpAddress): boolean => PRIVATE_NETWORKS.some((n) => ipInNetwork(ip, n));

/**
 * An office network as typed: an IPv4 address ("41.33.10.2"), an IPv4 range ("41.33.10.0/24") or an IPv6 range
 * ("2001:db8:1234:5678::/64"), its host bits cleared ("41.33.10.7/24" is 41.33.10.0/24). Refused: anything else, a lone
 * IPv6 address (a phone's changes every few hours: its /64 is what stays), a range wider than /16 or /32, and a private
 * address, which only the inside of a network sees, never the system.
 */
export function parseNetwork(text: string): { network: IpNetwork; problem?: undefined } | { network?: undefined; problem: string } {
  const s = text.trim();
  if (!s) return { problem: `Enter each network's address, ${EXAMPLES}.` };
  const slash = s.indexOf('/');
  const address = slash < 0 ? s : s.slice(0, slash);
  const bitsText = slash < 0 ? null : s.slice(slash + 1);
  const ip = parseIp(address);
  if (!ip || (bitsText !== null && !/^\d{1,3}$/.test(bitsText))) return { problem: `"${s}" isn't an IP address or range: enter one ${EXAMPLES}.` };
  const mapped = ip.family === 4 && address.includes(':');
  let prefix: number;
  if (bitsText === null) {
    if (ip.family === 6) {
      const own = formatNetwork({ family: 6, base: ip.value & maskOf(6, 64), prefix: 64 });
      return { problem: `"${s}" is one IPv6 address, which changes every few hours: enter its network instead, ${own}.` };
    }
    prefix = 32;
  } else {
    prefix = Number(bitsText) - (mapped ? 96 : 0); // ::ffff:41.33.10.0/120 is 41.33.10.0/24
    if (prefix < 0 || prefix > BITS[ip.family]) return { problem: `"${s}" isn't an IP range: an IPv4 range ends in /16 to /32, an IPv6 one in /32 to /128.` };
  }
  if (prefix < NETWORK_PREFIX_MIN[ip.family]) {
    return { problem: `"${s}" is too wide a range: an IPv4 range is /${NETWORK_PREFIX_MIN[4]} or narrower, an IPv6 one /${NETWORK_PREFIX_MIN[6]} or narrower.` };
  }
  const network: IpNetwork = { family: ip.family, base: ip.value & maskOf(ip.family, prefix), prefix };
  if (isPrivateIp({ family: network.family, value: network.base })) {
    return {
      problem: `"${s}" is a private address, seen only inside a network: the system sees the office's public address. In the office, use Add the network I'm on now.`,
    };
  }
  return { network };
}

/** Whether an address is in a network as the setting keeps it: false when either isn't one. */
export function ipInRange(ip: string | null | undefined, range: string): boolean {
  const address = parseIp(ip);
  const parsed = parseNetwork(range).network;
  return !!address && !!parsed && ipInNetwork(address, parsed);
}

/**
 * The network to add for "Add the network I'm on now": the IPv4 address itself, or the /64 of an IPv6 one (the part
 * an office line keeps; the rest changes). Null when it isn't an address, or is a private one.
 */
export function currentNetworkOf(ip: string | null | undefined): string | null {
  const address = parseIp(ip);
  if (!address || isPrivateIp(address)) return null;
  return address.family === 4 ? formatIp(address) : formatNetwork({ family: 6, base: address.value & maskOf(6, 64), prefix: 64 });
}

// ---------- the office's networks ----------

/** An office network: its name ("Main office line") and its address or range, as formatNetwork keeps it. */
export interface OfficeNetwork {
  label: string;
  range: string;
}

export const OFFICE_NETWORKS_MAX = 20;
export const OFFICE_NETWORK_LABEL_MAX = 60;

/**
 * The office networks as they will be kept, and what is wrong with them: each named (60 characters at most) and a valid
 * range, none twice, 20 at most. Ranges are kept as formatNetwork writes them, names trimmed.
 */
export function officeNetworksFrom(typed: readonly { label?: unknown; range?: unknown }[]): { networks: OfficeNetwork[]; problems: string[] } {
  const problems: string[] = [];
  const networks: OfficeNetwork[] = [];
  const seen = new Set<string>();
  if (typed.length > OFFICE_NETWORKS_MAX) problems.push(`Enter at most ${OFFICE_NETWORKS_MAX} office networks.`);
  for (const t of typed) {
    const label = typeof t.label === 'string' ? t.label.trim().replace(/\s+/g, ' ') : '';
    const rangeText = typeof t.range === 'string' ? t.range : '';
    if (!label) problems.push(`Name each network, e.g. Main office line${rangeText.trim() ? ` for ${rangeText.trim()}` : ''}.`);
    else if (label.length > OFFICE_NETWORK_LABEL_MAX) problems.push(`Keep each network's name to ${OFFICE_NETWORK_LABEL_MAX} characters or fewer.`);
    const parsed = parseNetwork(rangeText);
    if (parsed.problem !== undefined) {
      problems.push(parsed.problem);
      continue;
    }
    const range = formatNetwork(parsed.network);
    if (seen.has(range)) problems.push(`"${range}" is there twice: keep it once.`);
    seen.add(range);
    networks.push({ label, range });
  }
  return { networks, problems: [...new Set(problems)] };
}

/** The office network an address is on (the first in the list that has it), or null: off them, or not an address. */
export function matchOfficeNetwork(ip: string | null | undefined, networks: readonly OfficeNetwork[]): OfficeNetwork | null {
  const address = parseIp(ip);
  if (!address) return null;
  return networks.find((n) => {
    const parsed = parseNetwork(n.range).network;
    return !!parsed && ipInNetwork(address, parsed);
  }) ?? null;
}

// ---------- who is locked ----------

/** The lock as set on Check-in Setup, and whether the API holds the key the website signs the address with. */
export interface NetworkLockSetting {
  /** The switch "Lock check-ins to the office network". */
  lock: boolean;
  networks: readonly OfficeNetwork[];
  /** The API has WEB_KEY (deploy/web-key.sh): without it no address can be trusted, so nothing is locked. */
  serverKey: boolean;
}

/** Whether the lock is in force: switched on, with at least one network, and the key on the server. */
export const networkLockInForce = (s: NetworkLockSetting): boolean => s.lock && s.serverKey && s.networks.length > 0;

/** The work arrangements whose check-ins are locked (owner, 20 October 2026: "Office staff, plus exceptions"). */
export const NETWORK_LOCKED_ARRANGEMENTS: readonly string[] = ['office'];

/** What of an employment the lock reads: its work arrangement, and HR's "Can check in from anywhere". */
export interface NetworkLockPerson {
  workArrangement: string;
  checkInAnywhere?: boolean | null;
}

/**
 * Whether someone's check-ins and check-outs need the office network (owner, 20 October 2026): the lock in force, their
 * current employment Office, and HR hasn't let them check in from anywhere. Hybrid, Outdoor, Indoor and outdoor and Work
 * from home check in from anywhere, as before.
 */
export function lockedToOfficeNetwork(setting: NetworkLockSetting, person: NetworkLockPerson): boolean {
  return networkLockInForce(setting) && NETWORK_LOCKED_ARRANGEMENTS.includes(person.workArrangement) && !person.checkInAnywhere;
}

/** What a punch's address says: the office network it is on (its name), or not on one (or not known). */
export interface PunchNetwork {
  /** The office network's name; null: not on one, or the address wasn't signed (so not known). */
  network: string | null;
  /** Refused: locked, and not on the office network (or the address isn't known). */
  refused: boolean;
}

/**
 * A punch's network verdict: the address signed by the website (null: none, or not signed right; a call made straight
 * to the API carries none) against the networks. Signed and on one of them: that network, kept at the office whatever
 * the location says. Locked and not on one (an unsigned address counts as not on one): refused, unless the press is
 * within one of the person's own sub-locations (`atOwnSubLocation`; sub-locations.ts waivesNetworkLock: Claude's default
 * of 20 October 2026, which the owner can change), their place, where it is kept as remote there.
 */
export function punchNetwork(setting: NetworkLockSetting, person: NetworkLockPerson, signedIp: string | null, atOwnSubLocation = false): PunchNetwork {
  const on = setting.serverKey && signedIp ? matchOfficeNetwork(signedIp, setting.networks) : null;
  return { network: on?.label ?? null, refused: lockedToOfficeNetwork(setting, person) && !on && !atOwnSubLocation };
}

/** The answer to a punch refused off the office network: 409 Conflict, with this message. */
export const OFF_NETWORK_STATUS = 409;
export const OFF_NETWORK_MESSAGE = "You're not on the office network. Connect to the office Wi-Fi and try again, or ask for an attendance correction.";

/** What the check-in panel tells someone locked, before they press. */
export const NETWORK_NEEDED_TEXT = 'Check-ins need the office network: connect to the office Wi-Fi before you check in or out.';

// ---------- the signed address ----------

/**
 * The headers the website adds to a check-in's calls (and Check-in Setup's): the visitor's address as the website saw
 * it, when it signed it (milliseconds since 1970), and the signature, an HMAC-SHA256 with WEB_KEY over the address, the
 * time and the SHA-256 of the session token sent with it (base64url). The API trusts the address only with the right
 * signature, within a minute either way, for the same token: so a call made straight to the API can't give itself
 * the office's address, and a signed one can't be used with another session or later.
 */
export const CLIENT_IP_HEADER = 'x-people-client-ip';
export const CLIENT_IP_AT_HEADER = 'x-people-client-ip-at';
export const CLIENT_IP_SIGNATURE_HEADER = 'x-people-client-ip-signature';

/** How far the signing time may be from the API's, either way. */
export const CLIENT_IP_WINDOW_MS = 60_000;

/** The shortest WEB_KEY taken: shorter, and it counts as not set (deploy/web-key.sh makes 64 characters). */
export const WEB_KEY_MIN_LENGTH = 32;

/** Whether a WEB_KEY is one to sign with. */
export const webKeyUsable = (key: string | null | undefined): key is string => typeof key === 'string' && key.trim().length >= WEB_KEY_MIN_LENGTH;

/** What is signed: the version, the address, the time and the token's SHA-256 (hex), a line each. */
export const clientIpPayload = (ip: string, at: string, tokenHash: string): string => ['people-client-ip-v1', ip, at, tokenHash].join('\n');

/** Why a request's address isn't trusted: no key on the API, none sent, not readable, too old or new, a wrong signature. */
export const SIGNED_IP_PROBLEMS = ['no_server_key', 'unsigned', 'malformed', 'stale', 'bad_signature'] as const;
export type SignedIpProblem = (typeof SIGNED_IP_PROBLEMS)[number];

/** The sentence after "Needs the server key"-style lead-ins: what to do about each, for Check-in Setup. */
export const SIGNED_IP_PROBLEM_TEXT: Record<SignedIpProblem, string> = {
  no_server_key: "Needs the server key: run deploy/web-key.sh on the server, then add the WEB_KEY it prints in Vercel's project settings and redeploy.",
  unsigned: "The website sent no signed address with this page: add WEB_KEY in Vercel's project settings (the line deploy/web-key.sh printed) and redeploy.",
  malformed: "The website's signed address couldn't be read: redeploy the website and the server so both are on the same version.",
  stale: "The website's signed address was more than a minute old or ahead: the website's clock and the server's are apart.",
  bad_signature: "The website's WEB_KEY isn't the server's: copy it again from deploy/web-key.sh into Vercel's project settings and redeploy.",
};

/** The website's own words when it has no WEB_KEY (it signs nothing, so the API sees "unsigned"). */
export const NO_WEB_KEY_TEXT = "Needs the key on the website: add WEB_KEY in Vercel's project settings (the line deploy/web-key.sh printed on the server) and redeploy.";

/** Why the lock can't be switched on without the key (the API's refusal). */
export const LOCK_NEEDS_KEY_MESSAGE = 'The lock needs the key the website and the server share: run deploy/web-key.sh on the server, then add WEB_KEY in Vercel.';
