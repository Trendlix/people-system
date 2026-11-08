import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/features/attendance/attendance_words.dart';
import 'package:people/features/attendance/your_days.dart';
import 'package:people/format.dart';
import 'package:people/models/my_attendance.dart';
import 'package:people/theme/app_theme.dart';
import 'package:people/theme/tokens.dart';

import 'attendance_models_test.dart' show dayJson;

// Your days' rows (owner, 8 November 2026: "show the checking time and the checkout time with the attendance percentage
// without expandding the field"): a day worked shows its check-in, its check-out, its hours and its attendance
// percentage without being opened; a missing check-out is said so; a day not worked stays its date and what it was; and
// the rows fit a 360-point phone at 1.3× text, light and dark, and the iPad's pane. In the app's own font (as the store
// pictures draw it), so what fits here fits on a phone.

/// November 2026 as the owner's phone showed it: a full day, a day checked in and never out (half a day until
/// corrected), leave, a short day, a day exempt from check-in (full hours, no times), a rest day.
MyMonth november() => MyMonth.fromJson({
  'month': '2026-11',
  'person': {
    'month': '2026-11',
    'hoursADay': 9,
    'figures': <String, Object>{},
    'days': [
      dayJson('2026-11-01', inAt: '08:57', outAt: '17:57', hours: 9),
      dayJson('2026-11-02', inAt: '09:00', hours: 4.5, shortHours: 4.5, extra: {'pairs': <Object>[], 'missingCheckOut': true, 'openHalfDay': true, 'openAt': '2026-11-02T09:00:00.000+03:00'}),
      dayJson('2026-11-03', status: 'leave'),
      dayJson('2026-11-04', inAt: '09:10', outAt: '17:30', hours: 8.33, shortHours: 0.67),
      dayJson('2026-11-05', hours: 9, extra: {'exempt': true}),
      dayJson('2026-11-06', status: 'rest'),
    ],
  },
  'corrections': <Object>[],
  'correctable': {'allowed': true, 'reason': null},
  'punches': <Object>[],
});

String at(String date, String time) => clockOf(DateTime.parse('${date}T$time:00.000+03:00'));

