import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where the app keeps the person's session token between launches (README §2).
abstract interface class SessionStore {
  Future<String?> read();
  Future<void> write(String token);
  Future<void> clear();
}

/// The phone's secure storage (Android Keystore, iOS Keychain).
class SecureSessionStore implements SessionStore {
  const SecureSessionStore([this._storage = const FlutterSecureStorage()]);

  final FlutterSecureStorage _storage;
  static const _key = 'people.session';

  @override
  Future<String?> read() => _storage.read(key: _key);

  @override
  Future<void> write(String token) => _storage.write(key: _key, value: token);

  @override
  Future<void> clear() => _storage.delete(key: _key);
}

/// In memory only: the tests'.
class MemorySessionStore implements SessionStore {
  String? _token;

  @override
  Future<String?> read() async => _token;

  @override
  Future<void> write(String token) async => _token = token;

  @override
  Future<void> clear() async => _token = null;
}
