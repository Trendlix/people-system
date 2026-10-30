import 'package:flutter_test/flutter_test.dart';
import 'package:people/api/people_client.dart';
import 'package:people/auth/auth_controller.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/platform/biometrics.dart';
import 'package:people/providers.dart';

import 'fakes.dart';

// Signing in (README Phase 1): the password once, then the fingerprint; the session kept in secure storage, sent as a
// bearer, dropped when People refuses it.

void main() {
  late FakePeople people;

  setUp(() {
    people = FakePeople()..on('GET /api/auth/me', (req) => json(meJson()));
  });

  test('starts signed out without a session, offering the fingerprint only with a credential and a sensor', () async {
    expect(await containerFor(people, store: MemorySessionStore()).read(authProvider.future), isA<SignedOut>().having((s) => s.fingerprint, 'fingerprint', false));
    final withDevice = MemorySessionStore(device: (id: 'd1', secret: 's', userId: 'u1'));
    expect(
      await containerFor(people, store: withDevice, biometrics: FakeBiometrics()).read(authProvider.future),
      isA<SignedOut>().having((s) => s.fingerprint, 'fingerprint', true),
    );
    expect(
      await containerFor(people, store: withDevice, biometrics: FakeBiometrics(has: false)).read(authProvider.future),
      isA<SignedOut>().having((s) => s.fingerprint, 'fingerprint', false),
    );
  });

  test('keeps the session from last time while People has it, and drops it when People refuses it', () async {
    final store = MemorySessionStore(token: 'kept');
    final me = await containerFor(people, store: store).read(authProvider.future);
    expect(me, isA<SignedIn>().having((s) => s.me.firstName, 'first name', 'Hazem'));
    expect(people.sent.single.headers['authorization'], 'Bearer kept');

    people.on('GET /api/auth/me', (req) => json({'message': 'Your session has ended.'}, 401));
    expect(await containerFor(people, store: store).read(authProvider.future), isA<SignedOut>());
    expect(store.token, isNull);
  });

  test('says People can’t be reached, keeping the session to try again', () async {
    final store = MemorySessionStore(token: 'kept');
    people.on('GET /api/auth/me', (req) => throw const SocketLike());
    final c = containerFor(people, store: store);
    await expectLater(c.read(authProvider.future), throwsA(isA<ApiException>().having((e) => e.unreachable, 'unreachable', true)));
    expect(store.token, 'kept');
  });

  test('signs in with the password: the session from the cookie, the fingerprint offered once', () async {
    final store = MemorySessionStore();
    people.on('POST /api/auth/login', (req) => signedIn('fresh-token', {'id': 'u1'}));
    final c = containerFor(people, store: store, biometrics: FakeBiometrics());
    await c.read(authProvider.future);
    await c.read(authProvider.notifier).signInWithPassword('  h.test@example.test ', 'secret');
    expect(people.bodyOf('POST /api/auth/login'), {'email': 'h.test@example.test', 'password': 'secret'});
    expect(store.token, 'fresh-token');
    expect(people.sent.firstWhere((r) => r.url.path == '/api/auth/login').headers.containsKey('authorization'), isFalse);
    expect(people.sent.last.headers['authorization'], 'Bearer fresh-token');
    expect(c.read(authProvider).value, isA<SignedIn>().having((s) => s.offerFingerprint, 'offer', true));
    c.read(authProvider.notifier).fingerprintOffered();
    expect(c.read(authProvider).value, isA<SignedIn>().having((s) => s.offerFingerprint, 'offer', false));
  });

  test('says People’s refusal of a password in its words', () async {
    people.on('POST /api/auth/login', (req) => json({'message': 'The email or password is wrong.'}, 401));
    final c = containerFor(people, store: MemorySessionStore());
    await c.read(authProvider.future);
    await expectLater(
      c.read(authProvider.notifier).signInWithPassword('h.test@example.test', 'wrong'),
      throwsA(isA<ApiException>().having((e) => e.message, 'message', 'The email or password is wrong.')),
    );
    expect(c.read(authProvider).value, isA<SignedOut>());
  });

  test('turns the fingerprint on after it confirms: the phone named, the credential kept with whose it is', () async {
    final store = MemorySessionStore();
    final biometrics = FakeBiometrics();
    people
      ..on('POST /api/auth/login', (req) => signedIn('t', {'id': 'u1'}))
      ..on('POST /api/auth/devices', (req) => json({'id': 'd1', 'secret': 'very-secret'}, 201));
    final c = containerFor(people, store: store, biometrics: biometrics);
    await c.read(authProvider.future);
    await c.read(authProvider.notifier).signInWithPassword('h.test@example.test', 'secret');

    biometrics.outcome = FingerprintOutcome.cancelled;
    expect(await c.read(authProvider.notifier).turnOnFingerprint(), isFalse);
    expect(people.calls, isNot(contains('POST /api/auth/devices')));

    biometrics.outcome = FingerprintOutcome.confirmed;
    expect(await c.read(authProvider.notifier).turnOnFingerprint(), isTrue);
    expect(people.bodyOf('POST /api/auth/devices'), {'deviceName': 'Google Pixel 8', 'platform': 'android'});
    expect(store.device, (id: 'd1', secret: 'very-secret', userId: 'u1'));

    biometrics.outcome = FingerprintOutcome.lockedOut;
    await expectLater(c.read(authProvider.notifier).turnOnFingerprint(), throwsA(isA<FingerprintProblem>()));
  });

  test('signs in with the fingerprint; a credential People no longer knows is dropped, with its reason', () async {
    final store = MemorySessionStore(device: (id: 'd1', secret: 'very-secret', userId: 'u1'));
    final biometrics = FakeBiometrics(outcome: FingerprintOutcome.cancelled);
    people.on('POST /api/auth/devices/sign-in', (req) => signedIn('by-finger', {'id': 'u1'}));
    final c = containerFor(people, store: store, biometrics: biometrics);
    await c.read(authProvider.future);

    await c.read(authProvider.notifier).signInWithFingerprint();
    expect(people.calls, isNot(contains('POST /api/auth/devices/sign-in')));
    expect(c.read(authProvider).value, isA<SignedOut>());

    biometrics.outcome = FingerprintOutcome.confirmed;
    await c.read(authProvider.notifier).signInWithFingerprint();
    expect(people.bodyOf('POST /api/auth/devices/sign-in'), {'id': 'd1', 'secret': 'very-secret'});
    expect(store.token, 'by-finger');
    expect(c.read(authProvider).value, isA<SignedIn>().having((s) => s.offerFingerprint, 'offer', false));

    await c.read(authProvider.notifier).signOut();
    expect(people.calls.last, 'POST /api/auth/logout');
    expect(store.token, isNull);
    expect(store.device, isNotNull);
    expect(c.read(authProvider).value, isA<SignedOut>().having((s) => s.fingerprint, 'fingerprint', true));

    people.on('POST /api/auth/devices/sign-in', (req) => json({'message': 'This phone does not sign in with a fingerprint any more.'}, 401));
    await c.read(authProvider.notifier).signInWithFingerprint();
    expect(store.device, isNull);
    expect(
      c.read(authProvider).value,
      isA<SignedOut>().having((s) => s.fingerprint, 'fingerprint', false).having((s) => s.notice, 'notice', 'This phone does not sign in with a fingerprint any more.'),
    );
  });

  test('never offers someone else’s credential: a password sign-in by another person drops it', () async {
    final store = MemorySessionStore(device: (id: 'd1', secret: 's', userId: 'someone-else'));
    people.on('POST /api/auth/login', (req) => signedIn('t', {'id': 'u1'}));
    final c = containerFor(people, store: store, biometrics: FakeBiometrics());
    await c.read(authProvider.future);
    await c.read(authProvider.notifier).signInWithPassword('h.test@example.test', 'secret');
    expect(store.device, isNull);
    expect(c.read(authProvider).value, isA<SignedIn>().having((s) => s.offerFingerprint, 'offer', true));
  });

  test('signs out when People refuses the session later, saying why', () async {
    final store = MemorySessionStore(token: 'kept');
    final c = containerFor(people, store: store);
    await c.read(authProvider.future);
    people.on('GET /api/me/attendance/today', (req) => json({'message': 'Your session has ended.'}, 401));
    await expectLater(c.read(peopleClientProvider).get('/api/me/attendance/today'), throwsA(isA<ApiException>()));
    await pumpEventQueue();
    expect(store.token, isNull);
    expect(c.read(authProvider).value, isA<SignedOut>().having((s) => s.notice, 'notice', AuthWords.sessionEnded));
  });
}

/// A network failure, as the http client throws it.
class SocketLike implements Exception {
  const SocketLike();
}
