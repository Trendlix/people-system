import 'package:flutter_test/flutter_test.dart';
import 'package:people/models/today.dart';
import 'package:people/platform/location_pings.dart';
import 'package:people/platform/locator.dart';

// The hourly location while checked in (owner, 1 November 2026: "Silent automatic ping"): started while the company has
// it on and the person is checked in, stopped otherwise.

class _Scheduler implements PingScheduler {
  final calls = <String>[];
  @override
  Future<void> start({Spot? at}) async => calls.add('start');
  @override
  Future<void> stop() async => calls.add('stop');
}

Today _today({required bool pings, required String next}) => Today.fromJson({'locationPings': pings, 'next': next, 'punches': const []});

void main() {
  test('runs only while switched on and checked in', () async {
    expect(pingsWanted(_today(pings: true, next: 'out')), isTrue);
    expect(pingsWanted(_today(pings: true, next: 'in')), isFalse);
    expect(pingsWanted(_today(pings: false, next: 'out')), isFalse);
    expect(pingsWanted(Today.fromJson({})), isFalse);

    final s = _Scheduler();
    await syncPings(_today(pings: true, next: 'out'), s);
    await syncPings(_today(pings: true, next: 'in'), s);
    await syncPings(_today(pings: false, next: 'out'), s);
    expect(s.calls, ['start', 'stop', 'stop']);
  });

  test('tells the person what it reads and why before asking for “Allow all the time”', () {
    expect(PingWords.disclosure, contains('every hour'));
    expect(PingWords.disclosure, contains('even when the app is closed'));
    expect(PingWords.disclosure, contains('HR'));
    expect(PingWords.disclosure, contains('Allow all the time'));
  });
}
