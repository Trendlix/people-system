import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/today.dart';
import '../../platform/locator.dart';
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
  Future<Today> build() async => Today.fromJson(await ref.read(peopleClientProvider).get('/api/me/attendance/today'));

  /// Check in or out, whichever is next. People's refusal comes as an ApiException, in its words.
  Future<PressOutcome> press() async {
    final today = state.value ?? await future;
    final read = await ref.read(locatorProvider).read();
    final spot = read.spot;
    if (spot == null) return NoLocation(read.problem ?? LocationProblem.unavailable);
    final body = <String, Object>{
      'kind': today.next == PunchKind.checkOut ? 'out' : 'in',
      'latitude': spot.latitude,
      'longitude': spot.longitude,
      'accuracy': spot.accuracy,
      // only Android can tell a mock location (apps/api check-in.dto.ts); elsewhere it isn't sent
      if (defaultTargetPlatform == TargetPlatform.android) 'mock': spot.mock,
    };
    final result = punchResultOf(await ref.read(peopleClientProvider).post('/api/me/attendance/punches', body));
    state = AsyncData(result.today);
    return Pressed(result.today.last, result.messages, kept: result.kept);
  }
}
