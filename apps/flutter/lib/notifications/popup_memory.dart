import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

// What the "waiting for you" popup last showed (features/requests/waiting_popup.dart), kept on the phone so it shows a
// request once when it comes, and the lot again the next day while they still wait, rather than at every opening.

/// The last popup: whose, on which day (yyyy-mm-dd, the phone's), and the requests it listed.
typedef PopupShown = ({String userId, String day, Set<String> keys});

abstract interface class PopupMemory {
  Future<PopupShown?> read();
  Future<void> write(PopupShown shown);
}

class SecurePopupMemory implements PopupMemory {
  const SecurePopupMemory([this._storage = const FlutterSecureStorage()]);

  final FlutterSecureStorage _storage;
  static const _key = 'people.waiting-popup';

  @override
  Future<PopupShown?> read() async {
    try {
      return popupShownOf(await _storage.read(key: _key));
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> write(PopupShown shown) async {
    try {
      await _storage.write(key: _key, value: jsonEncode({'userId': shown.userId, 'day': shown.day, 'keys': shown.keys.toList()}));
    } catch (_) {
      // not kept: it shows again next time
    }
  }
}

/// As kept (JSON), or none when missing or unreadable.
PopupShown? popupShownOf(String? kept) {
  if (kept == null) return null;
  try {
    final m = jsonDecode(kept);
    if (m is Map && m['userId'] is String && m['day'] is String && m['keys'] is List) {
      return (userId: m['userId'] as String, day: m['day'] as String, keys: {for (final k in m['keys'] as List) if (k is String) k});
    }
  } on FormatException {
    // unreadable: as if none
  }
  return null;
}

/// In memory only: the tests'.
class MemoryPopupMemory implements PopupMemory {
  MemoryPopupMemory([this.shown]);

  PopupShown? shown;

  @override
  Future<PopupShown?> read() async => shown;

  @override
  Future<void> write(PopupShown shown) async => this.shown = shown;
}

final popupMemoryProvider = Provider<PopupMemory>((ref) => const SecurePopupMemory());
