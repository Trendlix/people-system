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
import 'package:people/platform/away_watch.dart';
import 'package:people/platform/location_pings.dart';
import 'package:people/providers.dart';
import 'package:people/shell/shell_words.dart';

import 'dashboard_test.dart' show punchJson, todayJson;
import 'fakes.dart';

// The location while checked in on iPhones and iPads (owner, 7 November 2026: "yes" to "location when leaving the
// check-in area"): the area around a check-in's spot watched while the company has it on, "Always" asked for after
// saying why, one ping saying so when it isn't given, and the watch stopped at check-out and sign-out. Android as it was.

const _area = (latitude: 30.0596, longitude: 31.3462, radius: 300.0);

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

Future<void> open(WidgetTester tester, FakePeople people, FakeAwayWatch watch) async {
  phoneScreen(tester);
  await tester.pumpWidget(
    ProviderScope(
      retry: noRetry,
      overrides: overridesFor(people, store: MemorySessionStore(token: 'kept'), awayWatch: watch),
      child: const PeopleApp(),
    ),
  );
  await tester.pumpAndSettle();
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

  testWidgets('checked in with the location on: watches 300 m around the spot read at the press', (tester) async {
    final watch = FakeAwayWatch();
    await open(tester, people, watch);
    await checkIn(tester);
    expect(watch.area, _area);
    // "Always" already: nothing asked, nothing sent
    expect(find.text(PingWords.title), findsNothing);
    expect(watch.calls, isNot(contains('requestAlways')));
    expect(pings(), isEmpty);
  }, variant: _iOS);

  testWidgets('with the location off at the company: nothing watched, asked or sent', (tester) async {
    people
      ..on('GET /api/me/attendance/today', (req) => json(_today(pings: false)))
      ..on('POST /api/me/attendance/punches', (req) => json(_pressed(pings: false, checkedIn: true)));
    final watch = FakeAwayWatch(access: LocationAccess.whenInUse);
    await open(tester, people, watch);
    await checkIn(tester);
    expect(watch.calls, everyElement('stop'));
    expect(watch.area, isNull);
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

  testWidgets('today read again leaves a running watch as it is; a check-out stops it', (tester) async {
    people
      ..on('GET /api/me/attendance/today', (req) => json(_today(checkedIn: true)))
      ..on('POST /api/me/attendance/punches', (req) => json(_pressed(checkedIn: false)));
    final watch = FakeAwayWatch(area: _area);
    await open(tester, people, watch);
    expect(watch.calls, isEmpty);
    expect(watch.area, _area);
    await tester.tap(find.text(CheckInWords.checkOut));
    await tester.pumpAndSettle();
    expect(people.bodyOf('POST /api/me/attendance/punches')['kind'], 'out');
    expect(watch.calls, ['stop']);
    expect(watch.area, isNull);
    expect(find.text(PingWords.title), findsNothing);
  }, variant: _iOS);

  testWidgets('stops at sign-out', (tester) async {
    people.on('GET /api/me/attendance/today', (req) => json(_today(checkedIn: true)));
    final watch = FakeAwayWatch(area: _area);
    await open(tester, people, watch);
    await tester.tap(find.text(ShellWords.more));
    await tester.pumpAndSettle();
    await tester.tap(find.text(ShellWords.signOut));
    await tester.pumpAndSettle();
    expect(watch.calls, ['stop']);
    expect(watch.area, isNull);
  }, variant: _iOS);

  testWidgets('stops when People ends the session', (tester) async {
    final watch = FakeAwayWatch(area: _area);
    final c = containerFor(people, store: MemorySessionStore(token: 'kept'), awayWatch: watch);
    await c.read(authProvider.future);
    people.on('GET /api/me/attendance/today', (req) => json({'message': 'Your session has ended.'}, 401));
    await expectLater(c.read(peopleClientProvider).get('/api/me/attendance/today'), throwsA(isA<ApiException>()));
    await tester.pump();
    expect(c.read(authProvider).value, isA<SignedOut>());
    expect(watch.calls, ['stop']);
  }, variant: _iOS);

  testWidgets('on Android: no watch, the hourly task and its explanation as before', (tester) async {
    final watch = FakeAwayWatch(access: LocationAccess.whenInUse);
    await open(tester, people, watch);
    await checkIn(tester);
    expect(find.text(PingWords.disclosureIos), findsNothing);
    expect(pings(), isEmpty);
    await tester.tap(find.text(ShellWords.more));
    await tester.pumpAndSettle();
    await tester.tap(find.text(ShellWords.signOut));
    await tester.pumpAndSettle();
    expect(watch.calls, isEmpty);
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
