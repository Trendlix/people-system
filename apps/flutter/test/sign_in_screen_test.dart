import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/today/check_in_words.dart';
import 'package:people/shell/shell_words.dart';
import 'package:people/features/sign_in/email_code.dart';
import 'package:people/features/sign_in/forgot_password.dart';
import 'package:people/features/sign_in/sign_in_screen.dart';
import 'package:people/providers.dart';

import 'fakes.dart';

// The sign-in screen (README Phase 1): the password, People's refusal in its words; the fingerprint when the phone has
// it, asked for at once.

Future<void> open(WidgetTester tester, FakePeople people, MemorySessionStore store, {FakeBiometrics? biometrics}) async {
  phoneScreen(tester);
  await tester.pumpWidget(
    ProviderScope(
      retry: noRetry,
      overrides: overridesFor(people, store: store, biometrics: biometrics),
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
    expect(find.text(CheckInWords.checkInForWork), findsOneWidget);
  });

  // owner, 31 October 2026: "add forget password to the app"
  testWidgets('sends a link to set a new password, with the email typed, and says People’s answer', (tester) async {
    const answer = 'If that email has an account, a link to set a new password is on its way. It works for 7 days.';
    people.on('POST /api/auth/forgot-password', (req) => json({'message': answer}));
    await open(tester, people, MemorySessionStore());
    await tester.enterText(find.widgetWithText(TextField, SignInWords.email), 'h.test@example.test');
    await tester.tap(find.text(ForgotWords.link));
    await tester.pumpAndSettle();
    expect(find.text(ForgotWords.intro), findsOneWidget);
    final sheetField = find.descendant(of: find.byType(ForgotPasswordForm), matching: find.byType(TextField));
    expect(tester.widget<TextField>(sheetField).controller?.text, 'h.test@example.test');
    await tester.tap(find.text(ForgotWords.send));
    await tester.pumpAndSettle();
    expect(people.bodyOf('POST /api/auth/forgot-password'), {'email': 'h.test@example.test'});
    expect(find.text(answer), findsOneWidget);
    expect(find.text(ForgotWords.spam), findsOneWidget);
    await tester.tap(find.text(ForgotWords.done));
    await tester.pumpAndSettle();
    expect(find.text(SignInWords.signIn), findsOneWidget);
  });

  testWidgets('asks for the email, and says People’s refusal in its words', (tester) async {
    people.on('POST /api/auth/forgot-password', (req) => json({'message': 'Too many tries. Please try again in an hour.'}, 429));
    await open(tester, people, MemorySessionStore());
    await tester.tap(find.text(ForgotWords.link));
    await tester.pumpAndSettle();
    await tester.tap(find.text(ForgotWords.send));
    await tester.pump();
    expect(find.text(ForgotWords.needEmail), findsOneWidget);
    await tester.enterText(find.descendant(of: find.byType(ForgotPasswordForm), matching: find.byType(TextField)), 'h.test@example.test');
    await tester.tap(find.text(ForgotWords.send));
    await tester.pumpAndSettle();
    expect(find.text('Too many tries. Please try again in an hour.'), findsOneWidget);
    expect(find.text(ForgotWords.send), findsOneWidget);
  });

  // owner, 31 October 2026: "and i can add OTP via Mail for app login if the user didn't remember his password"
  testWidgets('signs in with a code by email, as with the password, and offers the fingerprint after it', (tester) async {
    const answer = 'If that email has an account, we sent it a 6-digit code. It works for 10 minutes.';
    people
      ..on('POST /api/auth/email-code', (req) => json({'message': answer}))
      ..on('POST /api/auth/email-code/sign-in', (req) => signedIn('by-code', {'id': 'u1'}));
    await open(tester, people, MemorySessionStore(), biometrics: FakeBiometrics());
    await tester.enterText(find.widgetWithText(TextField, SignInWords.email), 'h.test@example.test');
    await tester.tap(find.text(EmailCodeWords.link));
    await tester.pumpAndSettle();
    expect(find.text(EmailCodeWords.intro), findsOneWidget);
    await tester.tap(find.text(EmailCodeWords.send));
    await tester.pumpAndSettle();
    expect(people.bodyOf('POST /api/auth/email-code'), {'email': 'h.test@example.test'});
    expect(find.text(answer), findsOneWidget);
    expect(find.text(EmailCodeWords.sentTo('h.test@example.test')), findsOneWidget);
    // a new code only a minute on
    expect(tester.widget<OutlinedButton>(find.widgetWithText(OutlinedButton, EmailCodeWords.resend(60))).onPressed, isNull);
    // Arabic digits and a space, as a phone may type them
    await tester.enterText(find.descendant(of: find.byType(EmailCodeForm), matching: find.byType(TextField)), '٤٨٢ ٩١٣');
    await tester.tap(find.descendant(of: find.byType(EmailCodeForm), matching: find.text(EmailCodeWords.signIn)));
    await tester.pumpAndSettle();
    expect(people.bodyOf('POST /api/auth/email-code/sign-in'), {'email': 'h.test@example.test', 'code': '482913'});
    expect(find.byType(EmailCodeForm), findsNothing);
    expect(find.text(ShellWords.offerTitle), findsOneWidget);
  });

  testWidgets('says People’s refusal of a code in its words, and asks for 6 digits', (tester) async {
    const refused = 'That code isn’t right, or it has expired. Check the email, or ask for a new code.';
    people
      ..on('POST /api/auth/email-code', (req) => json({'message': 'sent'}))
      ..on('POST /api/auth/email-code/sign-in', (req) => json({'message': refused}, 401));
    await open(tester, people, MemorySessionStore());
    await tester.tap(find.text(EmailCodeWords.link));
    await tester.pumpAndSettle();
    await tester.tap(find.text(EmailCodeWords.send));
    await tester.pump();
    expect(find.text(EmailCodeWords.needEmail), findsOneWidget);
    await tester.enterText(find.descendant(of: find.byType(EmailCodeForm), matching: find.byType(TextField)), 'h.test@example.test');
    await tester.tap(find.text(EmailCodeWords.send));
    await tester.pumpAndSettle();
    final codeField = find.descendant(of: find.byType(EmailCodeForm), matching: find.byType(TextField));
    await tester.enterText(codeField, '48291');
    await tester.tap(find.descendant(of: find.byType(EmailCodeForm), matching: find.text(EmailCodeWords.signIn)));
    await tester.pump();
    expect(find.text(EmailCodeWords.needCode), findsOneWidget);
    await tester.enterText(codeField, '482913');
    await tester.tap(find.descendant(of: find.byType(EmailCodeForm), matching: find.text(EmailCodeWords.signIn)));
    await tester.pumpAndSettle();
    expect(find.text(refused), findsOneWidget);
    expect(find.byType(EmailCodeForm), findsOneWidget);
    // another email: back to the first step
    await tester.tap(find.text(EmailCodeWords.otherEmail));
    await tester.pumpAndSettle();
    expect(find.text(EmailCodeWords.send), findsOneWidget);
  });

  test('reads a code as typed, and counts a minute to a new one', () {
    expect(codeOf('482913'), '482913');
    expect(codeOf(' 482 913'), '482913');
    expect(codeOf('٤٨٢٩١٣'), '482913');
    expect(codeOf('۴۸۲-۹۱۳'), '482913');
    expect(codeOf('48291'), isNull);
    expect(codeOf('48a913'), isNull);
    final sent = DateTime(2026, 10, 31, 16);
    expect(resendIn(sent, sent), 60);
    expect(resendIn(sent, sent.add(const Duration(milliseconds: 18200))), 42);
    expect(resendIn(sent, sent.add(const Duration(minutes: 1))), 0);
    expect(resendIn(null, sent), 0);
    expect(EmailCodeWords.resend(42), 'Send a new code in 0:42');
    expect(EmailCodeWords.resend(0), 'Send a new code');
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
    expect(find.text(ShellWords.offerTitle), findsOneWidget);
    await tester.tap(find.text(ShellWords.offerYes));
    await tester.pumpAndSettle();
    expect(store.device?.id, 'd1');
    expect(find.text(ShellWords.fingerprintOn), findsOneWidget);

    await tester.tap(find.text(ShellWords.more));
    await tester.pumpAndSettle();
    await tester.tap(find.text(ShellWords.signOut));
    await tester.pumpAndSettle();
    // the sign-in screen asks for the fingerprint by itself, and it signs in
    expect(people.calls, contains('POST /api/auth/devices/sign-in'));
    expect(find.text(CheckInWords.checkInForWork), findsOneWidget);
  });
}
