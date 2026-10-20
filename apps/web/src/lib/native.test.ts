import { describe, expect, it, vi } from 'vitest';
import {
  CAMERA_MESSAGES,
  cameraErrorKind,
  canTakePhoto,
  canUseBiometrics,
  geolocationSource,
  getPosition,
  isNativeApp,
  nativePlatform,
  photoName,
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

// Phase 2 (20 October 2026): the app's own location plugin, which tells a mock (fake GPS) location on Android
describe('the app’s own location, saying whether it is a mock one', () => {
  /** The shell's TrendlixLocation plugin answering with `answer`, or refusing with `refusal` (its message and code). */
  const own = (answer: { latitude: number; longitude: number; accuracy?: number; mock?: boolean } | { refusal: { message: string; code: string } }) => ({
    getPosition: vi.fn(async () => {
      if ('refusal' in answer) throw Object.assign(new Error(answer.refusal.message), { code: answer.refusal.code });
      return { ...answer, timestamp: 1 };
    }),
  });

  it('reads the app’s own plugin first, with whether the point is a mock one', async () => {
    const TrendlixLocation = own({ latitude: 30.06, longitude: 31.34, accuracy: 12, mock: true });
    const Geolocation = { getCurrentPosition: vi.fn() };
    await expect(getPosition({ Capacitor: app({ TrendlixLocation, Geolocation }) })).resolves.toEqual({ latitude: 30.06, longitude: 31.34, accuracy: 12, mock: true });
    expect(TrendlixLocation.getPosition).toHaveBeenCalledWith({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 });
    expect(Geolocation.getCurrentPosition).not.toHaveBeenCalled();
    await expect(getPosition({ Capacitor: app({ TrendlixLocation: own({ latitude: 30, longitude: 31, mock: false }) }) })).resolves.toEqual({ latitude: 30, longitude: 31, accuracy: null, mock: false });
  });

  it('leaves mock out when not known: the Geolocation plugin, a browser, a plugin that doesn’t say', async () => {
    const Geolocation = { getCurrentPosition: vi.fn(async () => ({ coords: { latitude: 30.1, longitude: 31.3, accuracy: 7 } })) };
    expect(await getPosition({ Capacitor: app({ Geolocation }) })).not.toHaveProperty('mock');
    expect(await getPosition({ navigator: { geolocation: browserGeo({ latitude: 30, longitude: 31 }) } })).not.toHaveProperty('mock');
    expect(await getPosition({ Capacitor: app({ TrendlixLocation: own({ latitude: 30, longitude: 31 }) }) })).not.toHaveProperty('mock');
  });

  it('says why there is no point: refused, the phone’s location off, too slow', async () => {
    const refusing = (message: string, code: string) => ({ Capacitor: app({ TrendlixLocation: own({ refusal: { message, code } }) }) });
    await expect(getPosition(refusing('Location permission denied.', 'DENIED'))).resolves.toEqual({ locationError: 'denied' });
    await expect(getPosition(refusing('The phone’s location is off.', 'LOCATION_OFF'))).resolves.toEqual({ locationError: 'unavailable' });
    await expect(getPosition(refusing('No location within the time allowed.', 'TIMEOUT'))).resolves.toEqual({ locationError: 'timeout' });
    await expect(getPosition(refusing('The location could not be read.', 'UNAVAILABLE'))).resolves.toEqual({ locationError: 'unavailable' });
  });

  it('asks the Geolocation plugin instead on a phone without Google Play services, mock not known', async () => {
    const Geolocation = { getCurrentPosition: vi.fn(async () => ({ coords: { latitude: 30.2, longitude: 31.2, accuracy: 30 } })) };
    const TrendlixLocation = own({ refusal: { message: 'Google Play services can’t give the location on this phone.', code: 'NO_PLAY_SERVICES' } });
    await expect(getPosition({ Capacitor: app({ TrendlixLocation, Geolocation }) })).resolves.toEqual({ latitude: 30.2, longitude: 31.2, accuracy: 30 });
    expect(Geolocation.getCurrentPosition).toHaveBeenCalledOnce();
    // a refusal isn't asked again elsewhere
    const denied = { getCurrentPosition: vi.fn() };
    await expect(getPosition({ Capacitor: app({ TrendlixLocation: own({ refusal: { message: 'Location permission denied.', code: 'DENIED' } }), Geolocation: denied }) })).resolves.toEqual({
      locationError: 'denied',
    });
    expect(denied.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('gives up on the app’s plugin when it never answers', async () => {
    await expect(getPosition({ Capacitor: app({ TrendlixLocation: { getPosition: () => new Promise(() => {}) } }) }, 5)).resolves.toEqual({ locationError: 'timeout' });
  });
});

describe('a photo from the app’s camera', () => {
  const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
  const loaded = vi.fn(async () => photo);
  const taken = () => new Date(2026, 9, 20, 9, 15, 3);
  const camera = (answer: () => Promise<unknown>) => ({ Capacitor: app({ Camera: { takePhoto: vi.fn(answer) } }) });

  it('is the file box outside the app, or in a shell without the Camera plugin', async () => {
    expect(canTakePhoto({})).toBe(false);
    expect(canTakePhoto({ Capacitor: app() })).toBe(false);
    await expect(takePhoto({})).resolves.toEqual({ kind: 'unavailable' });
    await expect(takePhoto({ Capacitor: app() })).resolves.toEqual({ kind: 'unavailable' });
  });

  it('takes the photo with the back camera, upright, not saved to the gallery, and gives it as a file', async () => {
    const win = camera(async () => ({ webPath: 'https://people.trendlix.com/_capacitor_file_/photo.jpg', uri: 'file:///photo.jpg' }));
    expect(canTakePhoto(win)).toBe(true);
    const result = await takePhoto(win, loaded, taken);
    expect(result.kind).toBe('photo');
    if (result.kind !== 'photo') return;
    expect(result.file).toBeInstanceOf(File);
    expect(result.file).toMatchObject({ name: 'photo-20261020-091503.jpg', type: 'image/jpeg', size: 3 });
    expect(loaded).toHaveBeenCalledWith('https://people.trendlix.com/_capacitor_file_/photo.jpg');
    expect((win.Capacitor!.Plugins!.Camera as { takePhoto: ReturnType<typeof vi.fn> }).takePhoto).toHaveBeenCalledWith(
      expect.objectContaining({ correctOrientation: true, saveToGallery: false, editable: 'no' }),
    );
  });

  it('says nothing when the camera is closed without a photo, and plainly when it is refused or fails', async () => {
    const refusing = (message: string, code = '') => camera(async () => Promise.reject(Object.assign(new Error(message), { code })));
    await expect(takePhoto(refusing('No picture taken.', 'OS-PLUG-CAMR-0006'), loaded)).resolves.toEqual({ kind: 'cancelled' });
    await expect(takePhoto(refusing('User cancelled photos app'), loaded)).resolves.toEqual({ kind: 'cancelled' });
    await expect(takePhoto(refusing('Camera permission denied'), loaded)).resolves.toEqual({ kind: 'failed', message: CAMERA_MESSAGES.denied });
    await expect(takePhoto(refusing('Something broke'), loaded)).resolves.toEqual({ kind: 'failed', message: CAMERA_MESSAGES.failed });
    // no address for the photo, or one that can't be read
    await expect(takePhoto(camera(async () => ({})), loaded)).resolves.toEqual({ kind: 'failed', message: CAMERA_MESSAGES.failed });
    await expect(takePhoto(camera(async () => ({ webPath: 'x' })), async () => Promise.reject(new Error('404')))).resolves.toEqual({ kind: 'failed', message: CAMERA_MESSAGES.failed });
    expect(cameraErrorKind(null)).toBe('failed');
  });

  it('names a photo from when it was taken, a PNG as one', () => {
    expect(photoName(taken())).toBe('photo-20261020-091503.jpg');
    expect(photoName(taken(), 'image/png')).toBe('photo-20261020-091503.png');
  });
});

describe('the later phases', () => {
  it('offers nothing native yet: Face ID or a fingerprint, push', async () => {
    await expect(canUseBiometrics()).resolves.toBe(false);
    await expect(verifyBiometrics('Sign in to TrendLIX People')).resolves.toBe(false);
    await expect(registerForPush()).resolves.toBeNull();
  });
});
