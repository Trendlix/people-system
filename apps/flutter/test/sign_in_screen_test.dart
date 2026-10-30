import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/home/home_screen.dart';
import 'package:people/features/sign_in/sign_in_screen.dart';
import 'package:people/providers.dart';
import 'package:people/theme/app_theme.dart';

import 'fakes.dart';

// The sign-in screen (README Phase 1): the password, People's refusal in its words; the fingerprint when the phone has
// it, asked for at once.

Future<void> open(WidgetTester tester, FakePeople people, MemorySessionStore store, {FakeBiometrics? biometrics}) async {
  await tester.pumpWidget(
    ProviderScope(
      retry: noRetry,
      overrides: overridesFor(people, store: store, biometrics: biometrics),
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
      ..on('GET /api/me/attendance/today', (req) => json({'next': 'in', 'punches': <Object>[]}));
  });

  testWidgets('asks for both, says People’s refusal, then opens Home', (tester) async {
    await open(tester, people, MemorySessionStore());
    await tester.tap(find.text(SignInWords.signIn));
    await tester.pump();
    expect(find.text(SignInWords.needEmail), findsOneWidget);

    people.on('POST /api/auth/login', (req) => json({'message': 'The email or password is wrong.'}, 401));
    await tester.enterText(find.widgetWithText(TextField, SignInWords.email), 'h.test@example.test');
    await tester.enterText(find.widgetWithText(TextField, SignInWords.password), 'wrong');
    await tester.tap(find.text(SignInWords.signIn));
    await tester.pumpAndSettle();
    expect(find.text('The email or password is wrong.'), findsOneWidget);

    people.on('POST /api/auth/login', (req) => signedIn('fresh', {'id': 'u1'}));
    await tester.tap(find.text(SignInWords.signIn));
    await tester.pumpAndSettle();
    expect(find.text(HomeWords.checkIn), findsOneWidget);
  });

  testWidgets('offers the fingerprint after the password, and asks for it at once next time', (tester) async {
    final store = MemorySessionStore();
    final biometrics = FakeBiometrics();
    people
      ..on('POST /api/auth/login', (req) => signedIn('fresh', {'id': 'u1'}))
      ..on('POST /api/auth/devices', (req) => json({'id': 'd1', 'secret': 'very-secret'}, 201))
      ..on('POST /api/auth/devices/sign-in', (req) => signedIn('by-finger', {'id': 'u1'}))
      ..on('POST /api/auth/logout', (req) => json({}, 204));
    await open(tester, people, store, biometrics: biometrics);
    await tester.enterText(find.widgetWithText(TextField, SignInWords.email), 'h.test@example.test');
    await tester.enterText(find.widgetWithText(TextField, SignInWords.password), 'secret');
    await tester.tap(find.text(SignInWords.signIn));
    await tester.pumpAndSettle();
    expect(find.text(HomeWords.offerTitle), findsOneWidget);
    await tester.tap(find.text(HomeWords.offerYes));
    await tester.pumpAndSettle();
    expect(store.device?.id, 'd1');
    expect(find.text(HomeWords.fingerprintOn), findsOneWidget);

    await tester.tap(find.byIcon(Icons.more_vert_rounded));
    await tester.pumpAndSettle();
    await tester.tap(find.text(HomeWords.signOut));
    await tester.pumpAndSettle();
    // the sign-in screen asks for the fingerprint by itself, and it signs in
    expect(people.calls, contains('POST /api/auth/devices/sign-in'));
    expect(find.text(HomeWords.checkIn), findsOneWidget);
  });
}
