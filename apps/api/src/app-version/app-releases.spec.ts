import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_DOWNLOAD_URL, appVersionOf, compareVersions, latestFor, latestFromRelease, PLAY_TESTING_URL, removeOldFirstFor, UNKNOWN_APP } from './app-releases.js';
import { AppReleasesService } from './app-releases.service.js';

const release = (tag: string, more: Record<string, unknown> = {}) => ({ tag_name: tag, published_at: '2026-10-31T18:00:00Z', draft: false, prerelease: false, ...more });

describe('the newest build from a release', () => {
  it('reads the version from the tag', () => {
    expect(latestFromRelease(release('app-0.6.15'))).toEqual({ version: '0.6.15', publishedAt: '2026-10-31T18:00:00Z', downloadUrl: APP_DOWNLOAD_URL, removeOldFirst: true, sameKeySince: null });
  });

  it('reads since which version its signing key is the same, as the release notes say (flutter-android.yml)', () => {
    const body = 'The employee app, version 0.6.29 (code 1029). Install: open the .apk on the phone.\n\nSigning certificate SHA-256: ab12\nSame signing key since app-0.6.27\n';
    expect(latestFromRelease(release('app-0.6.29', { body }))?.sameKeySince).toBe('0.6.27');
    expect(latestFromRelease(release('app-0.6.26', { body: 'The employee app, version 0.6.26 (code 1026). Install: open the .apk on the phone.' }))?.sameKeySince).toBeNull();
  });

  // owner, 6 November 2026: "now i have google play console"; "Play only": once a Play build is the latest, Play
  it('sends the phones to Google Play once a Play build is the latest, those on another key removing theirs first', () => {
    const body = 'The employee app, version 0.7.40 (code 1040), for Google Play.\n\nGoogle Play build\nSame signing key since app-0.7.40\n';
    expect(latestFromRelease(release('app-0.7.40', { body }))).toEqual({
      version: '0.7.40',
      publishedAt: '2026-10-31T18:00:00Z',
      downloadUrl: PLAY_TESTING_URL,
      removeOldFirst: true,
      sameKeySince: '0.7.40',
    });
    // while it is a pre-release (Play not live yet), nobody is moved
    expect(latestFromRelease(release('app-0.7.40', { body, prerelease: true }))).toBeNull();
  });

  it('takes no other tag, a draft or a pre-release', () => {
    expect(latestFromRelease(release('v1.0.0'))).toBeNull();
    expect(latestFromRelease(release('app-latest'))).toBeNull();
    expect(latestFromRelease(release('app-0.6.15', { draft: true }))).toBeNull();
    expect(latestFromRelease(release('app-0.6.15', { prerelease: true }))).toBeNull();
    expect(latestFromRelease(null)).toBeNull();
  });
});

// owner, 2 November 2026: "if it is not applicable skip it" (the step to remove the old version before installing)
describe('removing the old version first, only when needed', () => {
  const UA = (v: string) => `Trendlix People/${v} (android) TrendlixPeopleApp`;

  it('reads the app’s version from its user agent', () => {
    expect(appVersionOf(UA('0.6.26'))).toBe('0.6.26');
    expect(appVersionOf('Mozilla/5.0 (Macintosh)')).toBeNull();
    expect(appVersionOf(undefined)).toBeNull();
  });

  it('compares versions part by part', () => {
    expect(compareVersions('0.6.9', '0.6.10')).toBe(-1);
    expect(compareVersions('0.6.27', '0.6.27')).toBe(0);
    expect(compareVersions('0.7.1', '0.6.30')).toBe(1);
  });

  it('not for a phone whose build has the newest one’s key: Android installs the update over it', () => {
    const latest = { sameKeySince: '0.6.27' };
    expect(removeOldFirstFor(latest, '0.6.27')).toBe(false);
    expect(removeOldFirstFor(latest, '0.6.28')).toBe(false);
    // signed with another key: Android refuses the update until it is removed
    expect(removeOldFirstFor(latest, '0.6.26')).toBe(true);
  });

  it('yes when it can’t be told: a release from before it said, or a version not known', () => {
    expect(removeOldFirstFor({ sameKeySince: null }, '0.6.26')).toBe(true);
    expect(removeOldFirstFor({ sameKeySince: '0.6.27' }, null)).toBe(true);
  });

  it('answers each phone for itself, without the release’s own line', () => {
    const latest = { ...latestFromRelease(release('app-0.6.29', { body: 'Same signing key since app-0.6.27' }))! };
    expect(latestFor(latest, UA('0.6.28'))).toEqual({ version: '0.6.29', publishedAt: '2026-10-31T18:00:00Z', downloadUrl: APP_DOWNLOAD_URL, removeOldFirst: false });
    expect(latestFor(latest, UA('0.6.26')).removeOldFirst).toBe(true);
    expect(latestFor(UNKNOWN_APP, UA('0.6.26')).removeOldFirst).toBe(true);
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
