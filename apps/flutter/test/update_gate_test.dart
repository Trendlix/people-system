import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/config.dart';
import 'package:people/features/sign_in/sign_in_screen.dart';
import 'package:people/features/today/check_in_words.dart';
import 'package:people/platform/update_gate.dart';
import 'package:people/providers.dart';

import 'fakes.dart';

// Always the newest build (owner, 31 October 2026: "in the next build i would prefare to apply the force update rule";
// "Always the latest build", "A fixed People link").

const download = 'https://people.trendlix.com/download';

void main() {
  late FakePeople people;
  late List<Uri> opened;
  late bool opens;

  setUp(() {
    opened = [];
    opens = true;
    people = FakePeople()
      ..on('GET /api/auth/me', (req) => json(meJson()))
      ..on('GET /api/me/attendance/today', (req) => json({'next': 'in', 'punches': <Object>[]}));
  });

  Future<void> open(WidgetTester tester, {String version = '0.6.14', String? token = 'kept', Widget? app}) async {
    phoneScreen(tester);
    await tester.pumpWidget(
      ProviderScope(
        retry: noRetry,
        overrides: [
          ...overridesFor(people, store: MemorySessionStore(token: token)),
          configProvider.overrideWithValue(AppConfig.parse(apiUrl: '', caBase64: '', version: version)),
          linkOpenerProvider.overrideWithValue((uri) async {
            opened.add(uri);
            return opens;
          }),
        ],
        child: app ?? const PeopleApp(),
      ),
    );
    await tester.pumpAndSettle();
  }

  void latest(String version) => people.on('GET /api/app/latest', (req) => json({'version': version, 'publishedAt': null, 'downloadUrl': download}));

  test('compares versions part by part', () {
    expect(isOlderVersion('0.6.14', '0.6.15'), isTrue);
    expect(isOlderVersion('0.6.9', '0.6.15'), isTrue);
    expect(isOlderVersion('0.6.15', '0.7.16'), isTrue);
    expect(isOlderVersion('0.6.15', '0.6.15'), isFalse);
    expect(isOlderVersion('0.6.16', '0.6.15'), isFalse);
    expect(isOlderVersion('0.6', '0.6.1'), isTrue);
    expect(isOlderVersion('0.6.x', '0.6.15'), isFalse);
  });

  testWidgets('an older build: only Update required, and the button opens People’s download link', (tester) async {
    latest('0.6.15');
    await open(tester);
    expect(find.text(UpdateWords.title), findsOneWidget);
    expect(find.text(UpdateWords.intro('0.6.15', '0.6.14')), findsOneWidget);
    expect(find.text(CheckInWords.checkInForWork), findsNothing);
    await tester.tap(find.text(UpdateWords.download));
    await tester.pumpAndSettle();
    expect(opened, [Uri.parse(download)]);
  });

  testWidgets('signed out too', (tester) async {
    latest('0.6.15');
    await open(tester, token: null);
    expect(find.text(UpdateWords.title), findsOneWidget);
    expect(find.text(SignInWords.subtitle), findsNothing);
  });

  testWidgets('the browser not opening says where to go', (tester) async {
    latest('0.6.15');
    opens = false;
    await open(tester);
    await tester.tap(find.text(UpdateWords.download));
    await tester.pumpAndSettle();
    expect(find.text(UpdateWords.cantOpen(download)), findsOneWidget);
  });

  testWidgets('the newest build: the app as usual', (tester) async {
    latest('0.6.14');
    await open(tester);
    expect(find.text(UpdateWords.title), findsNothing);
    expect(find.text(CheckInWords.checkInForWork), findsOneWidget);
  });

  testWidgets('People can’t tell (no version, or no answer): never in the way', (tester) async {
    people.on('GET /api/app/latest', (req) => json({'version': null, 'publishedAt': null, 'downloadUrl': download}));
    await open(tester);
    expect(find.text(CheckInWords.checkInForWork), findsOneWidget);
    people.routes.remove('GET /api/app/latest');
    await open(tester);
    expect(find.text(UpdateWords.title), findsNothing);
    expect(find.text(CheckInWords.checkInForWork), findsOneWidget);
  });

  testWidgets('a build without a version (a developer’s) never asks', (tester) async {
    latest('0.6.15');
    await open(tester, version: '0.0.0');
    expect(people.calls, isNot(contains('GET /api/app/latest')));
    expect(find.text(UpdateWords.title), findsNothing);
  });

  testWidgets('coming back asks again: a build published meanwhile holds the app', (tester) async {
    latest('0.6.14');
    await open(tester, app: const MaterialApp(home: UpdateGate(askEvery: Duration.zero, child: Text('the app'))));
    expect(find.text('the app'), findsOneWidget);
    latest('0.6.15');
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(find.text(UpdateWords.title), findsOneWidget);
    expect(people.calls.where((c) => c == 'GET /api/app/latest'), hasLength(2));
  });
}
