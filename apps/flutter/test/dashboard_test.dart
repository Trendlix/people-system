import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/dashboard/dashboard_screen.dart';
import 'package:people/features/requests/kinds/od.dart' show OdWords;
import 'package:people/features/today/check_in_words.dart';
import 'package:people/features/sign_in/sign_in_screen.dart';
import 'package:people/platform/locator.dart';
import 'package:people/providers.dart';
import 'package:people/shell/shell_words.dart';
import 'package:people/theme/look.dart';
import 'package:people/theme/tokens.dart';

import 'fakes.dart';

// The Dashboard in the phone design's frame (README Phase 5, 30 October 2026) and one-tap check-in (Phase 1): the
// shift card checks in or out with the spot read at the press; People's refusals and the phone's location problems say
// what to do; the tab bar and the More menu lead on; light or dark is kept.

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

Map<String, Object?> punchJson(String kind, String at, {String place = 'office'}) => {
  'date': '2026-10-30',
  'kind': kind,
  'at': at,
  'place': place,
  'flags': <String>[],
  'locationName': null,
  'officeNetwork': null,
};

Future<void> open(WidgetTester tester, FakePeople people, {FakeLocator? locator, MemoryLookStore? look}) async {
  phoneScreen(tester);
  await tester.pumpWidget(
    ProviderScope(
      retry: noRetry,
      overrides: overridesFor(
        people,
        store: MemorySessionStore(token: 'kept'),
        locator: locator,
        look: look,
      ),
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
      return json({
        ...todayJson(next: 'out', punches: [punchJson('in', '2026-10-30T06:58:00.000Z')]),
        'messages': <String>[],
        'kept': true,
      });
    });
    await open(tester, people);
    expect(find.textContaining(', Hazem'), findsOneWidget);
    expect(find.text('Shift 09:00 – 18:00'), findsOneWidget);
    expect(find.text(CheckInWords.readyToStart), findsOneWidget);

    await tester.tap(find.text(CheckInWords.checkInForWork));
    await tester.pumpAndSettle();
    expect(people.bodyOf('POST /api/me/attendance/punches'), {
      'kind': 'in',
      'latitude': 30.0596,
      'longitude': 31.3462,
      'accuracy': 12,
      'mock': false,
    });
    expect(find.text(CheckInWords.checkOut), findsOneWidget);
    expect(find.textContaining('Checked in · '), findsOneWidget);
    expect(find.textContaining('Checked in at '), findsOneWidget);
    expect(find.text(CheckInWords.workedToday), findsOneWidget);
    // the time worked in the owner's colours (31 October 2026): just checked in, under 80% of the day's hours, red on
    // the dark card
    final timer = tester.widget<Text>(find.byWidgetPredicate((w) => w is Text && (w.semanticsLabel ?? '').contains('of the day’s hours')));
    expect(timer.style?.color, Palette.light.bandColour(RateBand.low, onInverse: true));
  });

  testWidgets('offers official duty among the quick actions, in place of a correction', (tester) async {
    await open(tester, people);
    // owner, 31 October 2026: "replace correction with OD in the homepage for the requests section"
    await tester.scrollUntilVisible(find.text(DashboardWords.officialDuty), 300, scrollable: find.byType(Scrollable).first);
    expect(find.text(DashboardWords.awayFromOffice), findsOneWidget);
    expect(find.text('Fix attendance'), findsNothing);
    await tester.tap(find.text(DashboardWords.officialDuty));
    await tester.pumpAndSettle();
    expect(find.text(OdWords.title), findsWidgets);
  });

  testWidgets('says People’s refusal in its words, the button still there', (tester) async {
    people.on(
      'POST /api/me/attendance/punches',
      (req) => json({'message': 'You’re off the office network. Connect to the office Wi-Fi and try again.'}, 409),
    );
    await open(tester, people);
    await tester.tap(find.text(CheckInWords.checkInForWork));
    await tester.pumpAndSettle();
    expect(find.text('You’re off the office network. Connect to the office Wi-Fi and try again.'), findsOneWidget);
    expect(find.text(CheckInWords.checkInForWork), findsOneWidget);
  });

  testWidgets('never presses without a location: says how to allow it, and opens the settings', (tester) async {
    final locator = FakeLocator((spot: null, problem: LocationProblem.deniedForever));
    await open(tester, people, locator: locator);
    await tester.tap(find.text(CheckInWords.checkInForWork));
    await tester.pumpAndSettle();
    expect(people.calls, isNot(contains('POST /api/me/attendance/punches')));
    expect(find.text(CheckInWords.noLocation(LocationProblem.deniedForever)), findsOneWidget);
    await tester.tap(find.text('Open settings'));
    expect(locator.openedApp, 1);
  });

  testWidgets('shows why someone doesn’t check in on the system, with no button', (tester) async {
    people.on('GET /api/me/attendance/today', (req) => json(todayJson(refusal: 'Freelancers don’t check in on the system.')));
    await open(tester, people);
    expect(find.text('Freelancers don’t check in on the system.'), findsOneWidget);
    expect(find.text(CheckInWords.checkInForWork), findsNothing);
  });

  testWidgets('shows the office network’s lock, and signs out from the More menu', (tester) async {
    people
      ..on('GET /api/me/attendance/today', (req) => json(todayJson(networkLocked: true)))
      ..on('POST /api/auth/logout', (req) => json({}, 204));
    await open(tester, people);
    expect(find.textContaining(CheckInWords.networkNeeded), findsOneWidget);
    await tester.tap(find.text(ShellWords.more));
    await tester.pumpAndSettle();
    await tester.tap(find.text(ShellWords.signOut));
    await tester.pumpAndSettle();
    expect(find.text(SignInWords.subtitle), findsOneWidget);
  });

  testWidgets('moves between the tabs, each its own page', (tester) async {
    await open(tester, people);
    expect(find.text(DashboardWords.intro), findsOneWidget);
    await tester.tap(find.text(ShellWords.requests));
    await tester.pumpAndSettle();
    expect(find.text('My Requests'), findsOneWidget);
    await tester.tap(find.text(ShellWords.attendance));
    await tester.pumpAndSettle();
    expect(find.text('My Attendance'), findsOneWidget);
    await tester.tap(find.text(ShellWords.dashboard));
    await tester.pumpAndSettle();
    expect(find.text(DashboardWords.intro), findsOneWidget);
  });

  testWidgets('switches to the dark look and keeps it for next time', (tester) async {
    final look = MemoryLookStore();
    await open(tester, people, look: look);
    expect(Theme.of(tester.element(find.byType(DashboardScreen))).brightness, Brightness.light);

    await tester.tap(find.byTooltip(ShellWords.toDark));
    await tester.pumpAndSettle();
    expect(Theme.of(tester.element(find.byType(DashboardScreen))).brightness, Brightness.dark);
    expect(look.mode, ThemeMode.dark);
    expect(find.byTooltip(ShellWords.toLight), findsOneWidget);
  });

  testWidgets('opens in the look kept from last time', (tester) async {
    await open(tester, people, look: MemoryLookStore(ThemeMode.dark));
    expect(Theme.of(tester.element(find.byType(DashboardScreen))).brightness, Brightness.dark);
  });
}
