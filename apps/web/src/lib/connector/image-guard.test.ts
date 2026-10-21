import { describe, expect, it } from 'vitest';
import { fetchProductImage, ipv6Bytes, isPublicAddress, linkRefusal, pinnedLookup, type ImageFetchDeps, type ResolvedAddress } from './image-guard';
import { shrinkWithSharp } from './image-shrink';
import { GIF, jpegOf, pngOf, SVG } from './test-images';

// How the Claude connector fetches a product image (owner, 21 October 2026: "let the mcp connector fetch the product
// photo and add it / yes build it"), with the lookups and the requests mocked: the link's rules, every address of a host
// checked, the connection to a checked address, redirects checked again (3 at most), 5 MB counted while it arrives, the
// bytes known by their magic numbers, the sizes, the 10 seconds, and the image made smaller with sharp.

type Answer = () => Response | Promise<Response>;

/** A made-up internet: hosts and their addresses, and links and what they answer. Every lookup and request is kept. */
function internet(dns: Record<string, string[]>, links: Record<string, Answer>, shrink?: ImageFetchDeps['shrink']) {
  const lookups: string[] = [];
  const requests: { url: string; address: string }[] = [];
  const deps: ImageFetchDeps = {
    lookup: async (host) => {
      lookups.push(host);
      const found = dns[host];
      if (!found) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
      return found.map((address): ResolvedAddress => ({ address, family: address.includes(':') ? 6 : 4 }));
    },
    get: async (url, address) => {
      requests.push({ url: url.href, address: address.address });
      const answer = links[url.href];
      return answer ? answer() : new Response('Not found', { status: 404 });
    },
    ...(shrink && { shrink }),
  };
  return { deps, lookups, requests };
}

const image = (bytes: Uint8Array<ArrayBuffer>, type = 'image/png', extra: Record<string, string> = {}) => () =>
  new Response(bytes, { status: 200, headers: { 'content-type': type, ...extra } });
const redirect = (to: string, status = 302) => () => new Response(null, { status, headers: { location: to } });

const PUBLIC = '93.184.216.34';
const IMG = 'https://www.sony.com/images/fx3.png';