/// Your days alone on a phone [width] points wide, its text [scale] times, in the [brightness] look.
Future<void> pumpDays(WidgetTester tester, {double width = 390, double scale = 1, Brightness brightness = Brightness.light, ValueChanged<String>? onOpenDay, String today = '2026-11-08'}) async {
  tester.view
    ..physicalSize = Size(width * 3, 1000 * 3)
    ..devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: appTheme(brightness),
      builder: (context, child) => MediaQuery(data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)), child: child!),
      home: Scaffold(
        body: ListView(
          padding: Tokens.pagePadding,
          children: [YourDaysCard(month: november(), today: today, onOpenDay: onOpenDay ?? (_) {}, onMyCorrections: () {}, onAsk: () {})],
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// A day's row, by its date as the row says it.
Finder rowOf(String label) => find.ancestor(of: find.text(label), matching: find.byType(InkWell)).first;
Finder inRow(String label, Finder what) => find.descendant(of: rowOf(label), matching: what);

/// What a screen reader hears of a day's row: the row is one button, its parts said in order.
String heard(WidgetTester tester, String label) => tester.getSemantics(rowOf(label)).label;

/// The app's own fonts (the tests otherwise draw every letter as a box), from the bundle's font manifest.
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

void main() {
  setUpAll(loadFonts);

  testWidgets('a day worked shows its check-in, check-out, hours and attendance percentage without opening it', (tester) async {
    await pumpDays(tester);
    const day = 'Sun 01 Nov';
    final times = AttendanceWords.rowTimes(at('2026-11-01', '08:57'), at('2026-11-01', '17:57'));
    expect(inRow(day, find.text(AttendanceWords.statusOf('worked'))), findsOneWidget);
    expect(inRow(day, find.text(times)), findsOneWidget);
    expect(inRow(day, find.text('9:00')), findsOneWidget);
    expect(inRow(day, find.text('100%')), findsOneWidget);
    // in the owner's green (over 90%), and said in words to a screen reader
    expect(tester.widget<Text>(inRow(day, find.text('100%'))).style?.color, Palette.light.ok);
    expect(
      heard(tester, day),
      [
        day,
        AttendanceWords.statusOf('worked'),
        AttendanceWords.dayRateLabel('100%'),
        AttendanceWords.rowTimesLabel(at('2026-11-01', '08:57'), at('2026-11-01', '17:57')),
        AttendanceWords.hoursLabel('9:00'),
      ].join('\n'),
    );

    // a short day: 8:20 of 9 hours, 93%, its balance kept
    expect(inRow('Wed 04 Nov', find.text('93%')), findsOneWidget);
    expect(inRow('Wed 04 Nov', find.text('−0:40 short')), findsOneWidget);

    // a day exempt from check-in: no times to show, full hours, 100%
    expect(inRow('Thu 05 Nov', find.text(AttendanceWords.exempt)), findsOneWidget);
    expect(inRow('Thu 05 Nov', find.text('9:00')), findsOneWidget);
    expect(inRow('Thu 05 Nov', find.text('100%')), findsOneWidget);
    expect(inRow('Thu 05 Nov', find.textContaining(' – ')), findsNothing);

    // the date on one line, the percentage on its line, the times under it
    final date = tester.getRect(find.text(day));
    final percent = tester.getRect(inRow(day, find.text('100%')));
    expect((percent.center.dy - date.center.dy).abs(), lessThan(4));
    expect(tester.getRect(inRow(day, find.text(times))).top, greaterThan(date.bottom));
  });

  testWidgets('a day with no check-out says so, counted as half a day: 50%, in red', (tester) async {
    await pumpDays(tester);
    const day = 'Mon 02 Nov';
    expect(inRow(day, find.text('${at('2026-11-02', '09:00')} – ${AttendanceWords.noCheckOut}')), findsOneWidget);
    expect(inRow(day, find.text('4:30')), findsOneWidget);
    expect(inRow(day, find.text('−4:30 short')), findsOneWidget);
    expect(inRow(day, find.text('50%')), findsOneWidget);
    expect(tester.widget<Text>(inRow(day, find.text('50%'))).style?.color, Palette.light.danger);
    expect(heard(tester, day), contains(AttendanceWords.rowTimesLabel(at('2026-11-02', '09:00'), null)));
  });

  testWidgets('today, still checked in: "checked in", with no percentage, hours or balance until the check-out', (tester) async {
    await pumpDays(tester, today: '2026-11-02');
    const day = 'Mon 02 Nov';
    expect(inRow(day, find.text('${at('2026-11-02', '09:00')} – ${AttendanceWords.stillIn}')), findsOneWidget);
    for (final gone in [AttendanceWords.noCheckOut, '4:30', '−4:30 short', '50%']) {
      expect(inRow(day, find.textContaining(gone)), findsNothing, reason: gone);
    }
    expect(heard(tester, day), contains(AttendanceWords.rowTimesTodayLabel(at('2026-11-02', '09:00'))));
  });

  testWidgets('a rest day and a day of leave stay their date and what they were', (tester) async {
    await pumpDays(tester);
    for (final (day, status) in [('Fri 06 Nov', 'rest'), ('Tue 03 Nov', 'leave')]) {
      expect(inRow(day, find.text(AttendanceWords.statusOf(status))), findsOneWidget);
      // no times, hours, percentage or dash
      expect(inRow(day, find.textContaining('%')), findsNothing);
      expect(inRow(day, find.textContaining(':')), findsNothing);
      expect(inRow(day, find.text('—')), findsNothing);
    }
  });

  testWidgets('a day’s row opens the day', (tester) async {
    String? opened;
    await pumpDays(tester, onOpenDay: (d) => opened = d);
    await tester.tap(inRow('Sun 01 Nov', find.text('100%')));
    expect(opened, '2026-11-01');
    await tester.tap(find.text('Fri 06 Nov'));
    expect(opened, '2026-11-06');
  });

  for (final brightness in Brightness.values) {
    testWidgets('fits a 360-point phone at 1.3× text and the iPad’s pane, ${brightness.name}', (tester) async {
      for (final (width, scale) in [(360.0, 1.3), (360.0, 1.0), (540.0, 1.0), (540.0, 1.3)]) {
        await pumpDays(tester, width: width, scale: scale, brightness: brightness);
        expect(tester.takeException(), isNull, reason: '$width points at $scale×');
        final card = tester.getRect(find.byType(YourDaysCard));
        for (final (day, percent) in [('Sun 01 Nov', '100%'), ('Mon 02 Nov', '50%'), ('Wed 04 Nov', '93%')]) {
          final r = tester.getRect(inRow(day, find.text(percent)));
          expect(r.right, lessThanOrEqualTo(card.right), reason: '$percent at $width points, $scale×');
          // on the date's line, the badge beside the date
          expect((r.center.dy - tester.getRect(find.text(day)).center.dy).abs(), lessThan(4), reason: '$day at $width points, $scale×');
        }
        // each day's times on one line, beside its hours
        for (final times in [
          AttendanceWords.rowTimes(at('2026-11-01', '08:57'), at('2026-11-01', '17:57')),
          '${at('2026-11-02', '09:00')} – ${AttendanceWords.noCheckOut}',
        ]) {
          expect(tester.getSize(find.text(times)).height, lessThan(14 * scale * 1.35 * 1.5), reason: '$times at $width points, $scale×');
        }
      }
    });
  }
}
