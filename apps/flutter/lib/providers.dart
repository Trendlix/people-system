import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api/people_client.dart';
import 'api/secure_http.dart';
import 'auth/auth_controller.dart';
import 'auth/session_store.dart';
import 'config.dart';
import 'platform/device_name.dart';
import 'platform/locator.dart';
import 'platform/location_cache.dart';

/// Nothing is tried again by itself (Riverpod would, with a growing wait): a failure shows, with its Try again.
Duration? noRetry(int retryCount, Object error) => null;

/// This build's settings (config.dart).
final configProvider = Provider<AppConfig>((ref) => AppConfig.fromEnvironment());

/// Where the session token and the fingerprint credential are kept.
final sessionStoreProvider = Provider<SessionStore>((ref) => const SecureSessionStore());

/// The phone's name and platform, for fingerprint sign-in.
final deviceIdentityProvider = Provider<DeviceIdentity>((ref) => PhoneIdentity());

/// Where the phone is, read at a press.
final locatorProvider = Provider<Locator>((ref) => const DeviceLocator());

/// The phone's last position, sent with each request for People's activity log (owner, 31 October 2026).
final locationCacheProvider = Provider<LocationCache>((ref) => LocationCache(ref.watch(locatorProvider)));

/// The client every screen talks to People with; a session People refuses signs the app out.
final peopleClientProvider = Provider<PeopleClient>((ref) {
  final config = ref.watch(configProvider);
  final store = ref.watch(sessionStoreProvider);
  final http = peopleHttpClient(config.caPem);
  ref.onDispose(http.close);
  return PeopleClient(
    baseUrl: config.apiUrl,
    httpClient: http,
    userAgent: userAgentOf(config.version, defaultTargetPlatform.name),
    token: store.read,
    onSessionEnded: () => ref.read(authProvider.notifier).sessionEnded(),
    location: () => ref.read(locationCacheProvider).header(),
    onRequest: () => ref.read(locationCacheProvider).refreshIfStale(),
  );
});
