// Where a session was signed in, in words, from the user agent the API kept with it (Your Sessions, the Users page):
// "Safari on macOS", "Chrome on Android", "Trendlix People app on Android". Only a hint for the person: it is what the
// browser says of itself. Pure code (no "@/" imports): tested.

const APP_MARK = 'TrendLIXPeople';

function systemOf(ua: string): string | null {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return null;
}

function browserOf(ua: string): string | null {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'Safari';
  return null;
}

/** The browser and system a user agent names, or the app; "Unknown device" when it says neither. */
export function deviceOf(userAgent: string | null | undefined): string {
  const ua = userAgent?.trim() ?? '';
  const system = systemOf(ua);
  if (ua.endsWith(APP_MARK)) return system ? `Trendlix People app on ${system}` : 'Trendlix People app';
  const browser = browserOf(ua);
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? 'Unknown device';
}
