import { PUSH_CHANNEL, PUSH_TOKEN_MAX } from '@trendlix/shared';
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
  forgetPush,
  isNativeApp,
  nativePlatform,
  onPushOpened,
  onPushReceived,
  OWN_BIOMETRIC_PLUGIN,
  OWN_PUSH_PLUGIN,
  photoName,
  pluginErrorCode,
  pluginOf,
  PUSH_PLUGIN,
  pushData,
  pushStatus,
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

// Phase 4 (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone, a check-in
// reminder)"): the Capacitor Push Notifications plugin, faked here
describe('push notifications on the phone', () => {
  type Listener = (event: unknown) => void;

  /**
   * The shell's PushNotifications plugin: the permission as `permission` says (and `afterAsk` once asked), and on
   * register() the token, a registration error, or nothing at all (`answer`), told to its listeners a moment later.
   */
  function push(options: { permission?: string; afterAsk?: string; answer?: 'token' | 'error' | 'none'; token?: string } = {}) {
    const listeners = new Map<string, Set<Listener>>();
    const emit = (name: string, event: unknown) => listeners.get(name)?.forEach((fn) => fn(event));
    const plugin = {
      checkPermissions: vi.fn(async () => ({ receive: options.permission ?? 'granted' })),
      requestPermissions: vi.fn(async () => ({ receive: options.afterAsk ?? 'granted' })),
      createChannel: vi.fn(async () => undefined),
      register: vi.fn(async () => {
        void Promise.resolve().then(() => {
          if ((options.answer ?? 'token') === 'token') emit('registration', { value: options.token ?? 'fcm-token-1' });
          else if (options.answer === 'error') emit('registrationError', { error: 'SERVICE_NOT_AVAILABLE' });
        });
      }),
      unregister: vi.fn(async () => undefined),
      addListener: vi.fn(async (name: string, fn: Listener) => {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name)!.add(fn);
        return { remove: vi.fn(async () => void listeners.get(name)?.delete(fn)) };
      }),
      emit,
      listening: (name: string) => listeners.get(name)?.size ?? 0,
    };
    return plugin;
  }
  /** The app's own TrendlixPush plugin: the APK built with Firebase's settings, unless said otherwise. */
  const own = (configured: unknown = true) => ({ isConfigured: vi.fn(async () => ({ configured })) });
  const phone = (plugin: ReturnType<typeof push>, platform = 'android', ownPlugin: object | null = own()): NativeHost => ({
    Capacitor: app({ [PUSH_PLUGIN]: plugin, ...(ownPlugin && { [OWN_PUSH_PLUGIN]: ownPlugin }) }, platform),
  });
  /** Lets the plugin's moment-later answers and the listeners' removal happen. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('is unavailable outside the app, or in a shell without the plugin, and nothing is asked', async () => {
    const plugin = push();
    await expect(pushStatus({})).resolves.toBe('unavailable');
    await expect(pushStatus(undefined)).resolves.toBe('unavailable');
    await expect(pushStatus({ Capacitor: app() })).resolves.toBe('unavailable');
    await expect(pushStatus({ Capacitor: { isNativePlatform: () => false, Plugins: { [PUSH_PLUGIN]: plugin } } })).resolves.toBe('unavailable');
    await expect(registerForPush({ ask: true }, {})).resolves.toEqual({ reason: 'unavailable' });
    await expect(registerForPush({ ask: true }, { Capacitor: app() })).resolves.toEqual({ reason: 'unavailable' });
    await expect(forgetPush({})).resolves.toBeUndefined();
    const off = onPushOpened(() => undefined, {});
    expect(off).toBeTypeOf('function');
    off();
    expect(plugin.checkPermissions).not.toHaveBeenCalled();
    expect(plugin.addListener).not.toHaveBeenCalled();
  });

  it('asks nothing of the phone in an APK built without Firebase’s settings (its register() would crash the app)', async () => {
    const cases: [string, object | null][] = [
      ['no TrendlixPush plugin', null],
      ['not configured', own(false)],
      ['configured, not as true', own('yes')],
      ['refusing', { isConfigured: vi.fn(async () => Promise.reject(new Error('x'))) }],
      ['throwing', { isConfigured: vi.fn(() => { throw new Error('x'); }) }],
      ['no method', {}],
    ];
    for (const [, ownPlugin] of cases) {
      const plugin = push();
      await expect(pushStatus(phone(plugin, 'android', ownPlugin))).resolves.toBe('unavailable');
      await expect(registerForPush({ ask: true }, phone(plugin, 'android', ownPlugin))).resolves.toEqual({ reason: 'unavailable' });
      await expect(forgetPush(phone(plugin, 'android', ownPlugin))).resolves.toBeUndefined();
      expect(plugin.register).not.toHaveBeenCalled();
      expect(plugin.unregister).not.toHaveBeenCalled();
      expect(plugin.checkPermissions).not.toHaveBeenCalled();
      expect(plugin.requestPermissions).not.toHaveBeenCalled();
      expect(plugin.createChannel).not.toHaveBeenCalled();
    }
  });

  it('works as ever once the APK says it is configured', async () => {
    const ownPlugin = own(true);
    const plugin = push();
    await expect(pushStatus(phone(plugin, 'android', ownPlugin))).resolves.toBe('granted');
    await expect(registerForPush({ ask: false }, phone(plugin, 'android', ownPlugin))).resolves.toEqual({ token: 'fcm-token-1', platform: 'android' });
    await expect(forgetPush(phone(plugin, 'android', ownPlugin))).resolves.toBeUndefined();
    expect(ownPlugin.isConfigured).toHaveBeenCalledTimes(3);
    expect(plugin.register).toHaveBeenCalledOnce();
    expect(plugin.unregister).toHaveBeenCalledOnce();
  });

  it('says what the phone says of the permission', async () => {
    await expect(pushStatus(phone(push({ permission: 'prompt' })))).resolves.toBe('prompt');
    await expect(pushStatus(phone(push({ permission: 'prompt-with-rationale' })))).resolves.toBe('prompt');
    await expect(pushStatus(phone(push({ permission: 'granted' })))).resolves.toBe('granted');
    await expect(pushStatus(phone(push({ permission: 'denied' })))).resolves.toBe('denied');
    await expect(pushStatus(phone(push({ permission: 'whatever' })))).resolves.toBe('unavailable');
    const broken = push();
    broken.checkPermissions.mockRejectedValueOnce(new Error('x'));
    await expect(pushStatus(phone(broken))).resolves.toBe('unavailable');
  });

  it('registers once allowed: the channel made, the token given, the listeners taken off again', async () => {
    const plugin = push({ token: '  fcm-token-1  ' });
    await expect(registerForPush({ ask: false }, phone(plugin))).resolves.toEqual({ token: 'fcm-token-1', platform: 'android' });
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
    expect(plugin.createChannel).toHaveBeenCalledWith({ id: PUSH_CHANNEL.id, name: PUSH_CHANNEL.name, description: PUSH_CHANNEL.description, importance: 4, vibration: true });
    expect(plugin.register).toHaveBeenCalledOnce();
    // the listeners were there before register() was called
    expect(plugin.addListener.mock.invocationCallOrder.every((n) => n < plugin.register.mock.invocationCallOrder[0])).toBe(true);
    await settle();
    expect(plugin.listening('registration')).toBe(0);
    expect(plugin.listening('registrationError')).toBe(0);
  });

  it('asks the phone only when told to', async () => {
    const quiet = push({ permission: 'prompt' });
    await expect(registerForPush({ ask: false }, phone(quiet))).resolves.toEqual({ reason: 'not_asked' });
    expect(quiet.requestPermissions).not.toHaveBeenCalled();
    expect(quiet.register).not.toHaveBeenCalled();

    const allowed = push({ permission: 'prompt-with-rationale', afterAsk: 'granted' });
    await expect(registerForPush({ ask: true }, phone(allowed))).resolves.toEqual({ token: 'fcm-token-1', platform: 'android' });
    expect(allowed.requestPermissions).toHaveBeenCalledOnce();

    const refused = push({ permission: 'prompt', afterAsk: 'denied' });
    await expect(registerForPush({ ask: true }, phone(refused))).resolves.toEqual({ reason: 'denied' });
    expect(refused.register).not.toHaveBeenCalled();

    // the prompt closed without an answer: not allowed
    await expect(registerForPush({ ask: true }, phone(push({ permission: 'prompt', afterAsk: 'prompt' })))).resolves.toEqual({ reason: 'denied' });
  });

  it('doesn’t ask again once refused', async () => {
    const plugin = push({ permission: 'denied' });
    await expect(registerForPush({ ask: true }, phone(plugin))).resolves.toEqual({ reason: 'denied' });
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
    expect(plugin.register).not.toHaveBeenCalled();
  });

  it('fails on a registration error, a refused register(), or a token it can’t take', async () => {
    const erring = push({ answer: 'error' });
    await expect(registerForPush({ ask: false }, phone(erring))).resolves.toEqual({ reason: 'failed' });
    await settle();
    expect(erring.listening('registration')).toBe(0);

    const refusing = push();
    refusing.register.mockRejectedValueOnce(new Error('no Firebase'));
    await expect(registerForPush({ ask: false }, phone(refusing))).resolves.toEqual({ reason: 'failed' });

    await expect(registerForPush({ ask: false }, phone(push({ token: '   ' })))).resolves.toEqual({ reason: 'failed' });
    await expect(registerForPush({ ask: false }, phone(push({ token: 'x'.repeat(PUSH_TOKEN_MAX + 1) })))).resolves.toEqual({ reason: 'failed' });

    const askFails = push({ permission: 'prompt' });
    askFails.requestPermissions.mockRejectedValueOnce(new Error('x'));
    await expect(registerForPush({ ask: true }, phone(askFails))).resolves.toEqual({ reason: 'failed' });

    const listenFails = push();
    listenFails.addListener.mockRejectedValueOnce(new Error('x'));
    await expect(registerForPush({ ask: false }, phone(listenFails))).resolves.toEqual({ reason: 'failed' });
    expect(listenFails.register).not.toHaveBeenCalled();
  });

  it('registers all the same when the channel can’t be made', async () => {
    const plugin = push();
    plugin.createChannel.mockRejectedValueOnce(new Error('x'));
    await expect(registerForPush({ ask: false }, phone(plugin))).resolves.toEqual({ token: 'fcm-token-1', platform: 'android' });
  });

  it('gives up when the phone doesn’t answer in time', async () => {
    const plugin = push({ answer: 'none' });
    await expect(registerForPush({ ask: false }, phone(plugin), 20)).resolves.toEqual({ reason: 'timeout' });
    await settle();
    expect(plugin.listening('registration')).toBe(0);
    expect(plugin.listening('registrationError')).toBe(0);
  });

  it('makes no channel on an iPhone', async () => {
    const plugin = push();
    await expect(registerForPush({ ask: false }, phone(plugin, 'ios'))).resolves.toEqual({ token: 'fcm-token-1', platform: 'ios' });
    expect(plugin.createChannel).not.toHaveBeenCalled();
  });

  it('tells of a notification tapped, with its data as strings, until taken off', async () => {
    const plugin = push();
    const opened = vi.fn();
    const off = onPushOpened(opened, phone(plugin));
    await settle();
    plugin.emit('pushNotificationActionPerformed', { actionId: 'tap', notification: { id: '1', data: { link: '/leave/1', kind: 'leave_decided', id: 'n1', count: 3 } } });
    expect(opened).toHaveBeenCalledWith({ link: '/leave/1', kind: 'leave_decided', id: 'n1' });
    plugin.emit('pushNotificationActionPerformed', { actionId: 'tap', notification: {} });
    expect(opened).toHaveBeenLastCalledWith({});
    off();
    off();
    await settle();
    expect(plugin.listening('pushNotificationActionPerformed')).toBe(0);
  });

  it('takes a listener off even before the plugin gave its handle', async () => {
    const plugin = push();
    const off = onPushReceived(() => undefined, phone(plugin));
    off();
    await settle();
    expect(plugin.listening('pushNotificationReceived')).toBe(0);
  });

  it('tells of a notification received while open', async () => {
    const plugin = push();
    const received = vi.fn();
    const off = onPushReceived(received, phone(plugin));
    await settle();
    plugin.emit('pushNotificationReceived', { id: '7', title: 'Leave approved', body: 'Your leave from 21/10/2026 is approved.', data: { link: '/leave/1' } });
    expect(received).toHaveBeenCalledWith({ title: 'Leave approved', body: 'Your leave from 21/10/2026 is approved.', data: { link: '/leave/1' } });
    plugin.emit('pushNotificationReceived', null);
    expect(received).toHaveBeenLastCalledWith({ title: '', body: '', data: {} });
    off();
  });

  it('reads a notification’s data as strings only', () => {
    expect(pushData({ link: '/app', kind: 'check_in_reminder', n: 1, x: null })).toEqual({ link: '/app', kind: 'check_in_reminder' });
    expect(pushData(null)).toEqual({});
    expect(pushData('text')).toEqual({});
  });

  it('forgets the phone’s token on signing out, and never fails doing it', async () => {
    const plugin = push();
    await expect(forgetPush(phone(plugin))).resolves.toBeUndefined();
    expect(plugin.unregister).toHaveBeenCalledOnce();
    const failing = push();
    failing.unregister.mockRejectedValueOnce(new Error('x'));
    await expect(forgetPush(phone(failing))).resolves.toBeUndefined();
  });
});
