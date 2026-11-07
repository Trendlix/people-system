import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/api/people_client.dart';
import 'package:people/app.dart';
import 'package:people/auth/auth_controller.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/config.dart';
import 'package:people/features/today/check_in_words.dart';
import 'package:people/features/today/today_controller.dart';
import 'package:people/platform/away_watch.dart';
import 'package:people/platform/location_pings.dart';
import 'package:people/providers.dart';
import 'package:people/shell/shell_words.dart';

import 'dashboard_test.dart' show punchJson, todayJson;
import 'fakes.dart';

// The location while checked in on iPhones and iPads (owner, 7 November 2026: "yes" to "location when leaving the
// check-in area"): the area around a check-in's spot watched while the company has it on, "Always" asked for after
// saying why, one ping saying so when it isn't given, and the watch stopped at check-out and sign-out. Its spot kept, so
// each load of today starts it again with the session the app has now (sessions last 8 hours). Android as it was.

/// The area of the spot read at the press (FakeLocator's).
const _area = (latitude: 30.0596, longitude: 31.3462, radius: 300.0);

/// A spot kept from an earlier check-in, apart from any reading now.
const _kept = (latitude: 30.0444, longitude: 31.2357);
const _keptArea = (latitude: 30.0444, longitude: 31.2357, radius: 300.0);

Map<String, Object?> _today({bool pings = true, bool checkedIn = false}) => {
  ...todayJson(next: checkedIn ? 'out' : 'in', punches: [if (checkedIn) punchJson('in', '2026-10-30T06:58:00.000Z')]),
  'locationPings': pings,
};

Map<String, Object?> _pressed({bool pings = true, required bool checkedIn}) => {
  ...todayJson(
    next: checkedIn ? 'out' : 'in',
    punches: [punchJson('in', '2026-10-30T06:58:00.000Z'), if (!checkedIn) punchJson('out', '2026-10-30T15:02:00.000Z')],
  ),
  'locationPings': pings,
  'messages': <String>[],
  'kept': true,
};

Future<void> open(WidgetTester tester, FakePeople people, FakeAwayWatch watch, {MemoryAwaySpotStore? spots}) async {
  phoneScreen(tester);
  await tester.pumpWidget(
    ProviderScope(
      retry: noRetry,
      overrides: overridesFor(people, store: MemorySessionStore(token: 'kept'), awayWatch: watch, awaySpots: spots),
      child: const PeopleApp(),
    ),
  );
  await tester.pumpAndSettle();
}

/// The app closed and opened again: a new container over what the phone keeps.
Future<void> reopen(WidgetTester tester, FakePeople people, FakeAwayWatch watch, MemoryAwaySpotStore spots) async {
  await tester.pumpWidget(const SizedBox());
  await open(tester, people, watch, spots: spots);
}

Future<void> checkIn(WidgetTester tester) async {
  await tester.tap(find.text(CheckInWords.checkInForWork));
  await tester.pumpAndSettle();
}

final _iOS = TargetPlatformVariant.only(TargetPlatform.iOS);

