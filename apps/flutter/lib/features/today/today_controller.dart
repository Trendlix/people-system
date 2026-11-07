import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/today.dart';
import '../../platform/locator.dart';
import '../../platform/location_pings.dart';
import '../../providers.dart';

// One-tap check-in (README Phase 1; owner, 30 October 2026: "One-tap check-in"): today's state, and a press that reads
// where the phone is right then (never tracked) and sends it with Check in or Check out; People decides the rest (the
// office, the network's lock, the GPS lock, fake GPS) and says so in its words.

/// How a press ended: pressed (with what People says), or no location to press with.
sealed class PressOutcome {
  const PressOutcome();
}

class Pressed extends PressOutcome {
  const Pressed(this.punch, this.messages, {required this.kept});

  /// The press as People kept it (its time and place).
  final Punch? punch;
  final List<String> messages;

  /// False: the same press twice, kept once.
  final bool kept;
}

class NoLocation extends PressOutcome {
  const NoLocation(this.problem);

  final LocationProblem problem;
}

final todayProvider = AsyncNotifierProvider.autoDispose<TodayController, Today>(TodayController.new);

class TodayController extends AsyncNotifier<Today> {
  @override
  Future<Today> build() async {
    final today = Today.fromJson(await ref.read(peopleClientProvider).get('/api/me/attendance/today'));
    // the hourly location while checked in (1 November 2026): started or stopped as today says
    unawaited(syncPings(today, ref.read(pingSchedulerProvider)));
    return today;
  }

  /// Check in or out, whichever is next. People's refusal comes as an ApiException, in its words.
  Future<PressOutcome> press() async {
    final today = state.value ?? await future;
    final read = await ref.read(locatorProvider).read();
    final spot = read.spot;
    if (spot == null) return NoLocation(read.problem ?? LocationProblem.unavailable);
    // the latest position for the activity log too (31 October 2026)
    ref.read(locationCacheProvider).remember(spot);
    final body = <String, Object>{
      'kind': today.next == PunchKind.checkOut ? 'out' : 'in',
      'latitude': spot.latitude,
      'longitude': spot.longitude,
      'accuracy': spot.accuracy,
      // fake GPS, kept and flagged by People (apps/api check-in.dto.ts): Android's mock location, and on an iPhone or iPad a
      // location simulated by software (iOS 15, the app's least, and later; a computer's location tool is how an iPhone's
      // is faked; owner, 7 November 2026: "why cant we fix it?")
      'mock': spot.mock,
    };
    final result = punchResultOf(await ref.read(peopleClientProvider).post('/api/me/attendance/punches', body));
    state = AsyncData(result.today);
    // on iPhones and iPads the watch starts at the spot of a check-in kept (7 November 2026: "location when leaving the
    // check-in area")
    unawaited(syncPings(result.today, ref.read(pingSchedulerProvider), at: result.kept ? spot : null));
    return Pressed(result.today.last, result.messages, kept: result.kept);
  }
}
