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

/// The phone's fingerprint (or face), behind which the app keeps its sign-in credential (README Phase 1).
abstract interface class Biometrics {
  /// Whether the phone has a fingerprint (or face) set up the app can ask for.
  Future<bool> available();

  /// Asks for it, saying why.
  Future<FingerprintOutcome> confirm(String reason);
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
