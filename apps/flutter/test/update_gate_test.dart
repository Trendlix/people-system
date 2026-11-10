import 'package:flutter/foundation.dart' show TargetPlatform, debugDefaultTargetPlatformOverride;
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
const appStore = 'https://apps.apple.com/eg/app/trendlix-people/id6831911915';

/// Google Play as each test sets it: whether it has a newer version, whether its update runs.
class FakePlay implements PlayUpdates {
  bool has = false;
  bool runs = true;
  var asked = 0;
  var updates = 0;

  @override
  Future<bool> available() async {
    asked++;
    return has;
  }

  @override
  Future<bool> update() async {
    updates++;
    return runs;
  }
}

void main() {
  late FakePeople people;
  late List<Uri> opened;
  late bool opens;
  late FakeLocator locator;
  late FakePlay play;

  setUp(() {
    play = FakePlay();
    opened = [];
    opens = true;
    locator = FakeLocator();
    people = FakePeople()
      ..on('GET /api/auth/me', (req) => json(meJson()))
      ..on('GET /api/me/attendance/today', (req) => json({'next': 'in', 'punches': <Object>[]}));
  });

  Future<void> open(WidgetTester tester, {String version = '0.6.14', String? token = 'kept', Widget? app, String store = ''}) async {
    phoneScreen(tester);
    await tester.pumpWidget(
      ProviderScope(
        // a new app each time (the same scope would be kept, and the gate's answer with it)
        key: UniqueKey(),
        retry: noRetry,
        overrides: [
          ...overridesFor(people, store: MemorySessionStore(token: token), locator: locator),
          configProvider.overrideWithValue(AppConfig.parse(apiUrl: '', caBase64: '', version: version, store: store)),
          playUpdateProvider.overrideWithValue(play),
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

  void latest(String version, {bool removeOldFirst = true}) =>
      people.on('GET /api/app/latest', (req) => json({'version': version, 'publishedAt': null, 'downloadUrl': download, 'removeOldFirst': removeOldFirst}));

  test('compares versions part by part', () {
    expect(isOlderVersion('0.6.14', '0.6.15'), isTrue);
    expect(isOlderVersion('0.6.9', '0.6.15'), isTrue);
    expect(isOlderVersion('0.6.15', '0.7.16'), isTrue);
    expect(isOlderVersion('0.6.15', '0.6.15'), isFalse);
    expect(isOlderVersion('0.6.16', '0.6.15'), isFalse);
    expect(isOlderVersion('0.6', '0.6.1'), isTrue);
    expect(isOlderVersion('0.6.x', '0.6.15'), isFalse);
  });

  // a Play build (owner, 6 November 2026: "now i have google play console"; "Play only"): Play updates it
  testWidgets('a Play build asks Google Play, never People; nothing newer there, the app as usual', (tester) async {
    latest('0.6.15');
    await open(tester, store: 'play');
    expect(play.asked, 1);
    expect(find.text(UpdateWords.title), findsNothing);
    expect(opened, isEmpty);
    expect(people.calls, isNot(contains('GET /api/app/latest')));
  });

  // owner, 10 November 2026: "when pushing make the update force to all builds, as some all builds dont make force update"
  testWidgets('a Play build with a newer version on Play: Update required in place of the app, Play’s update run once', (tester) async {
    play.has = true;
    // backed out of Play's update: still held
    play.runs = false;
    await open(tester, store: 'play');
    expect(find.text(UpdateWords.title), findsOneWidget);
    expect(find.text(UpdateWords.onPlay), findsOneWidget);
    expect(find.text(CheckInWords.checkInForWork), findsNothing);
    expect(play.updates, 1);
    // Play's update not allowed here: its Play page instead
    expect(opened, [playPage]);
    await tester.tap(find.text(UpdateWords.updatePlay));
    await tester.pumpAndSettle();
    expect(play.updates, 2);
    expect(opened, [playPage, playPage]);
  });

  testWidgets('an iPhone older than the App Store’s version: Update required with the way to the App Store', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    try {
      people.on('GET /api/app/ios-latest', (req) => json({'version': '0.6.60', 'storeUrl': appStore}));
      await open(tester, version: '0.6.48');
      expect(find.text(UpdateWords.onAppStore('0.6.60', '0.6.48')), findsOneWidget);
      expect(find.text(CheckInWords.checkInForWork), findsNothing);
      expect(people.calls, isNot(contains('GET /api/app/latest')));
      await tester.tap(find.text(UpdateWords.updateAppStore));
      await tester.pumpAndSettle();
      expect(opened, [Uri.parse(appStore)]);
      // a TestFlight build newer than the store's, or the store's own: the app as usual
      await open(tester, version: '0.6.61');
      expect(find.text(UpdateWords.title), findsNothing);
      // not in the store yet: never in the way
      people.on('GET /api/app/ios-latest', (req) => json({'version': null, 'storeUrl': appStore}));
      await open(tester, version: '0.6.48');
      expect(find.text(UpdateWords.title), findsNothing);
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });

  test('a build is a Play one only when built so', () {
    expect(AppConfig.parse(apiUrl: '', caBase64: '', version: '1.0.1', store: 'play').playStore, isTrue);
    expect(AppConfig.parse(apiUrl: '', caBase64: '', version: '1.0.1').playStore, isFalse);
  });

  testWidgets('an older build: only Update required, the download opened by itself once, and again from the button', (tester) async {
    latest('0.6.15');
    await open(tester);
    expect(find.text(UpdateWords.title), findsOneWidget);
    expect(find.text(UpdateWords.versions('0.6.15', '0.6.14')), findsOneWidget);
    expect(find.text(CheckInWords.checkInForWork), findsNothing);
    expect(opened, [Uri.parse(download)]);
    await tester.tap(find.text(UpdateWords.download));
    await tester.pumpAndSettle();
    expect(opened, [Uri.parse(download), Uri.parse(download)]);
  });

  testWidgets('until the stores: remove this version first, its App info a tap away', (tester) async {
    latest('0.6.15');
    await open(tester);
    expect(find.text(UpdateWords.stepRemove), findsOneWidget);
    expect(find.text(UpdateWords.stepInstallAfterRemoving), findsOneWidget);
    await tester.ensureVisible(find.text(UpdateWords.remove));
    await tester.tap(find.text(UpdateWords.remove));
    await tester.pumpAndSettle();
    expect(locator.openedApp, 1);
  });

  testWidgets('once in the stores (removeOldFirst off): download and install, nothing to remove', (tester) async {
    latest('0.6.15', removeOldFirst: false);
    await open(tester);
    expect(find.text(UpdateWords.stepInstall), findsOneWidget);
    expect(find.text(UpdateWords.stepRemove), findsNothing);
    expect(find.text(UpdateWords.remove), findsNothing);
  });

  testWidgets('signed out too', (tester) async {
    latest('0.6.15');
    await open(tester, token: null);
    expect(find.text(UpdateWords.title), findsOneWidget);
    expect(find.text(SignInWords.title), findsNothing);
  });

  testWidgets('the browser not opening says where to go', (tester) async {
    latest('0.6.15');
    opens = false;
    await open(tester);
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
    expect(opened, [Uri.parse(download)]);
  });
}
