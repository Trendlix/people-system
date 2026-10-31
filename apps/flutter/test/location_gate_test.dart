import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/api/people_client.dart';
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/sign_in/sign_in_screen.dart';
import 'package:people/features/today/check_in_words.dart';
import 'package:people/platform/location_cache.dart';
import 'package:people/platform/location_gate.dart';
import 'package:people/platform/locator.dart';
import 'package:people/providers.dart';

import 'fakes.dart';

// The app only with the location on (owner, 31 October 2026: "app has to be location enabled to work"; "Whole app needs
// location"), and the phone's position sent with each request for People's activity log ("Yes, with each sign-in and
// action").

Future<void> open(WidgetTester tester, FakePeople people, FakeLocator locator, {String? token = 'kept'}) async {
  phoneScreen(tester);
  await tester.pumpWidget(
    ProviderScope(
      retry: noRetry,
      overrides: overridesFor(people, store: MemorySessionStore(token: token), locator: locator),
      child: const PeopleApp(),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> comeBack(WidgetTester tester) async {
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
  await tester.pumpAndSettle();
}

void main() {
  late FakePeople people;

  setUp(() {
    people = FakePeople()
      ..on('GET /api/auth/me', (req) => json(meJson()))
      ..on('GET /api/me/attendance/today', (req) => json({'next': 'in', 'punches': <Object>[]}))
      ..on('POST /api/auth/logout', (req) => json({}, 204));
  });

  testWidgets('with the location off: the gate in place of the app, the switch a tap away, the app once it’s on', (tester) async {
    final locator = FakeLocator()..ready = LocationProblem.serviceOff;
    await open(tester, people, locator);
    expect(find.text(LocationGateWords.title), findsWidgets);
    expect(find.text(LocationGateWords.serviceOff), findsOneWidget);
    expect(find.text(CheckInWords.checkInForWork), findsNothing);
    await tester.tap(find.widgetWithText(FilledButton, LocationGateWords.turnOn));
    await tester.pumpAndSettle();
    expect(locator.openedLocation, 1);
    // still off when it comes back: still the gate; on: the app
    await comeBack(tester);
    expect(find.text(LocationGateWords.serviceOff), findsOneWidget);
    locator.ready = null;
    await comeBack(tester);
    expect(find.text(CheckInWords.checkInForWork), findsOneWidget);
  });

  testWidgets('not allowed: Allow location asks the phone, and the app opens once allowed', (tester) async {
    final locator = FakeLocator()..ready = LocationProblem.denied;
    await open(tester, people, locator);
    expect(find.text(LocationGateWords.denied), findsOneWidget);
    await tester.tap(find.text(LocationGateWords.allow));
    await tester.pumpAndSettle();
    expect(locator.asked, 1);
    expect(find.text(CheckInWords.checkInForWork), findsOneWidget);
  });

  testWidgets('refused for good: the app’s settings, or sign out', (tester) async {
    final locator = FakeLocator()..ready = LocationProblem.deniedForever;
    await open(tester, people, locator);
    await tester.tap(find.text(LocationGateWords.openSettings));
    await tester.pumpAndSettle();
    expect(locator.openedApp, 1);
    await tester.tap(find.text(LocationGateWords.signOut));
    await tester.pumpAndSettle();
    expect(find.text(SignInWords.subtitle), findsOneWidget);
  });

  testWidgets('signed out, the sign-in shows whatever the location', (tester) async {
    await open(tester, people, FakeLocator()..ready = LocationProblem.serviceOff, token: null);
    expect(find.text(SignInWords.subtitle), findsOneWidget);
    expect(find.text(LocationGateWords.serviceOff), findsNothing);
  });

  testWidgets('sends the phone’s last position with the requests after a check-in', (tester) async {
    people.on('POST /api/me/attendance/punches', (req) => json({'next': 'out', 'punches': <Object>[], 'messages': <String>[], 'kept': true}));
    await open(tester, people, FakeLocator());
    await tester.tap(find.text(CheckInWords.checkInForWork));
    await tester.pumpAndSettle();
    final after = people.sent.where((r) => r.url.path == '/api/me/attendance/punches').last;
    expect(after.headers[PeopleClient.locationHeader], '30.059600,31.346200,12');
  });

  test('reads the position at most once a minute, keeps it 30 minutes, says a mock one', () async {
    var now = DateTime(2026, 10, 31, 12);
    final locator = FakeLocator();
    var reads = 0;
    final counting = _CountingLocator(locator, () => reads++);
    final cache = LocationCache(counting, now: () => now);
    expect(cache.header(), isNull);
    cache.refreshIfStale();
    await Future<void>.delayed(Duration.zero);
    expect(cache.header(), '30.059600,31.346200,12');
    cache.refreshIfStale();
    await Future<void>.delayed(Duration.zero);
    expect(reads, 1);
    now = now.add(const Duration(minutes: 2));
    cache.refreshIfStale();
    await Future<void>.delayed(Duration.zero);
    expect(reads, 2);
    now = now.add(const Duration(minutes: 31));
    expect(cache.header(), isNull);
    expect(LocationCache.headerOf((latitude: 30.1, longitude: 31.2, accuracy: 5.6, mock: true)), '30.100000,31.200000,6,mock');
  });
}

class _CountingLocator implements Locator {
  _CountingLocator(this.inner, this.onRead);

  final FakeLocator inner;
  final void Function() onRead;

  @override
  Future<LocationRead> read() {
    onRead();
    return inner.read();
  }

  @override
  Future<LocationProblem?> readiness() => inner.readiness();

  @override
  Future<LocationProblem?> ask() => inner.ask();

  @override
  Future<void> openAppSettings() => inner.openAppSettings();

  @override
  Future<void> openLocationSettings() => inner.openLocationSettings();
}
