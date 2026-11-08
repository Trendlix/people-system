import 'package:flutter/material.dart' show IconData, Icons;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../platform/biometrics.dart';
import 'auth_controller.dart' show biometricsProvider;

/// The fingerprint's words, in the phone's own name for it (owner, 8 November 2026: on iPhones "it gets a message sign
/// in with fingerprint, and most people got confused as there is no fingerprints"): "Sign in with Face ID" on an iPhone,
/// "Sign in with Touch ID" on one with a home button and on most iPads, and on Android the same words as before. In one
/// place (ready for Arabic).
class UnlockWords {
  const UnlockWords(this.kind);

  final UnlockKind kind;

  bool get _android => kind == UnlockKind.fingerprint;

  /// Inside a sentence: "fingerprint", "Face ID", "Touch ID".
  String get name => switch (kind) {
    UnlockKind.fingerprint => 'fingerprint',
    UnlockKind.faceId => 'Face ID',
    UnlockKind.touchId => 'Touch ID',
  };

  String get _the => _android ? 'The fingerprint' : name;
  String get _yours => _android ? 'your fingerprint' : name;
  String get _title => _android ? 'Fingerprint' : name;

  IconData get icon => kind == UnlockKind.faceId ? Icons.face_unlock_rounded : Icons.fingerprint_rounded;

  // signing in
  String get signIn => 'Sign in with $name';
  String get confirmTurnOn => 'Confirm it’s you to sign in with $_yours next time';
  String get unavailable => '$_the isn’t available right now: sign in with your password.';
  String get noCredential => 'People didn’t give this phone a $name sign-in: please try again.';

  // asked once, right after a sign-in with the password
  String get offerTitle => 'Sign in with $_yours?';
  String get offerYes => 'Use $name';
  String get turnedOn => '$_title sign-in is on.';

  // the app lock
  String get lockUnavailable => '$_the isn’t available right now: sign out and sign in with your password.';

  // Devices & sign-ins
  String get accountTitle => '$_title Sign-In';
  String get noPhone => _android ? 'No phone signs in with a fingerprint.' : 'No phone signs in with $name.';
  String get phoneSignedOut => _android ? 'That phone no longer signs in with a fingerprint.' : 'That phone no longer signs in with $name.';

  // About
  String get aboutRow => '$_title sign-in';
  String get noneSetUp => _android ? 'No fingerprint or face set up on this phone' : 'No Face ID or Touch ID set up on this phone';
}

/// What this phone has, read once.
final unlockKindProvider = FutureProvider<UnlockKind>((ref) => ref.watch(biometricsProvider).kind());

/// The words for this phone; until it has answered (a moment, at the start), what its platform mostly has.
final unlockWordsProvider = Provider<UnlockWords>((ref) => UnlockWords(ref.watch(unlockKindProvider).value ?? UnlockKind.usual));
