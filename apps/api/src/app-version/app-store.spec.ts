import { describe, expect, it } from 'vitest';
import { answeredWhenOutdated, APP_STORE_PAGE, fromIphoneApp, iosLatestFromLookup, outdatedIphone } from './app-store.js';

// The iPhone app's forced update (owner, 10 November 2026: "when pushing make the update force to all builds, as some
// all builds dont make force update").

const IPHONE = (v: string) => `Trendlix People/${v} (iOS) TrendLIXPeople`;

describe('the App Store’s version', () => {
  it('reads Apple’s lookup; nothing while the app isn’t in the store', () => {
    expect(iosLatestFromLookup({ resultCount: 1, results: [{ version: '0.6.60', trackViewUrl: 'https://apps.apple.com/eg/app/trendlix-people/id6831911915' }] })).toEqual({
      version: '0.6.60',
      storeUrl: 'https://apps.apple.com/eg/app/trendlix-people/id6831911915',
    });
    expect(iosLatestFromLookup({ resultCount: 0, results: [] })).toEqual({ version: null, storeUrl: APP_STORE_PAGE });
    expect(iosLatestFromLookup({ results: [{ version: 'one', trackViewUrl: 'javascript:x' }] })).toEqual({ version: null, storeUrl: APP_STORE_PAGE });
    expect(iosLatestFromLookup(null)).toEqual({ version: null, storeUrl: APP_STORE_PAGE });
  });
});

describe('an iPhone build older than the store’s', () => {
  const store = { version: '0.6.60', storeUrl: APP_STORE_PAGE };

  it('is refused with words saying to update; the store’s own and a newer TestFlight build aren’t', () => {
    expect(outdatedIphone(IPHONE('0.6.48'), store)).toBe('Update Trendlix People from the App Store: version 0.6.60 is out, and this iPhone has 0.6.48.');
    expect(outdatedIphone(IPHONE('0.6.60'), store)).toBeNull();
    expect(outdatedIphone(IPHONE('0.6.61'), store)).toBeNull();
    // not in the store yet: nobody
    expect(outdatedIphone(IPHONE('0.6.48'), { version: null, storeUrl: APP_STORE_PAGE })).toBeNull();
  });

  it('only the iPhone app’s requests: never Android’s, a browser’s or one without a version', () => {
    expect(fromIphoneApp(IPHONE('0.6.48'))).toBe(true);
    expect(fromIphoneApp('Trendlix People/0.6.48 (android) TrendLIXPeople')).toBe(false);
    expect(fromIphoneApp('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1')).toBe(false);
    expect(outdatedIphone('Trendlix People/0.6.48 (android) TrendLIXPeople', store)).toBeNull();
    expect(outdatedIphone('Mozilla/5.0 (iPhone) TrendLIXPeople', store)).toBeNull();
  });

  it('may still ask whether it is outdated, and the server’s version', () => {
    expect(answeredWhenOutdated('/api/app/ios-latest')).toBe(true);
    expect(answeredWhenOutdated('/api/app/latest')).toBe(true);
    expect(answeredWhenOutdated('/api/version')).toBe(true);
    expect(answeredWhenOutdated('/api/auth/me')).toBe(false);
    expect(answeredWhenOutdated('/api/me/attendance/today')).toBe(false);
  });
});
