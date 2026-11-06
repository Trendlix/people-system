import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:workmanager/workmanager.dart';

import '../api/people_client.dart';
import '../api/secure_http.dart';
import '../auth/session_store.dart';
import '../config.dart';
import '../models/today.dart';

// The hourly location while checked in (owner, 1 November 2026: "can the devices ping every 1 hour their location? and
// flag if someone is not in the checked in location?"; chose "Silent automatic ping"). While the company has it on
// (today's `locationPings`) and the person is checked in, an Android background task reads the location every hour and
// sends it to People (POST /api/me/attendance/pings), which reads it against the check-in and flags it for HR when away.
// Without "Allow all the time", or with the phone's location off, the task says so instead ("Location off" for HR). It
// stops at check-out, when People says they aren't checked in any more, and when signed out. Before asking for "Allow
// all the time", the app says what it reads and why (Google Play's prominent disclosure).

const pingTask = 'people.locationPing';

class PingWords {
  static const title = 'Location while checked in';
  // in the form Google Play asks for a background location's prominent disclosure (6 November 2026)
  static const disclosure =
      'Trendlix People collects location data to confirm you’re at the place you checked in, every hour while you’re checked in, even when the app is closed or not in use. It is sent to HR and stops when you check out.\n\nOn the next screen, choose “Allow all the time”.';
  static const notNow = 'Not now';
  static const allow = 'Continue';
}

/// Starts and stops the hourly task.
abstract interface class PingScheduler {
  Future<void> start();
  Future<void> stop();
}

/// Android's WorkManager: once an hour with a network, kept across restarts; nothing elsewhere.
class WorkmanagerPingScheduler implements PingScheduler {
  const WorkmanagerPingScheduler();

  bool get _android => defaultTargetPlatform == TargetPlatform.android && !kIsWeb;

  @override
  Future<void> start() async {
    if (!_android) return;
    try {
      await Workmanager().registerPeriodicTask(
        pingTask,
        pingTask,
        frequency: const Duration(hours: 1),
        initialDelay: const Duration(minutes: 55),
        existingWorkPolicy: ExistingPeriodicWorkPolicy.keep,
        constraints: Constraints(networkType: NetworkType.connected),
      );
    } catch (e) {
      debugPrint('The hourly location could not start: $e');
    }
  }

  @override
  Future<void> stop() async {
    if (!_android) return;
    try {
      await Workmanager().cancelByUniqueName(pingTask);
    } catch (e) {
      debugPrint('The hourly location could not stop: $e');
    }
  }
}

final pingSchedulerProvider = Provider<PingScheduler>((ref) => const WorkmanagerPingScheduler());

/// Whether the hourly task should run for today as People sees it: switched on, and checked in now.
bool pingsWanted(Today t) => t.locationPings && t.next == PunchKind.checkOut;

/// Starts or stops the task for today.
Future<void> syncPings(Today t, PingScheduler scheduler) => pingsWanted(t) ? scheduler.start() : scheduler.stop();

/// Sets the background task up; called once when the app starts (Android only).
Future<void> initPings() async {
  if (defaultTargetPlatform != TargetPlatform.android || kIsWeb) return;
  try {
    await Workmanager().initialize(pingDispatcher);
  } catch (e) {
    debugPrint('The hourly location could not be set up: $e');
  }
}

/// The background task's entry point.
@pragma('vm:entry-point')
void pingDispatcher() {
  Workmanager().executeTask((task, _) async {
    if (task != pingTask) return true;
    try {
      await sendPing();
    } catch (e) {
      debugPrint('The hourly location could not be sent: $e');
    }
    return true;
  });
}

/// What to send: the point, or why there is none (`off`: permission, service).
Future<Map<String, Object>> pingBody() async {
  if (!await Geolocator.isLocationServiceEnabled()) return {'off': 'service'};
  final permission = await Geolocator.checkPermission();
  if (permission != LocationPermission.always) return {'off': 'permission'};
  final p = await Geolocator.getCurrentPosition(
    locationSettings: AndroidSettings(accuracy: LocationAccuracy.high, timeLimit: const Duration(seconds: 45)),
  );
  return {'latitude': p.latitude, 'longitude': p.longitude, 'accuracy': p.accuracy, 'mock': p.isMocked};
}

/// One ping to People; the task stopped once People says they aren't checked in, it's off, or the session ended.
Future<void> sendPing({SessionStore store = const SecureSessionStore(), PingScheduler scheduler = const WorkmanagerPingScheduler()}) async {
  final token = await store.read();
  if (token == null) return scheduler.stop();
  final config = AppConfig.fromEnvironment();
  final client = PeopleClient(
    baseUrl: config.apiUrl,
    httpClient: peopleHttpClient(config.caPem),
    userAgent: userAgentOf(config.version, defaultTargetPlatform.name),
    token: () async => token,
  );
  Map<String, Object> body;
  try {
    body = await pingBody();
  } catch (_) {
    // no reading in time: nothing sent this hour
    return;
  }
  try {
    await client.post('/api/me/attendance/pings', body);
  } on ApiException catch (e) {
    if (e.status == 401 || e.status == 403 || e.status == 409) await scheduler.stop();
  }
}

/// After a check-in, while the company has the hourly location on: says what it reads and why, then asks for "Allow all
/// the time" (Android takes the person to the app's settings for it). Nothing when allowed already.
Future<void> askAlwaysLocation(BuildContext context) async {
  if (defaultTargetPlatform != TargetPlatform.android || kIsWeb) return;
  try {
    if (await Geolocator.checkPermission() == LocationPermission.always) return;
  } catch (_) {
    return;
  }
  if (!context.mounted) return;
  final go = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: const Text(PingWords.title),
      content: const Text(PingWords.disclosure),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text(PingWords.notNow)),
        FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text(PingWords.allow)),
      ],
    ),
  );
  if (go != true) return;
  try {
    final now = await Geolocator.requestPermission();
    if (now != LocationPermission.always) await Geolocator.openAppSettings();
  } catch (_) {}
}
