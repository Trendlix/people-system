import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api/people_client.dart';
import 'api/secure_http.dart';
import 'auth/session_store.dart';
import 'config.dart';

/// Nothing is tried again by itself (Riverpod would, with a growing wait): a failure shows, with its Try again.
Duration? noRetry(int retryCount, Object error) => null;

/// This build's settings (config.dart).
final configProvider = Provider<AppConfig>((ref) => AppConfig.fromEnvironment());

/// Where the session token is kept.
final sessionStoreProvider = Provider<SessionStore>((ref) => const SecureSessionStore());

/// The client every screen talks to People with.
final peopleClientProvider = Provider<PeopleClient>((ref) {
  final config = ref.watch(configProvider);
  final store = ref.watch(sessionStoreProvider);
  final http = peopleHttpClient(config.caPem);
  ref.onDispose(http.close);
  return PeopleClient(baseUrl: config.apiUrl, httpClient: http, userAgent: userAgentOf(config.version, defaultTargetPlatform.name), token: store.read);
});
