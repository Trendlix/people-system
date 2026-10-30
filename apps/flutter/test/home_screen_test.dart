import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/home/home_screen.dart';
import 'package:people/features/sign_in/sign_in_screen.dart';
import 'package:people/platform/locator.dart';
import 'package:people/providers.dart';
import 'package:people/features/home/work_ring.dart';
import 'package:people/theme/look.dart';

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

Future<void> open(WidgetTester tester, FakePeople people, {FakeLocator? locator, MemoryLookStore? look}) async {
  phoneScreen(tester);
  await tester.pumpWidget(
    ProviderScope(
      retry: noRetry,
      overrides: overridesFor(people, store: MemorySessionStore(token: 'kept'), locator: locator, look: look),
      child: const PeopleApp(),
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
    expect(find.textContaining(', Hazem.'), findsOneWidget);
    expect(find.text('Shift 09:00 – 18:00'), findsOneWidget);
    expect(find.text(HomeWords.notYet), findsOneWidget);
    expect(find.text('00:00'), findsOneWidget);
    expect(find.text(WorkRing.of(8)), findsOneWidget);

    await tester.tap(find.text(HomeWords.checkIn));
    await tester.pumpAndSettle();
    expect(people.bodyOf('POST /api/me/attendance/punches'), {'kind': 'in', 'latitude': 30.0596, 'longitude': 31.3462, 'accuracy': 12, 'mock': false});
    expect(find.text(HomeWords.checkOut), findsOneWidget);
    // the badge, the notice and the day's record
    expect(find.textContaining('Checked in · '), findsOneWidget);
    expect(find.textContaining('Checked in at '), findsOneWidget);
    await tester.scrollUntilVisible(find.text(HomeWords.recordTitle), 200);
    expect(find.text(HomeWords.kindIn), findsOneWidget);
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
    await tester.tap(find.byTooltip(HomeWords.account));
    await tester.pumpAndSettle();
    await tester.tap(find.text(HomeWords.signOut));
    await tester.pumpAndSettle();
    expect(find.text(SignInWords.subtitle), findsOneWidget);
  });

  testWidgets('counts the time worked in the ring: the finished hours and the open check-in’s', (tester) async {
    final since = DateTime.now().toUtc().subtract(const Duration(hours: 1, minutes: 5));
    people.on('GET /api/me/attendance/today', (req) {
      return json({
        ...todayJson(next: 'out', punches: [punchJson('in', since.toIso8601String())]),
        'day': {'hoursCounted': 1.5, 'openAt': since.toIso8601String()},
      });
    });
    await open(tester, people);
    expect(find.text('02:35'), findsOneWidget);
    expect(find.text(HomeWords.checkOut), findsOneWidget);
  });

  testWidgets('switches to the dark look and keeps it for next time', (tester) async {
    final look = MemoryLookStore();
    await open(tester, people, look: look);
    final context = tester.element(find.byType(HomeScreen));
    expect(Theme.of(context).brightness, Brightness.light);

    await tester.tap(find.byTooltip(HomeWords.toDark));
    await tester.pumpAndSettle();
    expect(Theme.of(tester.element(find.byType(HomeScreen))).brightness, Brightness.dark);
    expect(look.mode, ThemeMode.dark);
    expect(find.byTooltip(HomeWords.toLight), findsOneWidget);
  });

  testWidgets('opens in the look kept from last time', (tester) async {
    await open(tester, people, look: MemoryLookStore(ThemeMode.dark));
    expect(Theme.of(tester.element(find.byType(HomeScreen))).brightness, Brightness.dark);
  });
}
