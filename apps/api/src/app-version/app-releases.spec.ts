import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_DOWNLOAD_URL, latestFromRelease, UNKNOWN_APP } from './app-releases.js';
import { AppReleasesService } from './app-releases.service.js';

const release = (tag: string, more: Record<string, unknown> = {}) => ({ tag_name: tag, published_at: '2026-10-31T18:00:00Z', draft: false, prerelease: false, ...more });

describe('the newest build from a release', () => {
  it('reads the version from the tag', () => {
    expect(latestFromRelease(release('app-0.6.15'))).toEqual({ version: '0.6.15', publishedAt: '2026-10-31T18:00:00Z', downloadUrl: APP_DOWNLOAD_URL, removeOldFirst: true });
  });

  it('takes no other tag, a draft or a pre-release', () => {
    expect(latestFromRelease(release('v1.0.0'))).toBeNull();
    expect(latestFromRelease(release('app-latest'))).toBeNull();
    expect(latestFromRelease(release('app-0.6.15', { draft: true }))).toBeNull();
    expect(latestFromRelease(release('app-0.6.15', { prerelease: true }))).toBeNull();
    expect(latestFromRelease(null)).toBeNull();
  });
});

describe('AppReleasesService', () => {
  afterEach(() => vi.unstubAllGlobals());

  const answering = (...answers: (Response | Error)[]) => {
    const fetch = vi.fn(async () => {
      const next = answers.shift();
      if (!next || next instanceof Error) throw next ?? new Error('no answer');
      return next;
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it('asks GitHub once in five minutes', async () => {
    const fetch = answering(ok(release('app-0.6.15')), ok(release('app-0.6.16')));
    const s = new AppReleasesService();
    expect((await s.latest(0)).version).toBe('0.6.15');
    expect((await s.latest(4 * 60_000)).version).toBe('0.6.15');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await s.latest(6 * 60_000)).version).toBe('0.6.16');
  });

  it('keeps the last answer known when GitHub can’t be reached, and nothing known means no version', async () => {
    answering(new Error('down'), ok(release('app-0.6.15')), new Error('down'));
    const s = new AppReleasesService();
    expect(await s.latest(0)).toEqual(UNKNOWN_APP);
    expect((await s.latest(2 * 60_000)).version).toBe('0.6.15');
    expect((await s.latest(8 * 60_000)).version).toBe('0.6.15');
  });

  it('no release yet: no version', async () => {
    answering(new Response('{"message":"Not Found"}', { status: 404 }));
    expect(await new AppReleasesService().latest(0)).toEqual(UNKNOWN_APP);
  });

  it('phones asking together share one call', async () => {
    const fetch = answering(ok(release('app-0.6.15')));
    const s = new AppReleasesService();
    const [a, b] = await Promise.all([s.latest(0), s.latest(0)]);
    expect(a.version).toBe('0.6.15');
    expect(b.version).toBe('0.6.15');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
