import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/app.dart';
import 'package:people/auth/app_lock.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/sign_in/sign_in_screen.dart';
import 'package:people/features/today/check_in_words.dart';
import 'package:people/platform/biometrics.dart';
import 'package:people/providers.dart';

import 'fakes.dart';

// The app behind the fingerprint or face (owner, 31 October 2026: "when the app is closed and reopened, ask for the
// fingerprint or the faceid again, as a security step"): asked as it opens with a session kept, and when it comes back
// after a minute or more away; a quick switch, a phone without either, and a sign-in just made don't ask.

Future<void> open(WidgetTester tester, FakePeople people, FakeBiometrics biometrics, {String? token = 'kept'}) async {
  phoneScreen(tester);
  await tester.pumpWidget(
    ProviderScope(
      retry: noRetry,
      overrides: overridesFor(people, store: MemorySessionStore(token: token), biometrics: biometrics),
      child: const PeopleApp(),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  late FakePeople people;
  var clock = DateTime(2026, 10, 31, 15);

  setUp(() {
    clock = DateTime(2026, 10, 31, 15);
    AppLockController.now = () => clock;
    people = FakePeople()
      ..on('GET /api/auth/me', (req) => json(meJson()))
      ..on('GET /api/me/attendance/today', (req) => json({'next': 'in', 'punches': <Object>[]}))
      ..on('POST /api/auth/logout', (req) => json({}, 204));
  });

  tearDown(() => AppLockController.now = DateTime.now);

  testWidgets('asks for the fingerprint as the app opens with a session kept, and opens once it’s them', (tester) async {
    final biometrics = FakeBiometrics();
    await open(tester, people, biometrics);
    expect(biometrics.asked, [LockWords.reason]);
    expect(find.text(CheckInWords.checkInForWork), findsOneWidget);
    expect(find.text(LockWords.title), findsNothing);
  });

  testWidgets('stays locked when it’s cancelled, the app out of sight; Unlock asks again', (tester) async {
    final biometrics = FakeBiometrics(outcome: FingerprintOutcome.cancelled);
    await open(tester, people, biometrics);
    expect(find.text(LockWords.title), findsOneWidget);
    expect(find.text(CheckInWords.checkInForWork), findsNothing);
    biometrics.outcome = FingerprintOutcome.confirmed;
    await tester.tap(find.text(LockWords.unlock));
    await tester.pumpAndSettle();
    expect(find.text(CheckInWords.checkInForWork), findsOneWidget);
    expect(biometrics.asked, [LockWords.reason, LockWords.reason]);
  });

  testWidgets('locks again after a minute away, not after a quick switch', (tester) async {
    final biometrics = FakeBiometrics();
    await open(tester, people, biometrics);
    biometrics.outcome = FingerprintOutcome.cancelled;
    Future<void> away(Duration d) async {
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      clock = clock.add(d);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
    }

    await away(const Duration(seconds: 30));
    expect(find.text(LockWords.title), findsNothing);
    await away(const Duration(minutes: 2));
    expect(find.text(LockWords.title), findsOneWidget);
  });

  testWidgets('signs out from the lock', (tester) async {
    await open(tester, people, FakeBiometrics(outcome: FingerprintOutcome.cancelled));
    await tester.tap(find.text(LockWords.signOut));
    await tester.pumpAndSettle();
    expect(find.text(SignInWords.subtitle), findsOneWidget);
  });

  testWidgets('says why after too many tries', (tester) async {
    await open(tester, people, FakeBiometrics(outcome: FingerprintOutcome.lockedOut));
    expect(find.text(LockWords.lockedOut), findsOneWidget);
  });

  testWidgets('opens as before on a phone with no fingerprint or face, and right after signing in', (tester) async {
    final none = FakeBiometrics(has: false);
    await open(tester, people, none);
    expect(none.asked, isEmpty);
    expect(find.text(CheckInWords.checkInForWork), findsOneWidget);
  });

  testWidgets('doesn’t ask again right after a password sign-in', (tester) async {
    people.on('POST /api/auth/login', (req) => signedIn('fresh', {'id': 'u1'}));
    final biometrics = FakeBiometrics(outcome: FingerprintOutcome.cancelled);
    await open(tester, people, biometrics, token: null);
    await tester.enterText(find.widgetWithText(TextField, SignInWords.email), 'h.test@example.test');
    await tester.enterText(find.widgetWithText(TextField, SignInWords.password), 'right');
    await tester.tap(find.text(SignInWords.signIn));
    await tester.pumpAndSettle();
    expect(biometrics.asked.where((r) => r == LockWords.reason), isEmpty);
    expect(find.text(LockWords.title), findsNothing);
  });
}
