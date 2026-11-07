import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/people_client.dart';
import '../auth/session_store.dart';
import '../config.dart';
import '../providers.dart';

// The location while checked in on iPhones and iPads (owner, 7 November 2026: "yes" to "location when leaving the
// check-in area"). iOS can't wake an app every hour as Android's task does, so the native side (ios/Runner) watches an
// area around the check-in's spot, and iOS's significant location changes, and sends the ping itself when the phone
// leaves (POST /api/me/attendance/pings, as Android's). Started at a check-in with its spot, stopped at check-out, when
// People says they aren't checked in or it's switched off, and at sign-out. Needs "Always" to wake the app.

/// The area watched around the check-in's spot, in metres: the distance People still reads as there for a check-in at
/// no named place (packages/shared location-pings.ts `PING_NEAR_METRES`).
const awayRadiusMetres = 300.0;

/// Whether this phone watches for leaving the check-in's area (iPhones and iPads); Android has its hourly task.
bool get awayWatchOn => defaultTargetPlatform == TargetPlatform.iOS && !kIsWeb;

/// What iOS lets the app read: all the time, only in use, refused, or not asked yet.
enum LocationAccess { always, whenInUse, denied, notDetermined }

/// The native watch. Nothing here throws: a phone without it (Android, the tests) does nothing.
abstract interface class AwayWatch {
  /// Watches [radius] metres around the check-in's spot; replaces any earlier watch.
  Future<void> start(double latitude, double longitude, {double radius = awayRadiusMetres});

  /// Stops watching (nothing when nothing runs).
  Future<void> stop();

  /// Whether a watch runs now.
  Future<bool> watching();

  /// What iOS allows now; null when it can't say.
  Future<LocationAccess?> authorization();

  /// iOS's "Change to Always Allow" prompt (shown by iOS once at most), then what it allows; null when it can't say.
  Future<LocationAccess?> requestAlways();
}

/// The Swift side, over `people/away_watch`. It sends the pings itself, so it is given where People is and the session.
class ChannelAwayWatch implements AwayWatch {
  const ChannelAwayWatch({required this.config, required this.store, this.channel = const MethodChannel('people/away_watch')});

  final AppConfig config;
  final SessionStore store;
  final MethodChannel channel;

  @override
  Future<void> start(double latitude, double longitude, {double radius = awayRadiusMetres}) async {
    try {
      final token = await store.read();
      if (token == null || token.isEmpty) return;
      await channel.invokeMethod<void>('start', {
        'latitude': latitude,
        'longitude': longitude,
        'radius': radius,
        'apiUrl': config.apiUrl,
        'token': token,
        'userAgent': userAgentOf(config.version, defaultTargetPlatform.name),
        'caPem': config.caPem,
      });
    } on Exception catch (e) {
      debugPrint('The location while checked in could not start: $e');
    }
  }

  @override
  Future<void> stop() async {
    try {
      await channel.invokeMethod<void>('stop');
    } on Exception catch (e) {
      debugPrint('The location while checked in could not stop: $e');
    }
  }

  @override
  Future<bool> watching() async {
    try {
      return await channel.invokeMethod<bool>('watching') ?? false;
    } on Exception {
      return false;
    }
  }

  @override
  Future<LocationAccess?> authorization() => _accessOf('authorization');

  @override
  Future<LocationAccess?> requestAlways() => _accessOf('requestAlways');

  Future<LocationAccess?> _accessOf(String method) async {
    try {
      return LocationAccess.values.asNameMap()[await channel.invokeMethod<String>(method)];
    } on Exception {
      return null;
    }
  }
}

final awayWatchProvider = Provider<AwayWatch>((ref) => ChannelAwayWatch(config: ref.watch(configProvider), store: ref.watch(sessionStoreProvider)));
