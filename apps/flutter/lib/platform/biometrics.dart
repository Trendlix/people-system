import 'package:flutter/foundation.dart' show TargetPlatform, defaultTargetPlatform;
import 'package:local_auth/local_auth.dart';

/// How asking for the fingerprint ended.
enum FingerprintOutcome {
  confirmed,

  /// They closed it, or the phone did (another app, the screen off): nothing to say.
  cancelled,

  /// Too many tries: the phone wants its own unlock first.
  lockedOut,

  /// No fingerprint set up, no sensor, or it failed: the password still works.
  unavailable,
}

/// What the phone calls the way it knows its owner, as the app names it (owner, 8 November 2026: on iPhones "it gets a
/// message sign in with fingerprint, and most people got confused as there is no fingerprints"): Face ID or Touch ID on
/// an iPhone or iPad, as iOS itself says, and the fingerprint on Android as before.
enum UnlockKind {
  fingerprint,
  faceId,
  touchId;

  /// Before the phone is asked: what this platform mostly has (most iPhones since 2017 have Face ID).
  static UnlockKind get usual => defaultTargetPlatform == TargetPlatform.iOS ? faceId : fingerprint;
}

/// The phone's fingerprint (or face), behind which the app keeps its sign-in credential (README Phase 1).
abstract interface class Biometrics {
  /// Whether the phone has a fingerprint (or face) set up the app can ask for.
  Future<bool> available();

  /// Asks for it, saying why.
  Future<FingerprintOutcome> confirm(String reason);

  /// What this phone has, to name it in the app's words.
  Future<UnlockKind> kind();
}

class DeviceBiometrics implements Biometrics {
  DeviceBiometrics([LocalAuthentication? auth]) : _auth = auth ?? LocalAuthentication();

  final LocalAuthentication _auth;

  @override
  Future<bool> available() async {
    try {
      return await _auth.isDeviceSupported() && (await _auth.getAvailableBiometrics()).isNotEmpty;
    } on Exception {
      return false;
    }
  }

  @override
  Future<UnlockKind> kind() async {
    if (defaultTargetPlatform != TargetPlatform.iOS) return UnlockKind.fingerprint;
    try {
      // an iPhone or iPad with only a finger set up has Touch ID; a face, or nothing set up yet, says Face ID
      final types = await _auth.getAvailableBiometrics();
      if (types.contains(BiometricType.fingerprint) && !types.contains(BiometricType.face)) return UnlockKind.touchId;
    } on Exception {
      // as most iPhones
    }
    return UnlockKind.faceId;
  }

  @override
  Future<FingerprintOutcome> confirm(String reason) async {
    try {
      // the fingerprint or face only, never the phone's PIN: the credential is for the person, not whoever has the phone
      final ok = await _auth.authenticate(localizedReason: reason, biometricOnly: true, persistAcrossBackgrounding: true);
      return ok ? FingerprintOutcome.confirmed : FingerprintOutcome.cancelled;
    } on LocalAuthException catch (e) {
      return switch (e.code) {
        LocalAuthExceptionCode.userCanceled ||
        LocalAuthExceptionCode.timeout ||
        LocalAuthExceptionCode.systemCanceled ||
        LocalAuthExceptionCode.userRequestedFallback ||
        LocalAuthExceptionCode.authInProgress => FingerprintOutcome.cancelled,
        LocalAuthExceptionCode.temporaryLockout || LocalAuthExceptionCode.biometricLockout => FingerprintOutcome.lockedOut,
        _ => FingerprintOutcome.unavailable,
      };
    } on Exception {
      return FingerprintOutcome.unavailable;
    }
  }
}