describe('the addresses', () => {
  it('fetches from public IPv4 only: never private, loopback, link-local, CGNAT, multicast or reserved', () => {
    for (const ok of [PUBLIC, '8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '192.0.1.1']) expect([ok, isPublicAddress(ok)]).toEqual([ok, true]);
    for (const no of [
      '0.0.0.0',
      '10.1.2.3',
      '100.64.0.1',
      '100.127.255.254',
      '127.0.0.1',
      '169.254.169.254',
      '169.254.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.0.0.8',
      '192.0.2.10',
      '192.88.99.1',
      '192.168.1.1',
      '198.18.0.1',
      '198.19.255.255',
      '198.51.100.7',
      '203.0.113.9',
      '224.0.0.251',
      '239.255.255.250',
      '240.0.0.1',
      '255.255.255.255',
    ]) {
      expect([no, isPublicAddress(no)]).toEqual([no, false]);
    }
  });

  it('fetches from global IPv6 only, an IPv4-mapped or NAT64 address checked as its IPv4', () => {
    for (const ok of ['2606:4700:4700::1111', '2a00:1450:4001:82a::200e', '::ffff:93.184.216.34', '::ffff:5db8:d822', '64:ff9b::808:808']) expect([ok, isPublicAddress(ok)]).toEqual([ok, true]);
    for (const no of [
      '::',
      '::1',
      '::127.0.0.1',
      '::ffff:127.0.0.1',
      '::ffff:169.254.169.254',
      '::ffff:a9fe:a9fe',
      '::ffff:10.0.0.1',
      '64:ff9b::a9fe:a9fe',
      '64:ff9b:1::1',
      'fe80::1',
      'fc00::1',
      'fd12:3456::1',
      'fec0::1',
      'ff02::1',
      '100::1',
      '2001:db8::1',
      '2001::1',
      '2002:7f00:1::1',
      '3fff::1',
      'fe80::1%en0',
      'not an address',
      '1.2.3',
      '256.1.1.1',
    ]) {
      expect([no, isPublicAddress(no)]).toEqual([no, false]);
    }
  });

  it('reads IPv6 as written: compressed, in full, with an IPv4 tail', () => {
    expect(ipv6Bytes('::1')).toEqual([...new Array(15).fill(0), 1]);
    expect(ipv6Bytes('2001:db8:0:0:0:0:0:1')).toEqual(ipv6Bytes('2001:db8::1'));
    expect(ipv6Bytes('::ffff:1.2.3.4')!.slice(10)).toEqual([0xff, 0xff, 1, 2, 3, 4]);
    expect(ipv6Bytes('[::1]')).toEqual(ipv6Bytes('::1'));
    expect(ipv6Bytes('1::2::3')).toBeNull();
    expect(ipv6Bytes('1:2:3:4:5:6:7:8:9')).toBeNull();
  });

  it('connects to the checked address, whatever the connection asks', () => {
    const lookup = pinnedLookup({ address: PUBLIC, family: 4 });
    const one: unknown[] = [];
    lookup('www.sony.com', {}, (...args: unknown[]) => one.push(...args));
    expect(one).toEqual([null, PUBLIC, 4]);
    const all: unknown[] = [];
    lookup('www.sony.com', { all: true }, (...args: unknown[]) => all.push(...args));
    expect(all).toEqual([null, [{ address: PUBLIC, family: 4 }]]);
  });
});

describe('the link', () => {
  it('is https, without a user name or password, on the standard port', () => {
    expect(linkRefusal(new URL(IMG))).toBeNull();
    expect(linkRefusal(new URL('https://www.sony.com:443/fx3.png'))).toBeNull();
    expect(linkRefusal(new URL('http://www.sony.com/fx3.png'))).toBe('Only https:// links are fetched.');
    expect(linkRefusal(new URL('ftp://www.sony.com/fx3.png'))).toBe('Only https:// links are fetched.');
    expect(linkRefusal(new URL('https://me:pw@www.sony.com/fx3.png'))).toMatch(/user name or password/);
    expect(linkRefusal(new URL('https://www.sony.com:8443/fx3.png'))).toMatch(/standard https port/);
    expect(linkRefusal(new URL('https://localhost/fx3.png'))).toMatch(/this computer/);
    expect(linkRefusal(new URL('https://api.localhost/fx3.png'))).toMatch(/this computer/);
    // an address as the host is checked at once, however it is written
    expect(linkRefusal(new URL('https://169.254.169.254/latest/meta-data/'))).toMatch(/private or reserved address \(169\.254\.169\.254\)/);
    expect(linkRefusal(new URL('https://2130706433/fx3.png'))).toMatch(/127\.0\.0\.1/);
    expect(linkRefusal(new URL('https://0x7f.1/fx3.png'))).toMatch(/127\.0\.0\.1/);
    expect(linkRefusal(new URL('https://[::1]/fx3.png'))).toMatch(/::1/);
    expect(linkRefusal(new URL('https://[::ffff:10.0.0.1]/fx3.png'))).toMatch(/private or reserved/);
  });

  it('is refused before any lookup when it breaks a rule', async () => {
    const web = internet({ 'www.sony.com': [PUBLIC] }, { [IMG]: image(pngOf(400, 300)) });
    for (const link of ['http://www.sony.com/images/fx3.png', 'https://me:pw@www.sony.com/fx3.png', 'https://www.sony.com:8080/fx3.png', 'https://127.0.0.1/fx3.png', 'not a link']) {
      expect(await fetchProductImage(link, web.deps)).toMatchObject({ ok: false });
    }
    expect(web.lookups).toEqual([]);
    expect(web.requests).toEqual([]);
  });
});

describe('the host', () => {
  it('fetches a good image from a public host, connecting to its checked address (IPv4 first)', async () => {
    const web = internet({ 'www.sony.com': ['2606:4700::6810:84e5', PUBLIC] }, { [IMG]: image(pngOf(400, 300)) });
    const got = await fetchProductImage(IMG, web.deps);
    expect(got).toMatchObject({ ok: true, type: 'image/png', width: 400, height: 300, finalUrl: IMG, resized: false });
    expect(web.lookups).toEqual(['www.sony.com']);
    expect(web.requests).toEqual([{ url: IMG, address: PUBLIC }]);
  });

  it('refuses a host when any one of its addresses is private (all are checked, not only the first)', async () => {
    for (const bad of [['10.0.0.5'], [PUBLIC, '127.0.0.1'], [PUBLIC, '169.254.169.254'], ['2606:4700::1', 'fd00::1'], [PUBLIC, '::ffff:192.168.0.1']]) {
      const web = internet({ 'www.sony.com': bad }, { [IMG]: image(pngOf(400, 300)) });
      const got = await fetchProductImage(IMG, web.deps);
      expect(got).toMatchObject({ ok: false, reason: expect.stringMatching(/private or reserved address/) });
      expect(web.requests).toEqual([]);
    }
  });

  it('says when the host can’t be found or reached', async () => {
    expect(await fetchProductImage(IMG, internet({}, {}).deps)).toEqual({ ok: false, reason: 'The image’s host, www.sony.com, could not be found.' });
    expect(await fetchProductImage(IMG, internet({ 'www.sony.com': [] }, {}).deps)).toMatchObject({ ok: false, reason: expect.stringMatching(/could not be found/) });
    const down = internet({ 'www.sony.com': [PUBLIC, '8.8.4.4'] }, { [IMG]: () => Promise.reject(new Error('ECONNREFUSED')) });
    expect(await fetchProductImage(IMG, down.deps)).toEqual({ ok: false, reason: 'www.sony.com could not be reached.' });
    // each checked address is tried in turn
    expect(down.requests.map((r) => r.address)).toEqual([PUBLIC, '8.8.4.4']);
  });
});

describe('redirects', () => {
  const HOP = (n: number) => `https://cdn${n}.sony.com/fx3.png`;
  const dns = { 'www.sony.com': [PUBLIC], 'cdn1.sony.com': [PUBLIC], 'cdn2.sony.com': [PUBLIC], 'cdn3.sony.com': [PUBLIC], 'cdn4.sony.com': [PUBLIC] };

  it('follows up to 3, each checked again, a relative one too', async () => {
    const web = internet(dns, {
      [IMG]: redirect(HOP(1), 301),
      [HOP(1)]: redirect('https://cdn2.sony.com/fx3.png', 307),
      [HOP(2)]: redirect('//cdn3.sony.com/fx3.png', 308),
      [HOP(3)]: image(pngOf(300, 300)),
    });
    expect(await fetchProductImage(IMG, web.deps)).toMatchObject({ ok: true, finalUrl: HOP(3) });
    expect(web.lookups).toEqual(['www.sony.com', 'cdn1.sony.com', 'cdn2.sony.com', 'cdn3.sony.com']);

    const relative = internet(dns, { [IMG]: redirect('/images/fx3-big.png'), 'https://www.sony.com/images/fx3-big.png': image(pngOf(300, 300)) });
    expect(await fetchProductImage(IMG, relative.deps)).toMatchObject({ ok: true, finalUrl: 'https://www.sony.com/images/fx3-big.png' });
  });

  it('refuses a 4th', async () => {
    const web = internet(dns, { [IMG]: redirect(HOP(1)), [HOP(1)]: redirect(HOP(2)), [HOP(2)]: redirect(HOP(3)), [HOP(3)]: redirect(HOP(4)), [HOP(4)]: image(pngOf(300, 300)) });
    expect(await fetchProductImage(IMG, web.deps)).toEqual({ ok: false, reason: 'The image link redirected more than 3 times.' });
    expect(web.requests.map((r) => r.url)).not.toContain(HOP(4));
  });

  it('refuses a redirect to a private address, to http, or to a host resolving privately', async () => {
    const metadata = internet(dns, { [IMG]: redirect('https://169.254.169.254/latest/meta-data/iam/') });
    expect(await fetchProductImage(IMG, metadata.deps)).toMatchObject({ ok: false, reason: expect.stringMatching(/redirected to https:\/\/169\.254\.169\.254.*private or reserved/) });
    expect(metadata.requests).toHaveLength(1);

    const plain = internet(dns, { [IMG]: redirect('http://www.sony.com/fx3.png') });
    expect(await fetchProductImage(IMG, plain.deps)).toMatchObject({ ok: false, reason: expect.stringMatching(/Only https:\/\/ links/) });

    const rebound = internet({ ...dns, 'internal.example.com': ['10.0.0.7'] }, { [IMG]: redirect('https://internal.example.com/x.png') });
    expect(await fetchProductImage(IMG, rebound.deps)).toMatchObject({ ok: false, reason: expect.stringMatching(/internal\.example\.com points to a private or reserved address \(10\.0\.0\.7\)/) });
    expect(rebound.requests.map((r) => r.url)).toEqual([IMG]);

    const nowhere = internet(dns, { [IMG]: () => new Response(null, { status: 302 }) });
    expect(await fetchProductImage(IMG, nowhere.deps)).toMatchObject({ ok: false, reason: expect.stringMatching(/without saying where/) });
  });
});

describe('the answer', () => {
  const at = (answer: Answer, shrink?: ImageFetchDeps['shrink']) => internet({ 'www.sony.com': [PUBLIC] }, { [IMG]: answer }, shrink).deps;

  it('must be a 200', async () => {
    expect(await fetchProductImage(IMG, at(() => new Response('gone', { status: 404 })))).toEqual({ ok: false, reason: 'The image link answered 404: find another link.' });
    expect(await fetchProductImage(IMG, at(() => new Response(null, { status: 204 })))).toMatchObject({ ok: false });
  });

  it('refuses more than 5 MB: said up front, or counted while it arrives and cut off', async () => {
    const said = await fetchProductImage(IMG, at(image(pngOf(300, 300), 'image/png', { 'content-length': String(6 * 1024 * 1024) })));
    expect(said).toEqual({ ok: false, reason: 'The image is larger than 5 MB.' });

    let pulled = 0;
    let cancelled = false;
    const endless = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled++;
            controller.enqueue(pulled === 1 ? jpegOf(1000, 1000) : new Uint8Array(512 * 1024));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200, headers: { 'content-type': 'image/jpeg' } },
      );
    expect(await fetchProductImage(IMG, at(endless))).toEqual({ ok: false, reason: 'The image is larger than 5 MB.' });
    expect(pulled).toBeLessThanOrEqual(12);
    expect(cancelled).toBe(true);
  });

  it('knows the image by its bytes, never its Content-Type: SVG, GIF and HTML refused', async () => {
    expect(await fetchProductImage(IMG, at(image(SVG, 'image/svg+xml')))).toMatchObject({ ok: false, reason: expect.stringMatching(/SVG/) });
    expect(await fetchProductImage(IMG, at(image(SVG, 'image/png')))).toMatchObject({ ok: false, reason: expect.stringMatching(/SVG/) });
    expect(await fetchProductImage(IMG, at(image(GIF, 'image/gif')))).toEqual({ ok: false, reason: 'The link is not a JPEG, PNG or WebP image.' });
    expect(await fetchProductImage(IMG, at(image(new TextEncoder().encode('<!doctype html><title>Sony</title>'), 'image/jpeg')))).toEqual({
      ok: false,
      reason: 'The link is not a JPEG, PNG or WebP image.',
    });
    // a real JPEG said to be text is still a JPEG
    expect(await fetchProductImage(IMG, at(image(jpegOf(1200, 800), 'text/plain')))).toMatchObject({ ok: true, type: 'image/jpeg', width: 1200, height: 800 });
  });

  it('keeps 100 to 8000 pixels a side', async () => {
    expect(await fetchProductImage(IMG, at(image(pngOf(64, 64))))).toEqual({ ok: false, reason: 'The image is 64 × 64 pixels: each side must be at least 100.' });
    expect(await fetchProductImage(IMG, at(image(jpegOf(9000, 400), 'image/jpeg')))).toEqual({ ok: false, reason: 'The image is 9000 × 400 pixels: each side must be at most 8000.' });
  });

  it('gives up after the time allowed, wherever it is stuck', async () => {
    const rules = { maxBytes: 5 * 1024 * 1024, maxRedirects: 3, timeoutMs: 40 };
    const slowDns: ImageFetchDeps = { lookup: () => new Promise(() => undefined), get: async () => new Response(null) };
    expect(await fetchProductImage(IMG, slowDns, rules)).toEqual({ ok: false, reason: 'The image took longer than 0.04 seconds to fetch.' });
    const slowBody = at(() => new Response(new ReadableStream({ start: (c) => c.enqueue(jpegOf(500, 500)) }), { status: 200 }));
    expect(await fetchProductImage(IMG, slowBody, rules)).toMatchObject({ ok: false, reason: expect.stringMatching(/took longer/) });
  });

  it('is made smaller when the server can, else kept as fetched and said so', async () => {
    const smaller = jpegOf(1600, 1200);
    const made = await fetchProductImage(IMG, at(image(pngOf(400, 300)), async () => ({ bytes: smaller, type: 'image/jpeg', width: 1600, height: 1200 })));
    expect(made).toMatchObject({ ok: true, type: 'image/jpeg', width: 1600, height: 1200, resized: true, note: null });
    expect(await fetchProductImage(IMG, at(image(pngOf(400, 300)), async () => null))).toMatchObject({ ok: true, type: 'image/png', resized: false, note: expect.stringMatching(/Kept as fetched/) });
    const broken = await fetchProductImage(IMG, at(image(pngOf(400, 300)), () => Promise.reject(new Error('vips'))));
    expect(broken).toMatchObject({ ok: true, type: 'image/png', resized: false, note: 'Kept as fetched: it could not be made smaller.' });
  });
});

describe('making it smaller with sharp', () => {
  it('keeps at most 1600 px a side, as JPEG, never larger than it was', async () => {
    const wide = await shrinkWithSharp(pngOf(2000, 500));
    expect(wide).toMatchObject({ type: 'image/jpeg', width: 1600, height: 400 });
    expect([...wide!.bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    const small = await shrinkWithSharp(pngOf(200, 150));
    expect(small).toMatchObject({ type: 'image/jpeg', width: 200, height: 150 });
  });
});
