import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/config.dart';
import 'package:people/features/about/about_screen.dart';
import 'package:people/features/about/diagnostics.dart';
import 'package:people/providers.dart';
import 'package:people/shell/shell_words.dart';

import 'fakes.dart';

// About this app (owner, 31 October 2026: "display the running app version in the more menu. displaying the details that
// might help in any problem diognostic").

final stamped = AppConfig.parse(apiUrl: '', caBase64: '', version: '0.6.19', build: '1019', commit: '5dbf028', builtAt: '2026-10-31T17:02:11Z');

void main() {
  late FakePeople people;

  setUp(() {
    people = FakePeople()
      ..on('GET /api/auth/me', (req) => json(meJson()))
      ..on('GET /api/me/attendance/today', (req) => json({'next': 'in', 'punches': <Object>[]}))
      ..on('GET /api/app/latest', (req) => json({'version': '0.6.19', 'publishedAt': null, 'downloadUrl': 'https://people.trendlix.com/download', 'removeOldFirst': true}));
  });

  Future<void> openMenu(WidgetTester tester) async {
    phoneScreen(tester);
    await tester.pumpWidget(
      ProviderScope(
        retry: noRetry,
        overrides: [...overridesFor(people, store: MemorySessionStore(token: 'kept')), configProvider.overrideWithValue(stamped)],
        child: const PeopleApp(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text(ShellWords.more));
    await tester.pumpAndSettle();
  }

  Finder page() => find.descendant(of: find.byType(AboutScreen), matching: find.byType(Scrollable)).first;

  group('the words', () {
    test('the menu’s version line', () {
      expect(versionLineOf('0.6.19', '1019'), 'Trendlix People 0.6.19 · build 1019');
      expect(versionLineOf('0.0.0', ''), 'Trendlix People 0.0.0');
    });

    test('the phone’s clock against People’s', () {
      expect(clockText(const Duration(seconds: 3)), 'In step with People');
      expect(clockText(const Duration(seconds: -4)), 'In step with People');
      expect(clockText(const Duration(minutes: 2, seconds: 5)), '2 min 5 s ahead of People');
      expect(clockText(const Duration(seconds: -40)), '40 s behind People');
      expect(clockText(const Duration(hours: -1, minutes: -3)), '1 h 3 min behind People');
    });

    test('the last position', () {
      expect(positionText(accuracy: 11.6, mock: false, age: const Duration(minutes: 3)), '±12 m, 3 min ago');
      expect(positionText(accuracy: 5, mock: true, age: const Duration(seconds: 2)), '±5 m, just now (fake GPS)');
    });

    test('the text to paste: every section, what isn’t known said so', () {
      final text = diagnosticsText(
        Diagnostics(
          appVersion: '0.6.18',
          appBuild: '1018',
          newest: '0.6.19',
          serverAddress: 'srv.example.test',
          phoneModel: 'Google Pixel 8',
          email: 'h.test@example.test',
          roles: const ['employee'],
          showServer: true,
          at: DateTime.utc(2026, 10, 31, 17),
        ),
      );
      expect(text, startsWith('Trendlix People: about this app (2026-10-31T17:00:00Z)\n'));
      expect(text, contains('\nApp\nVersion: 0.6.18\nBuild: 1018\nNewest: 0.6.19 is out: update\n'));
      expect(text, contains('Reached: ${AboutWords.unreachable}\n'));
      expect(text, contains('Phone clock: ${AboutWords.notKnown}\n'));
      expect(text, contains('System: ${AboutWords.notKnown}\n'));
      expect(text, contains('Last position: ${AboutWords.noPosition}\n'));
      expect(text, contains('\nSigned in\nEmail: h.test@example.test\nRoles: employee\n'));
    });
  });

  testWidgets('the More menu shows the running version, and About this app opens from it', (tester) async {
    await openMenu(tester);
    expect(find.text('Trendlix People 0.6.19 · build 1019'), findsOneWidget);
    await tester.tap(find.text('Trendlix People 0.6.19 · build 1019'));
    await tester.pumpAndSettle();
    expect(find.byType(AboutScreen), findsOneWidget);
  });

  test('an employee’s: no People part, no server address, the phone’s clock still there', () {
    final d = Diagnostics(appVersion: '0.6.20', serverAddress: 'srv.example.test', reachedIn: const Duration(milliseconds: 80), clockAhead: Duration.zero, at: DateTime.utc(2026, 10, 31));
    expect(diagnosticSections(d).map((s) => s.title), isNot(contains(AboutWords.server)));
    final text = diagnosticsText(d);
    expect(text, isNot(contains('srv.example.test')));
    expect(text, contains('\nThis phone\nModel: ${AboutWords.notKnown}\nSystem: ${AboutWords.notKnown}\nPhone clock: In step with People\n'));
  });

  testWidgets('an employee’s About: the app, the phone and the account, no server', (tester) async {
    people.on('GET /api/version', (req) => json({'commit': 'd349027', 'committed': null, 'now': DateTime.now().toUtc().toIso8601String()}));
    await openMenu(tester);
    await tester.tap(find.text(AboutWords.menu));
    await tester.pumpAndSettle();
    expect(find.text(AboutWords.server), findsNothing);
    expect(find.text(AboutWords.address), findsNothing);
    expect(find.textContaining('people.example.test'), findsNothing);
    expect(find.textContaining('srv2055591'), findsNothing);
    expect(find.text('In step with People'), findsOneWidget);
  });

  testWidgets('a Super Admin’s About: the app, People, the phone and the account, and Copy details', (tester) async {
    people.on('GET /api/auth/me', (req) => json({...meJson(), 'roles': ['super_admin']}));
    final serverNow = DateTime.now().toUtc().subtract(const Duration(minutes: 2, seconds: 30));
    people.on('GET /api/version', (req) => json({'commit': 'd349027', 'committed': '2026-10-31T18:36:03+02:00', 'now': serverNow.toIso8601String()}));
    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') copied = (call.arguments as Map)['text'] as String?;
      return null;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));

    await openMenu(tester);
    await tester.tap(find.text(AboutWords.menu));
    await tester.pumpAndSettle();
    expect(find.text('0.6.19'), findsOneWidget);
    expect(find.text('1019'), findsOneWidget);
    expect(find.text('5dbf028'), findsOneWidget);
    expect(find.text(AboutWords.upToDate), findsOneWidget);
    expect(find.textContaining('Yes, in '), findsOneWidget);
    expect(find.text('d349027 · 2026-10-31T18:36:03+02:00'), findsOneWidget);
    expect(find.textContaining(RegExp(r'^2 min \d+ s ahead of People$')), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Android 15 (SDK 35)'), 200, scrollable: page());
    expect(find.text('Google Pixel 8'), findsOneWidget);
    expect(find.text(AboutWords.locationOn), findsOneWidget);
    expect(find.text(AboutWords.fingerprintNone), findsOneWidget);
    await tester.scrollUntilVisible(find.text(AboutWords.copy), 200, scrollable: page());
    expect(find.text('h.test@example.test'), findsWidgets);
    await tester.tap(find.text(AboutWords.copy));
    await tester.pumpAndSettle();
    expect(find.text(AboutWords.copied), findsOneWidget);
    expect(copied, contains('Version: 0.6.19\nBuild: 1019\nCommit: 5dbf028\n'));
    expect(copied, contains('Model: Google Pixel 8\nSystem: Android 15 (SDK 35)\n'));
  });

  testWidgets('People not answering: what isn’t known says so, the rest still shown', (tester) async {
    await openMenu(tester);
    await tester.tap(find.text(AboutWords.menu));
    await tester.pumpAndSettle();
    expect(find.text(AboutWords.unreachable), findsNothing);
    expect(find.text(AboutWords.notKnown), findsWidgets);
    await tester.scrollUntilVisible(find.text('Google Pixel 8'), 200, scrollable: page());
  });
}