void main() {
  late FakePeople people;

  setUp(() {
    people = FakePeople()
      ..on('GET /api/auth/me', (req) => json(meJson()))
      ..on('GET /api/me/attendance/today', (req) => json(_today()))
      ..on('POST /api/me/attendance/punches', (req) => json(_pressed(checkedIn: true)))
      ..on('POST /api/me/attendance/pings', (req) => json({'kept': true, 'status': 'off'}))
      ..on('POST /api/auth/logout', (req) => json({}, 204));
  });

  List<Object?> pings() => [
    for (final r in people.sent)
      if (r.url.path == '/api/me/attendance/pings') jsonDecode(r.body),
  ];

  testWidgets('checked in with the location on: watches 300 m around the spot read at the press, and keeps it', (tester) async {
    final watch = FakeAwayWatch();
    final spots = MemoryAwaySpotStore();
    await open(tester, people, watch, spots: spots);
    await checkIn(tester);
    expect(watch.area, _area);
    expect(spots.spot, (latitude: 30.0596, longitude: 31.3462));
    // "Always" already: nothing asked, nothing sent
    expect(find.text(PingWords.title), findsNothing);
    expect(watch.calls, isNot(contains('requestAlways')));
    expect(pings(), isEmpty);
  }, variant: _iOS);

  testWidgets('with the location off at the company: nothing watched, asked or sent, a kept spot forgotten', (tester) async {
    people
      ..on('GET /api/me/attendance/today', (req) => json(_today(pings: false, checkedIn: true)))
      ..on('POST /api/me/attendance/punches', (req) => json(_pressed(pings: false, checkedIn: true)));
    final watch = FakeAwayWatch(access: LocationAccess.whenInUse);
    final spots = MemoryAwaySpotStore(_kept);
    await open(tester, people, watch, spots: spots);
    expect(spots.spot, isNull);
    people.on('GET /api/me/attendance/today', (req) => json(_today(pings: false)));
    await reopen(tester, people, watch, spots);
    await checkIn(tester);
    expect(watch.calls, everyElement('stop'));
    expect(watch.area, isNull);
    expect(spots.spot, isNull);
    expect(find.text(PingWords.title), findsNothing);
    expect(pings(), isEmpty);
  }, variant: _iOS);

  testWidgets('not “Always”: says what it reads and why, then iOS’s prompt; allowed there, nothing more', (tester) async {
    final watch = FakeAwayWatch(access: LocationAccess.whenInUse, afterAsking: LocationAccess.always);
    await open(tester, people, watch);
    await checkIn(tester);
    expect(find.text(PingWords.title), findsOneWidget);
    expect(find.text(PingWords.disclosureIos), findsOneWidget);
    expect(find.widgetWithText(TextButton, PingWords.notNow), findsOneWidget);
    // Apple's rule: the button before iOS's prompt says Continue, never Allow
    expect(PingWords.allow, 'Continue');
    await tester.tap(find.widgetWithText(FilledButton, PingWords.allow));
    await tester.pumpAndSettle();
    expect(watch.calls, containsAllInOrder(['start', 'authorization', 'requestAlways']));
    expect(watch.area, _area);
    expect(find.text(PingWords.title), findsNothing);
    expect(pings(), isEmpty);
  }, variant: _iOS);

  testWidgets('“Always” refused at iOS’s prompt: one ping says so, for HR', (tester) async {
    final watch = FakeAwayWatch(access: LocationAccess.whenInUse, afterAsking: LocationAccess.whenInUse);
    await open(tester, people, watch);
    await checkIn(tester);
    await tester.tap(find.widgetWithText(FilledButton, PingWords.allow));
    await tester.pumpAndSettle();
    expect(watch.calls, contains('requestAlways'));
    expect(pings(), [
      {'off': 'permission'},
    ]);
    // the watch stays: iOS may still be set to Always in Settings
    expect(watch.area, _area);
  }, variant: _iOS);

  testWidgets('Not now: iOS isn’t asked, and one ping says the location isn’t allowed all the time', (tester) async {
    final watch = FakeAwayWatch(access: LocationAccess.whenInUse);
    await open(tester, people, watch);
    await checkIn(tester);
    await tester.tap(find.text(PingWords.notNow));
    await tester.pumpAndSettle();
    expect(watch.calls, isNot(contains('requestAlways')));
    expect(pings(), [
      {'off': 'permission'},
    ]);
  }, variant: _iOS);

  testWidgets('today loaded while checked in starts the watch again at the kept spot, not at a new reading', (tester) async {
    people.on('GET /api/me/attendance/today', (req) => json(_today(checkedIn: true)));
    final watch = FakeAwayWatch();
    final spots = MemoryAwaySpotStore(_kept);
    await open(tester, people, watch, spots: spots);
    expect(watch.calls, ['start']);
    expect(watch.area, _keptArea);
    expect(spots.spot, _kept);
    expect(find.text(PingWords.title), findsNothing);
  }, variant: _iOS);

  testWidgets('without a kept spot, today loaded while checked in starts nothing', (tester) async {
    people.on('GET /api/me/attendance/today', (req) => json(_today(checkedIn: true)));
    final watch = FakeAwayWatch();
    await open(tester, people, watch);
    expect(watch.calls, isEmpty);
  }, variant: _iOS);

  testWidgets('the spot outlives the app: opened again, the watch starts at the check-in’s', (tester) async {
    final spots = MemoryAwaySpotStore();
    await open(tester, people, FakeAwayWatch(), spots: spots);
    await checkIn(tester);
    people.on('GET /api/me/attendance/today', (req) => json(_today(checkedIn: true)));
    final again = FakeAwayWatch();
    await reopen(tester, people, again, spots);
    expect(again.calls, ['start']);
    expect(again.area, _area);
  }, variant: _iOS);

  testWidgets('a check-out stops the watch and forgets the spot, so today loaded again starts nothing', (tester) async {
    people
      ..on('GET /api/me/attendance/today', (req) => json(_today(checkedIn: true)))
      ..on('POST /api/me/attendance/punches', (req) => json(_pressed(checkedIn: false)));
    final watch = FakeAwayWatch();
    final spots = MemoryAwaySpotStore(_kept);
    await open(tester, people, watch, spots: spots);
    await tester.tap(find.text(CheckInWords.checkOut));
    await tester.pumpAndSettle();
    expect(people.bodyOf('POST /api/me/attendance/punches')['kind'], 'out');
    expect(watch.calls, ['start', 'stop']);
    expect(watch.area, isNull);
    expect(spots.spot, isNull);
    expect(find.text(PingWords.title), findsNothing);
    // checked in again elsewhere (the website): nothing to start from
    final again = FakeAwayWatch();
    await reopen(tester, people, again, spots);
    expect(again.calls, isEmpty);
  }, variant: _iOS);

  testWidgets('sign-out stops the watch and forgets the spot', (tester) async {
    people.on('GET /api/me/attendance/today', (req) => json(_today(checkedIn: true)));
    final watch = FakeAwayWatch();
    final spots = MemoryAwaySpotStore(_kept);
    await open(tester, people, watch, spots: spots);
    await tester.tap(find.text(ShellWords.more));
    await tester.pumpAndSettle();
    await tester.tap(find.text(ShellWords.signOut));
    await tester.pumpAndSettle();
    expect(watch.calls, ['start', 'stop']);
    expect(watch.area, isNull);
    expect(spots.spot, isNull);
    final again = FakeAwayWatch();
    await reopen(tester, people, again, spots);
    expect(again.calls, isEmpty);
  }, variant: _iOS);

  testWidgets('People ending the session stops the watch; signing in again starts it at the kept spot', (tester) async {
    final watch = FakeAwayWatch();
    final spots = MemoryAwaySpotStore(_kept);
    final c = containerFor(people, store: MemorySessionStore(token: 'kept'), awayWatch: watch, awaySpots: spots);
    await c.read(authProvider.future);
    people.on('GET /api/me/attendance/today', (req) => json({'message': 'Your session has ended.'}, 401));
    await expectLater(c.read(peopleClientProvider).get('/api/me/attendance/today'), throwsA(isA<ApiException>()));
    await tester.pump();
    expect(c.read(authProvider).value, isA<SignedOut>());
    expect(watch.calls, ['stop']);
    expect(spots.spot, _kept);

    people
      ..on('POST /api/auth/login', (req) => signedIn('fresh', meJson()))
      ..on('GET /api/me/attendance/today', (req) => json(_today(checkedIn: true)));
    await c.read(authProvider.notifier).signInWithPassword('h.test@example.test', 'secret');
    final today = c.listen(todayProvider, (_, _) {});
    addTearDown(today.close);
    await c.read(todayProvider.future);
    await tester.pump();
    expect(watch.calls, ['stop', 'start']);
    expect(watch.area, _keptArea);
  }, variant: _iOS);

  testWidgets('on Android: no watch, the hourly task and its explanation as before', (tester) async {
    final watch = FakeAwayWatch(access: LocationAccess.whenInUse);
    final spots = MemoryAwaySpotStore();
    await open(tester, people, watch, spots: spots);
    await checkIn(tester);
    expect(find.text(PingWords.disclosureIos), findsNothing);
    expect(pings(), isEmpty);
    expect(spots.spot, isNull);
    // a spot kept anyhow starts nothing either
    spots.spot = _kept;
    people.on('GET /api/me/attendance/today', (req) => json(_today(checkedIn: true)));
    await reopen(tester, people, watch, spots);
    await tester.tap(find.text(ShellWords.more));
    await tester.pumpAndSettle();
    await tester.tap(find.text(ShellWords.signOut));
    await tester.pumpAndSettle();
    expect(watch.calls, isEmpty);
    expect(spots.spot, _kept);
  }, variant: TargetPlatformVariant.only(TargetPlatform.android));

  group('the native side, over people/away_watch', () {
    const channel = MethodChannel('people/away_watch');
    const config = AppConfig(apiUrl: 'https://people.example.test', caPem: '-----BEGIN CERTIFICATE-----', version: '0.6.45');

    testWidgets('given the area, where People is and the session, and what iOS allows', (tester) async {
      final calls = <MethodCall>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (call) async {
        calls.add(call);
        return switch (call.method) {
          'watching' => true,
          'authorization' => 'whenInUse',
          'requestAlways' => 'always',
          _ => null,
        };
      });
      addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, null));
      final watch = ChannelAwayWatch(config: config, store: MemorySessionStore(token: 'kept'));
      await watch.start(30.0596, 31.3462);
      expect(calls.single.method, 'start');
      expect(calls.single.arguments, {
        'latitude': 30.0596,
        'longitude': 31.3462,
        'radius': 300.0,
        'apiUrl': 'https://people.example.test',
        'token': 'kept',
        'userAgent': userAgentOf('0.6.45', 'iOS'),
        'caPem': '-----BEGIN CERTIFICATE-----',
      });
      expect(await watch.watching(), isTrue);
      expect(await watch.authorization(), LocationAccess.whenInUse);
      expect(await watch.requestAlways(), LocationAccess.always);
      await watch.stop();
      expect(calls.map((c) => c.method), ['start', 'watching', 'authorization', 'requestAlways', 'stop']);
    }, variant: _iOS);

    testWidgets('starting again at the kept spot hands it the session the app has now', (tester) async {
      final calls = <MethodCall>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (call) async => calls.add(call));
      addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, null));
      final store = MemorySessionStore(token: 'first');
      final spots = MemoryAwaySpotStore();
      final scheduler = AwayPingScheduler(ChannelAwayWatch(config: config, store: store), spots);
      await scheduler.start(at: (latitude: 30.0596, longitude: 31.3462, accuracy: 12, mock: false));
      // eight hours on, or signed in again: a new session
      store.token = 'second';
      await scheduler.start();
      final starts = [for (final c in calls) c.arguments as Map];
      expect(starts.map((a) => a['token']), ['first', 'second']);
      expect(starts.map((a) => (a['latitude'], a['longitude'])), [(30.0596, 31.3462), (30.0596, 31.3462)]);
      await scheduler.stop();
      expect(spots.spot, isNull);
      await scheduler.start();
      expect(calls.map((c) => c.method), ['start', 'start', 'stop']);
    }, variant: _iOS);

    test('keeps the spot as JSON, and nothing from what it can’t read', () {
      expect(awaySpotOf('{"latitude":30.0596,"longitude":31.3462}'), (latitude: 30.0596, longitude: 31.3462));
      expect(awaySpotOf('{"latitude":30,"longitude":31}'), (latitude: 30.0, longitude: 31.0));
      expect(awaySpotOf(null), isNull);
      expect(awaySpotOf('not json'), isNull);
      expect(awaySpotOf('{"latitude":"30.0596"}'), isNull);
    });

    testWidgets('signed out: nothing started', (tester) async {
      final calls = <MethodCall>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (call) async => calls.add(call));
      addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, null));
      await ChannelAwayWatch(config: config, store: MemorySessionStore()).start(30.0596, 31.3462);
      expect(calls, isEmpty);
    }, variant: _iOS);

    testWidgets('without it (Android, an older build): nothing breaks, nothing known', (tester) async {
      final watch = ChannelAwayWatch(config: config, store: MemorySessionStore(token: 'kept'));
      // the engine's "no such method" comes back in real time
      await tester.runAsync(() async {
        await watch.start(30.0596, 31.3462);
        await watch.stop();
        expect(await watch.watching(), isFalse);
        expect(await watch.authorization(), isNull);
        expect(await watch.requestAlways(), isNull);
      });
    });
  });

  test('says on an iPhone what it reads, when, and that it stops at check-out', () {
    expect(PingWords.disclosureIos, contains('when you leave the place you checked in at'));
    expect(PingWords.disclosureIos, contains('only while you’re checked in'));
    expect(PingWords.disclosureIos, contains('HR'));
    expect(PingWords.disclosureIos, contains('never read after you check out'));
    expect(PingWords.disclosureIos, contains('Change to Always Allow'));
  });
}
