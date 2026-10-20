import { describe, expect, it, vi } from 'vitest';
import {
  canUseBiometrics,
  geolocationSource,
  getPosition,
  isNativeApp,
  nativePlatform,
  pluginErrorCode,
  pluginOf,
  registerForPush,
  takePhoto,
  verifyBiometrics,
  type NativeHost,
} from './native';

/** A browser's navigator.geolocation that answers with `answer` (a point, or an error code). */
function browserGeo(answer: { latitude: number; longitude: number; accuracy?: number } | { code: number }) {
  return {
    getCurrentPosition: vi.fn((ok: PositionCallback, fail?: PositionErrorCallback | null) => {
      if ('code' in answer) fail?.({ code: answer.code, message: 'no' } as GeolocationPositionError);
      else ok({ coords: answer, timestamp: 0 } as unknown as GeolocationPosition);
    }),
  };
}

/** The shell's Capacitor object on an Android phone, with these plugins. */
function app(plugins: Record<string, unknown> = {}, platform = 'android'): NativeHost['Capacitor'] {
  return { isNativePlatform: () => true, getPlatform: () => platform, isPluginAvailable: (name) => name in plugins, Plugins: plugins };
}

describe('where the page runs', () => {
  it('is a browser without the shell, or with Capacitor’s web build', () => {
    expect(isNativeApp({})).toBe(false);
    expect(isNativeApp(undefined)).toBe(false);
    expect(isNativeApp({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } })).toBe(false);
    expect(nativePlatform({})).toBe('web');
  });

  it('is the app inside the shell, on its phone', () => {
    expect(isNativeApp({ Capacitor: app() })).toBe(true);
    expect(nativePlatform({ Capacitor: app() })).toBe('android');
    expect(nativePlatform({ Capacitor: app({}, 'ios') })).toBe('ios');
    expect(nativePlatform({ Capacitor: app({}, 'electron') })).toBe('web');
  });

  it('never fails on a shell that throws', () => {
    const broken = { isNativePlatform: () => { throw new Error('x'); } };
    expect(isNativeApp({ Capacitor: broken })).toBe(false);
  });

  it('finds a plugin only inside the app, and only one the shell carries', () => {
    const Geolocation = { getCurrentPosition: vi.fn() };
    expect(pluginOf('Geolocation', { Capacitor: app({ Geolocation }) })).toBe(Geolocation);
    expect(pluginOf('Camera', { Capacitor: app({ Geolocation }) })).toBeNull();
    expect(pluginOf('Geolocation', { Capacitor: { isNativePlatform: () => false, Plugins: { Geolocation } } })).toBeNull();
  });
});

describe('the location for a check-in', () => {
  it('falls back to the browser’s outside the app', async () => {
    const geo = browserGeo({ latitude: 30.05, longitude: 31.23, accuracy: 18 });
    expect(geolocationSource({ navigator: { geolocation: geo } })).toBe(geo);
    await expect(getPosition({ navigator: { geolocation: geo } })).resolves.toEqual({ latitude: 30.05, longitude: 31.23, accuracy: 18 });
    expect(geo.getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), expect.objectContaining({ enableHighAccuracy: true, maximumAge: 0 }));
  });

  it('uses the browser’s inside an app whose shell has no Geolocation plugin yet', async () => {
    const geo = browserGeo({ latitude: 30, longitude: 31 });
    await expect(getPosition({ Capacitor: app(), navigator: { geolocation: geo } })).resolves.toEqual({ latitude: 30, longitude: 31, accuracy: null });
  });

  it('says why there is no point: refused, too slow, not supported', async () => {
    await expect(getPosition({ navigator: { geolocation: browserGeo({ code: 1 }) } })).resolves.toEqual({ locationError: 'denied' });
    await expect(getPosition({ navigator: { geolocation: browserGeo({ code: 3 }) } })).resolves.toEqual({ locationError: 'timeout' });
    await expect(getPosition({})).resolves.toEqual({ locationError: 'unsupported' });
  });

  it('uses the app’s Geolocation plugin when the shell carries it', async () => {
    const Geolocation = { getCurrentPosition: vi.fn(async () => ({ coords: { latitude: 30.1, longitude: 31.3, accuracy: 7 }, timestamp: 1 })) };
    const geo = browserGeo({ latitude: 1, longitude: 1 });
    await expect(getPosition({ Capacitor: app({ Geolocation }), navigator: { geolocation: geo } })).resolves.toEqual({ latitude: 30.1, longitude: 31.3, accuracy: 7 });
    expect(Geolocation.getCurrentPosition).toHaveBeenCalledWith(expect.objectContaining({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }));
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('reads the plugin’s refusals as the browser’s', async () => {
    const refusing = (message: string) => ({ Capacitor: app({ Geolocation: { getCurrentPosition: async () => Promise.reject(new Error(message)) } }) });
    await expect(getPosition(refusing('Location permission was denied'))).resolves.toEqual({ locationError: 'denied' });
    await expect(getPosition(refusing('Timeout expired'))).resolves.toEqual({ locationError: 'timeout' });
    await expect(getPosition(refusing('Location services are not enabled'))).resolves.toEqual({ locationError: 'unavailable' });
    expect(pluginErrorCode({ code: 'OS-PLUG-GLOC-0003', message: 'User denied location permission' })).toBe(1);
    expect(pluginErrorCode(null)).toBe(2);
  });

  it('gives up on a plugin that never answers', async () => {
    const silent = { Capacitor: app({ Geolocation: { getCurrentPosition: () => new Promise(() => {}) } }) };
    await expect(getPosition(silent, 5)).resolves.toEqual({ locationError: 'timeout' });
  });
});

describe('the later phases', () => {
  it('offers nothing native yet: the camera, Face ID or a fingerprint, push', async () => {
    await expect(takePhoto()).resolves.toBeNull();
    await expect(canUseBiometrics()).resolves.toBe(false);
    await expect(verifyBiometrics('Sign in to TrendLIX People')).resolves.toBe(false);
    await expect(registerForPush()).resolves.toBeNull();
  });
});
