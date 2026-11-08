// The iPad's own layout to look at (owner, 8 November 2026: "i think the Ipad needs a better layout with some more
// features available due to the larger screen"): the real screens over the store pictures' invented people
// (store_screenshots_test.dart), on iPads upright and on their side, and half a Split View (the phone's layout). Not part
// of `flutter test` (outside test/); run by hand:
//
//   flutter test screenshots/ipad_preview_test.dart
//
// The PNGs land in build/ipad-preview/ (git-ignored).

@Tags(['screenshots'])
library;

import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/kpis/kpi_words.dart';
import 'package:people/providers.dart';
import 'package:people/shell/shell_words.dart';
import 'package:people/theme/look.dart';

import '../test/approvals_test.dart' show waitingLeave;
import '../test/fakes.dart';
import 'store_screenshots_test.dart';

/// The iPads drawn: a 13" upright and on its side, an 11" upright and on its side, an iPad mini upright, and half a
/// Split View on a 13" on its side.
const List<Device> iPads = [
  (name: 'ipad-13-portrait', size: Size(2048, 2732), ratio: 2, top: 24, bottom: 20, platform: TargetPlatform.iOS),
  (name: 'ipad-13-landscape', size: Size(2732, 2048), ratio: 2, top: 24, bottom: 20, platform: TargetPlatform.iOS),
  (name: 'ipad-11-portrait', size: Size(1668, 2420), ratio: 2, top: 24, bottom: 20, platform: TargetPlatform.iOS),
  (name: 'ipad-11-landscape', size: Size(2420, 1668), ratio: 2, top: 24, bottom: 20, platform: TargetPlatform.iOS),
  (name: 'ipad-mini-portrait', size: Size(1488, 2266), ratio: 2, top: 24, bottom: 20, platform: TargetPlatform.iOS),
  (name: 'ipad-13-split-half', size: Size(1356, 2048), ratio: 2, top: 24, bottom: 20, platform: TargetPlatform.iOS),
];

/// The screen to build/ipad-preview/, at its full pixels.
Future<void> preview(WidgetTester tester, Device device, String name, {bool dark = false}) async {
  await settle(tester);
  final screen = tester.renderObject<RenderRepaintBoundary>(find.byKey(const ValueKey('screen')));
  final png = await tester.runAsync(() async {
    final image = await screen.toImage(pixelRatio: device.ratio);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    return data!.buffer.asUint8List();
  });
  File('build/ipad-preview/${device.name}-$name.png')
    ..createSync(recursive: true)
    ..writeAsBytesSync(png!);
}

void main() {
  setUpAll(loadFonts);

  for (final device in iPads) {
    final on = TargetPlatformVariant.only(device.platform);

    testWidgets('${device.name}: dashboard', (tester) async {
      await openApp(tester, device, samplePeople());
      await preview(tester, device, '1-dashboard');
    }, variant: on);

    testWidgets('${device.name}: requests', (tester) async {
      await openApp(tester, device, samplePeople());
      await tester.tap(find.text(ShellWords.requests).first);
      await tester.pumpAndSettle();
      await preview(tester, device, '2-requests');
    }, variant: on);

    // the app's own clock, as the Dashboard's, so Today counts the time worked from the 08:56 check-in on People's clock
    // (the store's picture pins the day to 30 October for October's calendar, which counts nothing today: that picture
    // scrolls Today away); the month this one, October's days moved to it
    testWidgets('${device.name}: attendance', (tester) async {
      await openApp(tester, device, samplePeople());
      await tester.tap(find.text(ShellWords.attendance).first);
      await tester.pumpAndSettle();
      await preview(tester, device, '3-attendance');
    }, variant: on);

    testWidgets('${device.name}: profile', (tester) async {
      await openApp(tester, device, samplePeople());
      await tester.tap(find.text(ShellWords.profile).first);
      await tester.pumpAndSettle();
      await preview(tester, device, '4-profile');
    }, variant: on);
  }

  // on a 13" on its side: the dark look; a manager with a leave to approve, open beside the list; My KPIs from the sidebar
  final side = iPads[1];
  final on = TargetPlatformVariant.only(side.platform);

  testWidgets('${side.name}: dark dashboard', (tester) async {
    use(tester, side);
    final people = samplePeople();
    await tester.pumpWidget(
      RepaintBoundary(
        key: const ValueKey('screen'),
        child: ProviderScope(
          retry: noRetry,
          overrides: overridesFor(people, store: MemorySessionStore(token: 'kept'), look: MemoryLookStore(ThemeMode.dark)),
          child: const PeopleApp(),
        ),
      ),
    );
    await settle(tester);
    await preview(tester, side, '5-dashboard-dark');
  }, variant: on);

  testWidgets('${side.name}: a manager’s requests, one to approve open beside the list', (tester) async {
    final now = DateTime.now();
    final people = samplePeople()
      ..on('GET /api/auth/me', (req) => json({...meJson(name: person), 'roles': ['employee', 'manager']}))
      ..on('GET /api/leave/requests', (req) {
        final waiting = waitingLeave('w1', now.subtract(const Duration(days: 1)).toUtc().toIso8601String());
        return json([
          {
            ...waiting,
            'employee': {...waiting['employee']! as Map<String, Object?>, 'fullNameEn': 'Omar Khaled', 'fullNameAr': null},
          },
        ]);
      });
    await openApp(tester, side, people);
    await tester.tap(find.text(ShellWords.requests).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Omar Khaled').first);
    await tester.pumpAndSettle();
    await preview(tester, side, '6-requests-to-approve');
  }, variant: on);

  testWidgets('${side.name}: My KPIs from the sidebar', (tester) async {
    await openApp(tester, side, samplePeople());
    await tester.tap(find.text(KpiWords.myTitle).first);
    await tester.pumpAndSettle();
    await preview(tester, side, '7-my-kpis');
  }, variant: on);
}
