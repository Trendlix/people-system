import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter/widgets.dart' show Size;
import 'package:flutter_test/flutter_test.dart' show WidgetTester, addTearDown;
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:people/api/people_client.dart';
import 'package:people/auth/auth_controller.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/platform/biometrics.dart';
import 'package:people/platform/device_name.dart';
import 'package:people/platform/locator.dart';
import 'package:people/providers.dart';
import 'package:people/theme/look.dart';

// Stand-ins for People and the phone in the tests: People answers by route; the fingerprint, the location and the
// phone's name say what each test needs.

/// People as the tests set it: a handler per "METHOD /path", every request kept.
class FakePeople {
  final routes = <String, http.Response Function(http.Request)>{};
  final sent = <http.Request>[];

  void on(String route, http.Response Function(http.Request) answer) => routes[route] = answer;

  MockClient get client => MockClient((req) async {
    sent.add(req);
    final answer = routes['${req.method} ${req.url.path}'];
    return answer == null ? http.Response('{"message":"Not found."}', 404) : answer(req);
  });

  List<String> get calls => [for (final r in sent) '${r.method} ${r.url.path}'];

  Map<String, dynamic> bodyOf(String route) => jsonDecode(sent.lastWhere((r) => '${r.method} ${r.url.path}' == route).body) as Map<String, dynamic>;
}

http.Response json(Object body, [int status = 200, Map<String, String> headers = const {}]) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json', ...headers});

/// A sign-in's answer, the session in its cookie as Express sets it.
http.Response signedIn(String token, Object body) =>
    json(body, 200, {'set-cookie': 'ps_session=$token; Max-Age=28800; Path=/; Expires=Thu, 30 Oct 2026 18:00:00 GMT; HttpOnly; SameSite=Lax'});

Map<String, Object?> meJson({String id = 'u1', String name = 'Hazem Soliman', bool hold = false}) =>
    {'id': id, 'email': 'h.test@example.test', 'roles': ['employee'], 'name': name, 'employeeId': 'e1', if (hold) 'hold': true};

class FakeBiometrics implements Biometrics {
  FakeBiometrics({this.has = true, this.outcome = FingerprintOutcome.confirmed});

  bool has;
  FingerprintOutcome outcome;
  final asked = <String>[];

  @override
  Future<bool> available() async => has;

  @override
  Future<FingerprintOutcome> confirm(String reason) async {
    asked.add(reason);
    return outcome;
  }
}

class FakeIdentity implements DeviceIdentity {
  @override
  String get platform => 'android';

  @override
  Future<String> name() async => 'Google Pixel 8';

  @override
  Future<String> system() async => 'Android 15 (SDK 35)';
}

class FakeLocator implements Locator {
  FakeLocator([this.answer = (spot: (latitude: 30.0596, longitude: 31.3462, accuracy: 12, mock: false), problem: null)]);

  LocationRead answer;
  var openedApp = 0;
  var openedLocation = 0;

  /// What readiness() says (the gate's check, 31 October 2026); null: ready.
  LocationProblem? ready;

  /// What ask() leaves missing once asked; null: allowed.
  LocationProblem? afterAsking;
  var asked = 0;

  @override
  Future<LocationRead> read() async => answer;

  @override
  Future<LocationProblem?> readiness() async => ready;

  @override
  Future<LocationProblem?> ask() async {
    asked++;
    ready = afterAsking;
    return ready;
  }

  @override
  Future<void> openAppSettings() async => openedApp++;

  @override
  Future<void> openLocationSettings() async => openedLocation++;
}

/// The app's providers over the fakes. The client is built as the app builds it, a 401 signing out.
List<Override> overridesFor(FakePeople people, {required MemorySessionStore store, FakeBiometrics? biometrics, FakeLocator? locator, MemoryLookStore? look}) => [
  sessionStoreProvider.overrideWithValue(store),
  lookStoreProvider.overrideWithValue(look ?? MemoryLookStore()),
  biometricsProvider.overrideWithValue(biometrics ?? FakeBiometrics(has: false)),
  deviceIdentityProvider.overrideWithValue(FakeIdentity()),
  locatorProvider.overrideWithValue(locator ?? FakeLocator()),
  peopleClientProvider.overrideWith(
    (ref) => PeopleClient(
      baseUrl: 'https://people.example.test',
      httpClient: people.client,
      userAgent: userAgentOf('0.2.0', 'android'),
      token: store.read,
      onSessionEnded: () => ref.read(authProvider.notifier).sessionEnded(),
      location: () => ref.read(locationCacheProvider).header(),
    ),
  ),
];

/// A container over the fakes, for tests without widgets.
ProviderContainer containerFor(FakePeople people, {required MemorySessionStore store, FakeBiometrics? biometrics, FakeLocator? locator}) {
  final c = ProviderContainer(retry: noRetry, overrides: overridesFor(people, store: store, biometrics: biometrics, locator: locator));
  addTearDown(c.dispose);
  return c;
}

/// The screen of a common Android phone (412 × 915), for the widget tests.
void phoneScreen(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(1080, 2400)
    ..devicePixelRatio = 1080 / 412;
  addTearDown(tester.view.reset);
}
