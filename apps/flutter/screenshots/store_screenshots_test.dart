// The App Store's and Google Play's screenshots (owner, 7 November 2026: "prepare screenshots"): the real screens, drawn
// by Flutter over the tests' fakes with invented people only (no real data: every name in the fixtures becomes Nour
// Hassan), at each store's size: an iPhone 6.9" display for the App Store (1320 × 2868, 440 × 956 points at 3x, its
// status bar and home indicator insets, as on iOS), and an Android phone for Google Play (1080 × 2160: Play takes no
// picture more than twice as tall as wide). Not part of `flutter test` (outside test/); run by hand:
//
//   flutter test screenshots/
//   python3 tool/frame_screenshots.py ~/TrendLIX-Store-Screenshots
//
// The PNGs land in screenshots/out/ (git-ignored); frame_screenshots.py adds the status bar for the stores.

@Tags(['screenshots'])
library;

import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/attendance/attendance_data.dart';
import 'package:people/features/attendance/attendance_tab.dart';
import 'package:people/features/attendance/attendance_words.dart';
import 'package:people/format.dart' show isoDayOf;
import 'package:people/providers.dart';
import 'package:people/shell/shell_words.dart';

import '../test/assets_test.dart' as assets;
import '../test/attendance_models_test.dart' as attendance;
import '../test/fakes.dart';
import '../test/profile_models_test.dart' as profile;
import '../test/requests_fixtures.dart';

/// The person in every picture.
const person = 'Nour Hassan';

/// The fixtures' names, all made up but some like a colleague's: shown as [person].
const renamed = ['Hazem Soliman', 'Mohamed Abdelrahman'];

/// People over the fixtures, the names swapped, the routes nobody answered kept to print.
class SamplePeople extends FakePeople {
  final missing = <String>{};

  @override
  MockClient get client => MockClient((req) async {
    sent.add(req);
    final route = '${req.method} ${req.url.path}';
    final answer = routes[route];
    if (answer == null) {
      missing.add(route);
      return http.Response('{"message":"Not found."}', 404);
    }
    final res = answer(req);
    var body = res.body;
    for (final name in renamed) {
      body = body.replaceAll(name, person);
    }
    return http.Response.bytes(utf8.encode(body), res.statusCode, headers: res.headers);
  });
}

/// A phone the pictures are drawn on: its size in pixels, its pixels per point, its status bar and home bar (points).
typedef Device = ({String name, Size size, double ratio, double top, double bottom, TargetPlatform platform});

/// An iPhone 6.9" display (iPhone 16 and 17 Pro Max), for the App Store.
const Device iPhone = (name: 'app-store', size: Size(1320, 2868), ratio: 3, top: 62, bottom: 34, platform: TargetPlatform.iOS);

/// An Android phone, for Google Play.
const Device android = (name: 'google-play', size: Size(1080, 2160), ratio: 2.625, top: 24, bottom: 16, platform: TargetPlatform.android);

void use(WidgetTester tester, Device d) {
  tester.view
    ..physicalSize = d.size
    ..devicePixelRatio = d.ratio
    ..padding = FakeViewPadding(top: d.top * d.ratio, bottom: d.bottom * d.ratio)
    ..viewPadding = FakeViewPadding(top: d.top * d.ratio, bottom: d.bottom * d.ratio);
  addTearDown(tester.view.reset);
}

/// The app's own fonts and icons (the tests otherwise draw every letter as a box), from the bundle's font manifest.
Future<void> loadFonts() async {
  final manifest = jsonDecode(await rootBundle.loadString('FontManifest.json')) as List<dynamic>;
  for (final entry in manifest.cast<Map<String, dynamic>>()) {
    final loader = FontLoader(entry['family'] as String);
    for (final font in (entry['fonts'] as List<dynamic>).cast<Map<String, dynamic>>()) {
      loader.addFont(rootBundle.load(font['asset'] as String));
    }
    await loader.load();
  }
}

/// Today's attendance: checked in at 08:56, and People's clock at 16:20 (the app counts the time worked on People's
/// clock: 7 h 24 min, 92% of the day, in green), whatever the time the pictures are drawn.
Map<String, Object?> todayJson({bool checkedIn = true}) {
  final now = DateTime.now();
  final inAt = DateTime(now.year, now.month, now.day, 8, 56);
  final serverNow = DateTime(now.year, now.month, now.day, 16, 20);
  return {
    'refusal': null,
    'date': isoDayOf(now),
    'now': serverNow.toUtc().toIso8601String(),
    'next': checkedIn ? 'out' : 'in',
    'punches': [
      if (checkedIn)
        {'date': isoDayOf(now), 'kind': 'in', 'at': inAt.toUtc().toIso8601String(), 'place': 'office', 'flags': <String>[], 'locationName': null, 'officeNetwork': null},
    ],
    'day': checkedIn ? {'openAt': inAt.toUtc().toIso8601String(), 'hoursCounted': 0} : null,
    'exemption': null,
    'expected': 'office',
    'expectedText': 'Expected at the office today',
    'officeLocationSet': true,
    'network': {'locked': false},
    'gps': {'locked': false},
    'workingFromHome': false,
    'officialDuty': null,
    'ownPlaces': <String>[],
    'location': {'required': false},
    'shift': {'startTime': '09:00', 'endTime': '18:00', 'hoursPerDay': 8, 'graceMinutes': 15, 'countUntil': '20:00'},
    'firstDay': false,
  };
}

