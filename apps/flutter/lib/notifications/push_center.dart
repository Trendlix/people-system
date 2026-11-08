import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/people_client.dart';
import '../platform/push.dart';
import '../providers.dart';

// This phone and People (owner, 8 November 2026: "gives a push notification once requested"): signed in, the phone is
// asked once whether the app may show notifications, and its token is given to People (POST /api/me/push-devices; an
// app session only), again each time the app opens (People keeps when it last saw it) and whenever Firebase changes it.
// Signing out, People is told to forget it (POST /api/me/push-devices/unregister) and the token is dropped on the phone,
// so the next person to sign in on a shared phone doesn't get the last one's notifications.

/// What the phone's notifications came to, for About this app.
enum PushState {
  /// This build has no push (Firebase not set up for it).
  unavailable,

  /// Not yet known (signing in, or not signed in).
  starting,

  /// The phone doesn't let the app show notifications.
  notAllowed,

  /// No token from Firebase (no network, or an iPhone that has none from Apple yet).
  noToken,

  /// People couldn't be told.
  notRegistered,

  /// Registered: People pushes to this phone.
  on,
}

/// This build's push (platform/push.dart).
final pushProvider = Provider<Push>((ref) => pushForThisBuild());

final pushStateProvider = NotifierProvider<PushStateNotifier, PushState>(PushStateNotifier.new);

class PushStateNotifier extends Notifier<PushState> {
  @override
  PushState build() => ref.read(pushProvider).available ? PushState.starting : PushState.unavailable;

  void set(PushState s) => state = s;
}

final pushCenterProvider = Provider<PushCenter>((ref) {
  final center = PushCenter(ref);
  ref.onDispose(center.dispose);
  return center;
});

class PushCenter {
  PushCenter(this._ref);

  final Ref _ref;
  StreamSubscription<String>? _changes;
  String? _token;

  Push get _push => _ref.read(pushProvider);

  void _state(PushState s) => _ref.read(pushStateProvider.notifier).set(s);

  /// Signed in (each time the app opens signed in): asked once, then the token given to People.
  Future<void> signedIn() async {
    final push = _push;
    if (!push.available) return _state(PushState.unavailable);
    if (!await push.start()) return _state(PushState.unavailable);
    if (await push.ask() != PushPermission.allowed) return _state(PushState.notAllowed);
    _changes ??= push.tokenChanges.listen((t) => _register(t));
    final token = await push.token();
    if (token == null) return _state(PushState.noToken);
    await _register(token);
  }

  Future<void> _register(String token) async {
    try {
      await _ref.read(peopleClientProvider).post('/api/me/push-devices', {'token': token, 'platform': _push.platform});
      _token = token;
      _state(PushState.on);
    } on ApiException catch (e) {
      debugPrint('Push: People refused the phone (${e.status}).');
      _state(PushState.notRegistered);
    }
  }

  /// Signing out, while the session still stands: People forgets the phone, and the phone its token.
  Future<void> signingOut() async {
    final push = _push;
    if (!push.available) return;
    // the token People was given (none: it was never given one)
    final token = _token;
    if (token != null) {
      try {
        await _ref.read(peopleClientProvider).post('/api/me/push-devices/unregister', {'token': token});
      } on ApiException {
        // dropped below all the same: People removes a token Firebase says is gone
      }
    }
    await dropped();
  }

  /// The session ended without signing out (People can't be told): the token dropped on the phone, so People's pushes
  /// to it fail and People removes it.
  Future<void> dropped() async {
    // not waited for (nothing to wait for; the subscription's future is the root zone's)
    unawaited(_changes?.cancel());
    _changes = null;
    _token = null;
    final push = _push;
    if (push.available) await push.forget();
    _state(push.available ? PushState.starting : PushState.unavailable);
  }

  void dispose() {
    _changes?.cancel();
  }
}
