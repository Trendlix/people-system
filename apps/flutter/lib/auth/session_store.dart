import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The phone's credential for fingerprint sign-in (POST /api/auth/devices): People gives the secret once, the app keeps
/// it here and sends it only after the fingerprint (README Phase 1). Kept with whose it is, so someone else signing in
/// on the phone is never offered it.
typedef DeviceCredential = ({String id, String secret, String userId});

/// Where the app keeps the person's session token and the phone's credential between launches (README §2).
abstract interface class SessionStore {
  Future<String?> read();
  Future<void> write(String token);
  Future<void> clear();

  Future<DeviceCredential?> readDevice();
  Future<void> writeDevice(DeviceCredential credential);
  Future<void> clearDevice();
}

/// The phone's secure storage (Android Keystore, iOS Keychain).
class SecureSessionStore implements SessionStore {
  const SecureSessionStore([this._storage = const FlutterSecureStorage()]);

  final FlutterSecureStorage _storage;
  static const _key = 'people.session';
  static const _deviceKey = 'people.device';

  @override
  Future<String?> read() => _storage.read(key: _key);

  @override
  Future<void> write(String token) => _storage.write(key: _key, value: token);

  @override
  Future<void> clear() => _storage.delete(key: _key);

  @override
  Future<DeviceCredential?> readDevice() async => deviceCredentialOf(await _storage.read(key: _deviceKey));

  @override
  Future<void> writeDevice(DeviceCredential credential) =>
      _storage.write(key: _deviceKey, value: jsonEncode({'id': credential.id, 'secret': credential.secret, 'userId': credential.userId}));

  @override
  Future<void> clearDevice() => _storage.delete(key: _deviceKey);
}

/// The credential as kept (JSON), or none when it is missing or unreadable.
DeviceCredential? deviceCredentialOf(String? kept) {
  if (kept == null) return null;
  try {
    final m = jsonDecode(kept);
    if (m is Map) {
      final id = m['id'], secret = m['secret'], userId = m['userId'];
      if (id is String && secret is String && userId is String && id.isNotEmpty && secret.isNotEmpty && userId.isNotEmpty) {
        return (id: id, secret: secret, userId: userId);
      }
    }
  } on FormatException {
    // unreadable: as if none
  }
  return null;
}

/// In memory only: the tests'.
class MemorySessionStore implements SessionStore {
  MemorySessionStore({this.token, this.device});

  String? token;
  DeviceCredential? device;

  @override
  Future<String?> read() async => token;

  @override
  Future<void> write(String token) async => this.token = token;

  @override
  Future<void> clear() async => token = null;

  @override
  Future<DeviceCredential?> readDevice() async => device;

  @override
  Future<void> writeDevice(DeviceCredential credential) async => device = credential;

  @override
  Future<void> clearDevice() async => device = null;
}
