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
import '../providers.dart';
import 'away_watch.dart';
import 'locator.dart';

// The hourly location while checked in (owner, 1 November 2026: "can the devices ping every 1 hour their location? and
// flag if someone is not in the checked in location?"; chose "Silent automatic ping"). While the company has it on
// (today's `locationPings`) and the person is checked in, an Android background task reads the location every hour and
// sends it to People (POST /api/me/attendance/pings), which reads it against the check-in and flags it for HR when away.
// Without "Allow all the time", or with the phone's location off, the task says so instead ("Location off" for HR). It
// stops at check-out, when People says they aren't checked in any more, and when signed out. Before asking for "Allow
// all the time", the app says what it reads and why (Google Play's prominent disclosure). On iPhones and iPads, which
// can't run an hourly task, the phone leaving the check-in's area sends it instead (away_watch.dart; owner, 7 November
// 2026: "yes" to "location when leaving the check-in area").

const pingTask = 'people.locationPing';

class PingWords {
  static const title = 'Location while checked in';
  // in the form Google Play asks for a background location's prominent disclosure (6 November 2026)
  static const disclosure =
      'Trendlix People collects location data to confirm you’re at the place you checked in, every hour while you’re checked in, even when the app is closed or not in use. It is sent to HR and stops when you check out.\n\nOn the next screen, choose “Allow all the time”.';
  // iOS's own, before its "Change to Always Allow" (7 November 2026); Apple's rule: the button before it says Continue
  static const disclosureIos =
      'Trendlix People reads your location when you leave the place you checked in at, only while you’re checked in, even when the app is closed or not in use. It is sent to HR, and never read after you check out.\n\nOn the next screen, choose “Change to Always Allow”. If it doesn’t show, choose Always in Settings › Trendlix People › Location.';
  static const notNow = 'Not now';
  static const allow = 'Continue';
}

/// Starts and stops the hourly task (on iPhones and iPads, the watch of the check-in's area).
abstract interface class PingScheduler {
  /// [at]: the spot of the check-in just kept, when there is one.
  Future<void> start({Spot? at});
  Future<void> stop();
}

/// Android's WorkManager: once an hour with a network, kept across restarts; nothing elsewhere.
class WorkmanagerPingScheduler implements PingScheduler {
  const WorkmanagerPingScheduler();

  bool get _android => defaultTargetPlatform == TargetPlatform.android && !kIsWeb;

  @override
  Future<void> start({Spot? at}) async {
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

/// iPhones and iPads (7 November 2026): the watch of the area around the check-in's spot. Only a check-in's own spot
/// starts it: today read again leaves it as it is, running or not (one not running, after the app was put back, starts
/// at the next check-in).
class AwayPingScheduler implements PingScheduler {
  const AwayPingScheduler(this.watch);

  final AwayWatch watch;

  @override
  Future<void> start({Spot? at}) async {
    if (at != null) await watch.start(at.latitude, at.longitude);
  }

  @override
  Future<void> stop() => watch.stop();
}

final pingSchedulerProvider = Provider<PingScheduler>(
  (ref) => awayWatchOn ? AwayPingScheduler(ref.watch(awayWatchProvider)) : const WorkmanagerPingScheduler(),
);

/// Whether the hourly task should run for today as People sees it: switched on, and checked in now.
bool pingsWanted(Today t) => t.locationPings && t.next == PunchKind.checkOut;

/// Starts or stops the task for today; [at]: the spot of the check-in just kept.
Future<void> syncPings(Today t, PingScheduler scheduler, {Spot? at}) => pingsWanted(t) ? scheduler.start(at: at) : scheduler.stop();

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
/// the time" (Android takes the person to the app's settings for it; iPhones and iPads, _askAlwaysOnIos). Nothing when
/// allowed already.
Future<void> askAlwaysLocation(BuildContext context, WidgetRef ref) async {
  if (awayWatchOn) return _askAlwaysOnIos(context, ref.read(awayWatchProvider), ref.read(peopleClientProvider));
  if (defaultTargetPlatform != TargetPlatform.android || kIsWeb) return;
  try {
    if (await Geolocator.checkPermission() == LocationPermission.always) return;
  } catch (_) {
    return;
  }
  if (!context.mounted) return;
  final go = await _disclose(context, PingWords.disclosure);
  if (go != true) return;
  try {
    final now = await Geolocator.requestPermission();
    if (now != LocationPermission.always) await Geolocator.openAppSettings();
  } catch (_) {}
}

/// iPhones and iPads (7 November 2026): the same explanation in iOS's words, then iOS's "Change to Always Allow". Still
/// not "Always": one ping saying so, right away, for HR's "Location not allowed all the time" (Android's task says it
/// every hour; iOS can't wake the app to, so it's said at the check-in).
Future<void> _askAlwaysOnIos(BuildContext context, AwayWatch watch, PeopleClient client) async {
  var access = await watch.authorization();
  if (access == null || access == LocationAccess.always) return;
  if (context.mounted && await _disclose(context, PingWords.disclosureIos) == true) access = await watch.requestAlways() ?? access;
  if (access == LocationAccess.always) return;
  try {
    await client.post('/api/me/attendance/pings', const {'off': 'permission'});
  } on Exception {
    // not sent: said again at the next check-in
  }
}

/// What the location is read for, before the phone asks: true to go on (Continue).
Future<bool?> _disclose(BuildContext context, String text) => showDialog<bool>(
  context: context,
  builder: (c) => AlertDialog(
    title: const Text(PingWords.title),
    content: Text(text),
    actions: [
      TextButton(onPressed: () => Navigator.pop(c, false), child: const Text(PingWords.notNow)),
      FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text(PingWords.allow)),
    ],
  ),
);
