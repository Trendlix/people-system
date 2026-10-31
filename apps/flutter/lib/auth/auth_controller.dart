import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/people_client.dart';
import '../models/me.dart';
import '../platform/biometrics.dart';
import '../providers.dart';
import 'session_store.dart';
import 'app_lock.dart';

// Signing in (README Phase 1; owner, 30 October 2026: "The 3 easy wins first"): the password once, then the fingerprint
// (People's device credentials, apps/api auth.controller.ts). The session is an app session (the user agent's mark) of
// 8 hours, kept in the phone's secure storage; the fingerprint brings a new one each day in a touch.

/// The words of signing in, in one place (ready for Arabic).
abstract final class AuthWords {
  static const sessionEnded = 'Your session ended. Please sign in again.';
  static const confirmSignIn = 'Sign in to Trendlix People';
  static const confirmTurnOn = 'Confirm it’s you to sign in with your fingerprint next time';
  static const lockedOut = 'Too many tries. Unlock your phone, then try the fingerprint again, or sign in with your password.';
  static const unavailable = 'The fingerprint isn’t available right now. Sign in with your password.';
  static const noCredential = 'People didn’t give this phone a fingerprint sign-in. Please try again.';
}

sealed class AuthState {
  const AuthState();
}

class SignedOut extends AuthState {
  const SignedOut({required this.fingerprint, this.notice});

  /// This phone signs in with a fingerprint: the credential is here and the phone has one set up.
  final bool fingerprint;

  /// Why they are here, when it isn't their own doing (a session ended, the fingerprint turned off on the website).
  final String? notice;
}

class SignedIn extends AuthState {
  const SignedIn(this.me, {this.offerFingerprint = false});

  final Me me;

  /// Just signed in with the password on a phone that could use the fingerprint: Home asks once.
  final bool offerFingerprint;
}

/// A fingerprint that didn't work, in words to show (a cancel says nothing).
class FingerprintProblem implements Exception {
  const FingerprintProblem(this.message);

  final String message;

  @override
  String toString() => 'FingerprintProblem: $message';
}

final biometricsProvider = Provider<Biometrics>((ref) => DeviceBiometrics());

final authProvider = AsyncNotifierProvider<AuthController, AuthState>(AuthController.new);

class AuthController extends AsyncNotifier<AuthState> {
  SessionStore get _store => ref.read(sessionStoreProvider);
  PeopleClient get _client => ref.read(peopleClientProvider);
  Biometrics get _biometrics => ref.read(biometricsProvider);

  /// The session kept from last time, if People still has it; else signed out. Unreachable: the error, with its Try
  /// again, the session kept.
  @override
  Future<AuthState> build() async {
    if (await _store.read() != null) {
      try {
        return SignedIn(await _me());
      } on ApiException catch (e) {
        if (e.status != 401) rethrow;
        await _store.clear();
      }
    }
    return _signedOut();
  }

  Future<Me> _me() async => Me.fromJson(await _client.get('/api/auth/me'));

  Future<SignedOut> _signedOut({String? notice}) async => SignedOut(fingerprint: await _fingerprintReady(), notice: notice);

  Future<bool> _fingerprintReady() async => await _store.readDevice() != null && await _biometrics.available();

  /// The work email and password. People's refusal comes as an ApiException, in its words.
  Future<void> signInWithPassword(String email, String password) =>
      _signedInWith('/api/auth/login', {'email': email.trim(), 'password': password});

  /// The work email and the code People emailed to it (owner, 31 October 2026: "and i can add OTP via Mail for app login
  /// if the user didn't remember his password"): signed in as with the password, the fingerprint offered the same.
  Future<void> signInWithCode(String email, String code) => _signedInWith('/api/auth/email-code/sign-in', {'email': email.trim(), 'code': code});

  Future<void> _signedInWith(String path, Map<String, String> body) async {
    final signed = await _client.signIn(path, body);
    await _store.write(signed.token);
    final me = await _me();
    // someone else's credential on this phone is never theirs to use
    final device = await _store.readDevice();
    if (device != null && device.userId != me.id) await _store.clearDevice();
    final offer = (device == null || device.userId != me.id) && await _biometrics.available();
    // just proved it's them: the app opens unlocked (app_lock.dart)
    ref.read(appLockProvider.notifier).unlock();
    state = AsyncData(SignedIn(me, offerFingerprint: offer));
  }

  /// Home asked (yes or no): not again this session.
  void fingerprintOffered() {
    final s = state.value;
    if (s is SignedIn && s.offerFingerprint) state = AsyncData(SignedIn(s.me));
  }

  /// Turns on fingerprint sign-in for this phone, after the fingerprint confirms it's them. False: they cancelled.
  Future<bool> turnOnFingerprint() async {
    final s = state.value;
    if (s is! SignedIn) return false;
    if (!_check(await _biometrics.confirm(AuthWords.confirmTurnOn))) return false;
    final identity = ref.read(deviceIdentityProvider);
    final body = await _client.post('/api/auth/devices', {'deviceName': await identity.name(), 'platform': identity.platform});
    final id = body is Map ? body['id'] : null;
    final secret = body is Map ? body['secret'] : null;
    if (id is! String || secret is! String || id.isEmpty || secret.isEmpty) throw const FingerprintProblem(AuthWords.noCredential);
    await _store.writeDevice((id: id, secret: secret, userId: s.me.id));
    return true;
  }

  /// Signs in with the phone's credential behind the fingerprint. A cancel does nothing; a credential People no longer
  /// knows (signed out beside the phone on the website, or the password changed) is dropped, with People's reason.
  Future<void> signInWithFingerprint() async {
    final device = await _store.readDevice();
    if (device == null) {
      state = AsyncData(await _signedOut());
      return;
    }
    if (!_check(await _biometrics.confirm(AuthWords.confirmSignIn))) return;
    try {
      final signed = await _client.signIn('/api/auth/devices/sign-in', {'id': device.id, 'secret': device.secret});
      await _store.write(signed.token);
      ref.read(appLockProvider.notifier).unlock();
      state = AsyncData(SignedIn(await _me()));
    } on ApiException catch (e) {
      if (e.status != 401) rethrow;
      await _store.clearDevice();
      state = AsyncData(SignedOut(fingerprint: false, notice: e.message));
    }
  }

  /// True: confirmed. False: cancelled. Else the reason, thrown.
  bool _check(FingerprintOutcome outcome) => switch (outcome) {
    FingerprintOutcome.confirmed => true,
    FingerprintOutcome.cancelled => false,
    FingerprintOutcome.lockedOut => throw const FingerprintProblem(AuthWords.lockedOut),
    FingerprintOutcome.unavailable => throw const FingerprintProblem(AuthWords.unavailable),
  };

  /// Ends the session on People too (whatever it answers, the phone is signed out); the fingerprint stays on.
  Future<void> signOut() async {
    try {
      await _client.post('/api/auth/logout');
    } on ApiException {
      // signed out here all the same
    }
    await _store.clear();
    state = AsyncData(await _signedOut());
  }

  /// People refused the session (401) while signed in: it ended, or was signed out elsewhere.
  Future<void> sessionEnded() async {
    if (state.value is! SignedIn) return;
    await _store.clear();
    state = AsyncData(await _signedOut(notice: AuthWords.sessionEnded));
  }
}
