import { describe, expect, it, vi } from 'vitest';
import {
  BIOMETRIC_PROMPTS,
  biometricStatus,
  CAMERA_MESSAGES,
  cameraErrorKind,
  canTakePhoto,
  clearBiometric,
  enrollBiometric,
  geolocationSource,
  getPosition,
  isNativeApp,
  NATIVE_LATER,
  nativePlatform,
  OWN_BIOMETRIC_PLUGIN,
  photoName,
  pluginErrorCode,
  pluginOf,
  registerForPush,
  takePhoto,
  unlockBiometric,
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

// Phase 3 (owner, 20 October 2026: chose Face ID / fingerprint sign-in for the app; README: "Sign-in: Face ID /
// fingerprint after the first password sign-in"): the app's own TrendlixBiometric plugin, faked here
describe('the fingerprint, for signing in', () => {
  /** A plugin refusal as the shell gives it: an error with its code. */
  const refusal = (code: string) => Object.assign(new Error(`refused: ${code}`), { code });

  /** The shell's TrendlixBiometric plugin, answering as given (each method replaceable). */
  function biometric(overrides: Partial<Record<'isAvailable' | 'isEnrolled' | 'enroll' | 'unlock' | 'clear', (...args: never[]) => unknown>> = {}) {
    return {
      isAvailable: vi.fn(async () => ({ available: true, deviceName: 'Google Pixel 8' })),
      isEnrolled: vi.fn(async () => ({ enrolled: false })),
      enroll: vi.fn(async () => ({ enrolled: true })),
      unlock: vi.fn(async () => ({ id: 'cred-1', secret: 's3cr3t-value' })),
      clear: vi.fn(async () => ({})),
      ...overrides,
    };
  }
  const phone = (plugin: ReturnType<typeof biometric>, platform = 'android'): NativeHost => ({ Capacitor: app({ [OWN_BIOMETRIC_PLUGIN]: plugin }, platform) });

  it('is unavailable outside the app, or in a shell without the plugin, and nothing is asked', async () => {
    const off = { available: false, reason: 'NOT_APP', enrolled: false, id: null, deviceName: null, platform: null };
    await expect(biometricStatus({})).resolves.toEqual(off);
    await expect(biometricStatus(undefined)).resolves.toEqual(off);
    await expect(biometricStatus({ Capacitor: app() })).resolves.toEqual(off);
    const plugin = biometric();
    await expect(biometricStatus({ Capacitor: { isNativePlatform: () => false, Plugins: { [OWN_BIOMETRIC_PLUGIN]: plugin } } })).resolves.toEqual(off);
    expect(plugin.isAvailable).not.toHaveBeenCalled();
    await expect(enrollBiometric('cred-1', 'secret', {})).resolves.toEqual({ kind: 'unavailable' });
    await expect(unlockBiometric({})).resolves.toEqual({ kind: 'unavailable' });
    await expect(clearBiometric({})).resolves.toBeUndefined();
  });

  it('says the phone can, with its name and kind, and nothing kept yet', async () => {
    await expect(biometricStatus(phone(biometric()))).resolves.toEqual({
      available: true,
      reason: null,
      enrolled: false,
      id: null,
      deviceName: 'Google Pixel 8',
      platform: 'android',
    });
    const iphone = biometric({ isAvailable: async () => ({ available: true, deviceName: '  ' }) });
    await expect(biometricStatus(phone(iphone, 'ios'))).resolves.toMatchObject({ available: true, deviceName: null, platform: 'ios' });
  });

  it('gives the credential’s id once one is kept (never the secret)', async () => {
    const status = await biometricStatus(phone(biometric({ isEnrolled: async () => ({ enrolled: true, id: 'cred-7' }) })));
    expect(status).toMatchObject({ available: true, enrolled: true, id: 'cred-7' });
    expect(JSON.stringify(status)).not.toContain('secret');
    // "enrolled" without an id isn't one
    await expect(biometricStatus(phone(biometric({ isEnrolled: async () => ({ enrolled: true }) })))).resolves.toMatchObject({ enrolled: false, id: null });
  });

  it('says why the phone can’t, in the plugin’s words', async () => {
    for (const reason of ['NONE_ENROLLED', 'NO_HARDWARE', 'WEAK_ONLY', 'UNAVAILABLE']) {
      const plugin = biometric({ isAvailable: async () => ({ available: false, reason, deviceName: 'Samsung SM-A146B' }) });
      await expect(biometricStatus(phone(plugin))).resolves.toMatchObject({ available: false, reason, deviceName: 'Samsung SM-A146B', platform: 'android' });
    }
    // a reason it never gives, or none
    await expect(biometricStatus(phone(biometric({ isAvailable: async () => ({ available: false, reason: 'WHATEVER' }) })))).resolves.toMatchObject({ reason: 'UNAVAILABLE' });
    await expect(biometricStatus(phone(biometric({ isAvailable: async () => ({}) })))).resolves.toMatchObject({ available: false, reason: 'UNAVAILABLE' });
  });

  it('is unavailable when the plugin throws, and never fails itself', async () => {
    const throwing = biometric({ isAvailable: async () => Promise.reject(new Error('broken')) });
    await expect(biometricStatus(phone(throwing))).resolves.toEqual({ available: false, reason: 'UNAVAILABLE', enrolled: false, id: null, deviceName: null, platform: 'android' });
    const sync = biometric({
      isAvailable: () => {
        throw new Error('sync');
      },
    });
    await expect(biometricStatus(phone(sync))).resolves.toMatchObject({ available: false, reason: 'UNAVAILABLE' });
    // a failing isEnrolled: nothing kept, as far as the page knows
    await expect(biometricStatus(phone(biometric({ isEnrolled: async () => Promise.reject(new Error('x')) })))).resolves.toMatchObject({ available: true, enrolled: false });
  });

  it('turns it on behind the fingerprint, with the page’s own prompt', async () => {
    const plugin = biometric();
    await expect(enrollBiometric('cred-1', 'secret-1', phone(plugin))).resolves.toEqual({ kind: 'enrolled' });
    expect(plugin.enroll).toHaveBeenCalledWith({ id: 'cred-1', secret: 'secret-1', title: 'Turn on fingerprint sign-in', negativeButtonText: 'Cancel' });
    expect(BIOMETRIC_PROMPTS.enroll).toEqual({ title: 'Turn on fingerprint sign-in', negativeButtonText: 'Cancel' });
    // an answer that doesn't say so, or nothing to keep
    await expect(enrollBiometric('cred-1', 'secret-1', phone(biometric({ enroll: async () => ({}) })))).resolves.toEqual({ kind: 'failed' });
    await expect(enrollBiometric('', 'secret-1', phone(biometric()))).resolves.toEqual({ kind: 'failed' });
  });

  it('reads each refusal of turning it on', async () => {
    const refusing = (code: string) => phone(biometric({ enroll: async () => Promise.reject(refusal(code)) }));
    await expect(enrollBiometric('c', 's', refusing('CANCELLED'))).resolves.toEqual({ kind: 'cancelled' });
    await expect(enrollBiometric('c', 's', refusing('LOCKOUT'))).resolves.toEqual({ kind: 'lockout' });
    await expect(enrollBiometric('c', 's', refusing('NOT_AVAILABLE'))).resolves.toEqual({ kind: 'unavailable' });
    await expect(enrollBiometric('c', 's', refusing('KEY_INVALIDATED'))).resolves.toEqual({ kind: 'failed' });
    await expect(enrollBiometric('c', 's', refusing('FAILED'))).resolves.toEqual({ kind: 'failed' });
    await expect(enrollBiometric('c', 's', phone(biometric({ enroll: async () => Promise.reject(new Error('no code')) })))).resolves.toEqual({ kind: 'failed' });
  });

  it('unlocks the credential with the fingerprint, the sign-in prompt offering the password', async () => {
    const plugin = biometric();
    await expect(unlockBiometric(phone(plugin))).resolves.toEqual({ kind: 'unlocked', id: 'cred-1', secret: 's3cr3t-value' });
    expect(plugin.unlock).toHaveBeenCalledWith({ title: 'Sign in to TrendLIX People', negativeButtonText: 'Use password' });
    // an answer without a string id and secret
    for (const answer of [{}, { id: 'cred-1' }, { secret: 'x' }, { id: 7, secret: 'x' }, { id: 'cred-1', secret: '' }, null]) {
      await expect(unlockBiometric(phone(biometric({ unlock: async () => answer })))).resolves.toEqual({ kind: 'failed' });
    }
  });

  it('reads each refusal of signing in, a changed fingerprint among them', async () => {
    const refusing = (code: string) => phone(biometric({ unlock: async () => Promise.reject(refusal(code)) }));
    await expect(unlockBiometric(refusing('CANCELLED'))).resolves.toEqual({ kind: 'cancelled' });
    await expect(unlockBiometric(refusing('LOCKOUT'))).resolves.toEqual({ kind: 'lockout' });
    await expect(unlockBiometric(refusing('KEY_INVALIDATED'))).resolves.toEqual({ kind: 'key_invalidated' });
    await expect(unlockBiometric(refusing('NOT_AVAILABLE'))).resolves.toEqual({ kind: 'unavailable' });
    await expect(unlockBiometric(refusing('FAILED'))).resolves.toEqual({ kind: 'failed' });
    await expect(unlockBiometric(refusing('SOMETHING_ELSE'))).resolves.toEqual({ kind: 'failed' });
    const sync = biometric({
      unlock: () => {
        throw refusal('CANCELLED');
      },
    });
    await expect(unlockBiometric(phone(sync))).resolves.toEqual({ kind: 'cancelled' });
  });

  it('clears what the phone keeps, and never fails doing it', async () => {
    const plugin = biometric();
    await expect(clearBiometric(phone(plugin))).resolves.toBeUndefined();
    expect(plugin.clear).toHaveBeenCalledOnce();
    await expect(clearBiometric(phone(biometric({ clear: async () => Promise.reject(new Error('x')) })))).resolves.toBeUndefined();
    const sync = biometric({
      clear: () => {
        throw new Error('sync');
      },
    });
    await expect(clearBiometric(phone(sync))).resolves.toBeUndefined();
  });
});

describe('the later phases', () => {
  it('offers no push yet', async () => {
    await expect(registerForPush()).resolves.toBeNull();
    expect(Object.keys(NATIVE_LATER)).toEqual(['push']);
  });
});