/// A month's attendance: October's fixture for October; any other month the same days moved to it (its rates this week).
Map<String, Object?> monthJson(String month) {
  final october = attendance.octoberJson();
  if (month == '2026-10') return october;
  final moved = jsonDecode(jsonEncode(october).replaceAll('2026-10', month)) as Map<String, Object?>;
  final today = DateTime.now();
  final weekStart = today.subtract(Duration(days: today.weekday % 7));
  return {
    ...moved,
    'rates': {
      'month': month,
      'monthToDate': {'from': '$month-01', 'to': isoDayOf(today), 'attendedDays': 5, 'expectedDays': 5, 'dueHours': 45, 'workedHours': 43.6, 'rate': 43.6 / 45},
      'weeks': [
        {'from': isoDayOf(weekStart), 'to': isoDayOf(weekStart.add(const Duration(days: 6))), 'attendedDays': 4, 'expectedDays': 5, 'dueHours': 45, 'workedHours': 34.8, 'rate': 34.8 / 45, 'current': true},
      ],
    },
  };
}

SamplePeople samplePeople() {
  final people = SamplePeople()..routes.addAll(requestsPeople().routes);
  return people
    ..on('GET /api/auth/me', (req) => json(meJson(name: person)))
    ..on('GET /api/me/attendance/today', (req) => json(todayJson()))
    ..on('GET /api/attendance/me', (req) => json(monthJson(req.url.queryParameters['month']!)))
    ..on('GET /api/me/attendance/corrections', (req) => json(<Object>[]))
    ..on('GET /api/employees/e1', (req) => json({...profileJson(), ...profile.ownProfileJson()}))
    ..on('GET /api/kpis/scorecards/mine', (req) => json(profile.kpisJson()))
    ..on('GET /api/me/custody', (req) => json(assets.custodyJson()))
    ..on('GET /api/me/wfh', (req) => json([wfhJson(id: 'w2', status: 'with_manager')]))
    ..on('GET /api/me/permissions', (req) => json([permissionJson()]));
}

/// The app over [people], signed in (or not), on [device], its pictures loaded.
Future<void> openApp(WidgetTester tester, Device device, SamplePeople people, {bool signedIn = true, DateTime? attendanceDay}) async {
  use(tester, device);
  await tester.pumpWidget(
    RepaintBoundary(
      key: const ValueKey('screen'),
      child: ProviderScope(
        retry: noRetry,
        overrides: [
          ...overridesFor(people, store: signedIn ? MemorySessionStore(token: 'kept') : MemorySessionStore()),
          if (attendanceDay != null) attendanceClockProvider.overrideWithValue(() => attendanceDay),
        ],
        child: const PeopleApp(),
      ),
    ),
  );
  await settle(tester);
}

/// Every picture on screen loaded, then the screen still.
Future<void> settle(WidgetTester tester) async {
  await tester.pumpAndSettle();
  await tester.runAsync(() async {
    for (final e in find.byType(Image).evaluate()) {
      await precacheImage((e.widget as Image).image, e);
    }
  });
  await tester.pumpAndSettle();
}

/// The screen as the phone shows it, at its full pixels (a golden file is only 1x), to screenshots/out/ under the store's name.
Future<void> shoot(WidgetTester tester, Device device, String name, SamplePeople people) async {
  await settle(tester);
  final screen = tester.renderObject<RenderRepaintBoundary>(find.byKey(const ValueKey('screen')));
  final png = await tester.runAsync(() async {
    final image = await screen.toImage(pixelRatio: device.ratio);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    return data!.buffer.asUint8List();
  });
  File('screenshots/out/${device.name}/$name.png')
    ..createSync(recursive: true)
    ..writeAsBytesSync(png!);
  if (people.missing.isNotEmpty) debugPrint('${device.name} $name: not answered ${people.missing}');
}

/// Scrolls [target] (built or not) in the tab's list to [alignment] of the screen (0 the top, 0.5 the middle).
Future<void> scrollTo(WidgetTester tester, Finder list, Finder target, double alignment) async {
  await tester.scrollUntilVisible(target, 300, scrollable: list);
  await Scrollable.ensureVisible(tester.element(target), alignment: alignment);
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(loadFonts);

  for (final device in [iPhone, android]) {
    final on = TargetPlatformVariant.only(device.platform);

    testWidgets('${device.name}: sign-in', (tester) async {
      final people = samplePeople();
      await openApp(tester, device, people, signedIn: false);
      await shoot(tester, device, '1-sign-in', people);
    }, variant: on);

    testWidgets('${device.name}: dashboard', (tester) async {
      final people = samplePeople();
      await openApp(tester, device, people);
      await shoot(tester, device, '2-dashboard', people);
    }, variant: on);

    testWidgets('${device.name}: requests', (tester) async {
      final people = samplePeople();
      await openApp(tester, device, people);
      await tester.tap(find.text(ShellWords.requests));
      await shoot(tester, device, '3-requests', people);
    }, variant: on);

    // October's calendar by month (its leave, holiday and days from home), the tab's today card scrolled away
    testWidgets('${device.name}: attendance', (tester) async {
      final people = samplePeople();
      await openApp(tester, device, people, attendanceDay: DateTime(2026, 10, 30, 14));
      await tester.tap(find.text(ShellWords.attendance));
      await tester.pumpAndSettle();
      final list = find.descendant(of: find.byType(AttendanceTab), matching: find.byType(Scrollable)).first;
      await scrollTo(tester, list, find.text(AttendanceWords.month), 0.5);
      await tester.tap(find.text(AttendanceWords.month));
      await tester.pumpAndSettle();
      await scrollTo(tester, list, find.text(AttendanceWords.month), 0.15);
      await shoot(tester, device, '4-attendance', people);
    }, variant: on);

    testWidgets('${device.name}: profile', (tester) async {
      final people = samplePeople();
      await openApp(tester, device, people);
      await tester.tap(find.text(ShellWords.profile));
      await shoot(tester, device, '5-profile', people);
    }, variant: on);
  }
}
