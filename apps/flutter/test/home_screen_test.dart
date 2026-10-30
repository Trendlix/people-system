import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/home/home_screen.dart';
import 'package:people/platform/locator.dart';
import 'package:people/providers.dart';
import 'package:people/theme/app_theme.dart';

import 'fakes.dart';

// One-tap check-in (README Phase 1): Home shows today, and the one big button checks in or out with the spot read at
// the press; People's refusals and the phone's location problems say what to do.

Map<String, Object?> todayJson({String next = 'in', List<Map<String, Object?>> punches = const [], String? refusal, bool networkLocked = false}) => {
  'refusal': refusal,
  'date': '2026-10-30',
  'now': '2026-10-30T07:00:00.000Z',
  'next': next,
  'punches': punches,
  'day': null,
  'exemption': null,
  'expected': 'office',
  'expectedText': 'Expected at the office today',
  'officeLocationSet': true,
  'network': {'locked': networkLocked},
  'gps': {'locked': false},
  'workingFromHome': false,
  'officialDuty': null,
  'ownPlaces': <String>[],
  'location': {'required': false},
  'shift': {'startTime': '09:00', 'endTime': '18:00', 'hoursPerDay': 8, 'graceMinutes': 15, 'countUntil': '20:00'},
  'firstDay': false,
};

Map<String, Object?> punchJson(String kind, String at, {String place = 'office'}) =>
    {'date': '2026-10-30', 'kind': kind, 'at': at, 'place': place, 'flags': <String>[], 'locationName': null, 'officeNetwork': null};

Future<void> open(WidgetTester tester, FakePeople people, {FakeLocator? locator}) async {
  await tester.pumpWidget(
    ProviderScope(
      retry: noRetry,
      overrides: overridesFor(people, store: MemorySessionStore(token: 'kept'), locator: locator),
      child: MaterialApp(theme: appTheme(), home: const AuthGate()),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  late FakePeople people;

  setUp(() {
    people = FakePeople()
      ..on('GET /api/auth/me', (req) => json(meJson()))
      ..on('GET /api/me/attendance/today', (req) => json(todayJson()));
  });

  testWidgets('greets them and checks in with one tap, sending the spot read at the press', (tester) async {
    people.on('POST /api/me/attendance/punches', (req) {
      return json({...todayJson(next: 'out', punches: [punchJson('in', '2026-10-30T06:58:00.000Z')]), 'messages': <String>[], 'kept': true});
    });
    await open(tester, people);
    expect(find.textContaining(', Hazem'), findsOneWidget);
    expect(find.text('Shift 09:00 – 18:00'), findsOneWidget);
    expect(find.text(HomeWords.notYet), findsOneWidget);

    await tester.tap(find.text(HomeWords.checkIn));
    await tester.pumpAndSettle();
    expect(people.bodyOf('POST /api/me/attendance/punches'), {'kind': 'in', 'latitude': 30.0596, 'longitude': 31.3462, 'accuracy': 12, 'mock': false});
    expect(find.text(HomeWords.checkOut), findsOneWidget);
    expect(find.textContaining('Checked in at '), findsNWidgets(2));
  });

  testWidgets('says People’s refusal in its words, the button still there', (tester) async {
    people.on('POST /api/me/attendance/punches', (req) => json({'message': 'You’re off the office network. Connect to the office Wi-Fi and try again.'}, 409));
    await open(tester, people);
    await tester.tap(find.text(HomeWords.checkIn));
    await tester.pumpAndSettle();
    expect(find.text('You’re off the office network. Connect to the office Wi-Fi and try again.'), findsOneWidget);
    expect(find.text(HomeWords.checkIn), findsOneWidget);
  });

  testWidgets('never presses without a location: says how to allow it, and opens the settings', (tester) async {
    final locator = FakeLocator((spot: null, problem: LocationProblem.deniedForever));
    await open(tester, people, locator: locator);
    await tester.tap(find.text(HomeWords.checkIn));
    await tester.pumpAndSettle();
    expect(people.calls, isNot(contains('POST /api/me/attendance/punches')));
    expect(find.text(HomeWords.noLocation(LocationProblem.deniedForever)), findsOneWidget);
    await tester.tap(find.text('Open settings'));
    expect(locator.openedApp, 1);
  });

  testWidgets('shows why someone doesn’t check in on the system, with no button', (tester) async {
    people.on('GET /api/me/attendance/today', (req) => json(todayJson(refusal: 'Freelancers don’t check in on the system.')));
    await open(tester, people);
    expect(find.text('Freelancers don’t check in on the system.'), findsOneWidget);
    expect(find.text(HomeWords.checkIn), findsNothing);
  });

  testWidgets('shows the office network’s lock, and signs out from the menu', (tester) async {
    people
      ..on('GET /api/me/attendance/today', (req) => json(todayJson(networkLocked: true)))
      ..on('POST /api/auth/logout', (req) => json({}, 204));
    await open(tester, people);
    expect(find.text(HomeWords.networkNeeded), findsOneWidget);
    await tester.tap(find.byIcon(Icons.more_vert_rounded));
    await tester.pumpAndSettle();
    await tester.tap(find.text(HomeWords.signOut));
    await tester.pumpAndSettle();
    expect(find.text('Sign in with your work email'), findsOneWidget);
  });
}
