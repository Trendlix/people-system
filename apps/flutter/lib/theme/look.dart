import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

// Light or dark (the design has both, and a switch in its header): as the phone is set until the person picks one,
// then theirs, kept on the phone.

/// Where the person's pick is kept.
abstract interface class LookStore {
  Future<ThemeMode?> read();
  Future<void> write(ThemeMode mode);
}

/// The phone's secure storage, where the app keeps its other things (no other storage needed for one word).
class SecureLookStore implements LookStore {
  const SecureLookStore([this._storage = const FlutterSecureStorage()]);

  final FlutterSecureStorage _storage;
  static const _key = 'people.look';

  @override
  Future<ThemeMode?> read() async => switch (await _storage.read(key: _key)) {
    'light' => ThemeMode.light,
    'dark' => ThemeMode.dark,
    _ => null,
  };

  @override
  Future<void> write(ThemeMode mode) => _storage.write(key: _key, value: mode.name);
}

/// In memory only: the tests'.
class MemoryLookStore implements LookStore {
  MemoryLookStore([this.mode]);

  ThemeMode? mode;

  @override
  Future<ThemeMode?> read() async => mode;

  @override
  Future<void> write(ThemeMode mode) async => this.mode = mode;
}

final lookStoreProvider = Provider<LookStore>((ref) => const SecureLookStore());

final lookProvider = NotifierProvider<LookController, ThemeMode>(LookController.new);

class LookController extends Notifier<ThemeMode> {
  var _picked = false;

  @override
  ThemeMode build() {
    _load();
    return ThemeMode.system;
  }

  Future<void> _load() async {
    try {
      final kept = await ref.read(lookStoreProvider).read();
      if (kept != null && !_picked) state = kept;
    } on Object {
      // unreadable: as the phone is set
    }
  }

  /// The other look from the one showing, kept for next time.
  Future<void> toggle(Brightness showing) async {
    _picked = true;
    state = showing == Brightness.dark ? ThemeMode.light : ThemeMode.dark;
    try {
      await ref.read(lookStoreProvider).write(state);
    } on Object {
      // not kept: it still applies until the app closes
    }
  }
}
