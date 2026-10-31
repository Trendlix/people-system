// Today's check-in state (GET /api/me/attendance/today, apps/api check-in.service.ts `CheckInTodayView`) and a
// press's answer (`PunchResultView`): only what the app shows, read by hand.

/// A check-in or check-out: when, and where People placed it.
class Punch {
  const Punch({
    required this.kind,
    required this.at,
    required this.place,
    required this.locationName,
    required this.officeNetwork,
    required this.flags,
  });

  factory Punch.fromJson(Object? json) {
    if (json is! Map) throw const FormatException('Punch: not an object');
    final at = DateTime.tryParse('${json['at']}');
    if (at == null) throw const FormatException('Punch: no time');
    final flags = json['flags'];
    return Punch(
      kind: json['kind'] == 'out' ? PunchKind.checkOut : PunchKind.checkIn,
      at: at,
      place: '${json['place'] ?? 'unknown'}',
      locationName: _text(json['locationName']),
      officeNetwork: _text(json['officeNetwork']),
      flags: flags is List ? flags.whereType<String>().toList() : const [],
    );
  }

  final PunchKind kind;
  final DateTime at;

  /// office, home, remote or unknown (packages/shared check-in.ts `CHECK_IN_PLACES`).
  final String place;
  final String? locationName;
  final String? officeNetwork;
  final List<String> flags;
}

enum PunchKind { checkIn, checkOut }

class Today {
  const Today({
    required this.refusal,
    required this.next,
    required this.punches,
    required this.hoursCounted,
    required this.openSince,
    required this.expectedText,
    required this.shiftStart,
    required this.shiftEnd,
    this.hoursPerDay = 8,
    required this.networkLocked,
    required this.gpsLocked,
    required this.workingFromHome,
    required this.exempt,
    required this.officialDutyNow,
    this.raw = const {},
  });

  factory Today.fromJson(Object? json) {
    if (json is! Map) throw const FormatException('Today: not an object');
    final punches = json['punches'];
    final day = json['day'];
    final shift = json['shift'];
    final duty = json['officialDuty'];
    return Today(
      refusal: _text(json['refusal']),
      next: json['next'] == 'out' ? PunchKind.checkOut : PunchKind.checkIn,
      punches: punches is List ? punches.map(Punch.fromJson).toList() : const [],
      hoursCounted: day is Map && day['hoursCounted'] is num ? (day['hoursCounted'] as num).toDouble() : 0,
      openSince: day is Map ? DateTime.tryParse('${day['openAt']}') : null,
      expectedText: _text(json['expectedText']),
      shiftStart: shift is Map ? _text(shift['startTime']) : null,
      shiftEnd: shift is Map ? _text(shift['endTime']) : null,
      hoursPerDay: shift is Map && shift['hoursPerDay'] is num && (shift['hoursPerDay'] as num) > 0 ? (shift['hoursPerDay'] as num).toDouble() : 8,
      networkLocked: json['network'] is Map && (json['network'] as Map)['locked'] == true,
      gpsLocked: json['gps'] is Map && (json['gps'] as Map)['locked'] == true,
      workingFromHome: json['workingFromHome'] == true,
      exempt: json['exemption'] != null,
      officialDutyNow: duty is Map && duty['now'] == true,
      raw: json,
    );
  }

  /// Null: they check in on the system; else why not, in People's words.
  final String? refusal;
  final PunchKind next;
  final List<Punch> punches;

  /// The finished check-in → check-out pairs' hours.
  final double hoursCounted;

  /// A check-in with no check-out after it yet.
  final DateTime? openSince;
  final String? expectedText;

  /// The shift's window, HH:MM.
  final String? shiftStart;
  final String? shiftEnd;

  /// The day's hours the shift asks for (the work-time ring's full circle).
  final double hoursPerDay;
  final bool networkLocked;
  final bool gpsLocked;
  final bool workingFromHome;
  final bool exempt;
  final bool officialDutyNow;

  /// Today as People sent it, for what a screen needs beyond these (the Attendance tab's Today panel).
  final Map raw;

  Punch? get last => punches.isEmpty ? null : punches.last;

  /// The time worked so far at [now], breaks included (owner, 31 October 2026: "dont calculate breaks, they are included
  /// in the working hours"): People's hours so far (the first check-in to the last check-out), and while checked in
  /// again, the time since that last check-out (the break with it), else since the open check-in.
  Duration workedAt(DateTime now) {
    final counted = Duration(seconds: (hoursCounted * 3600).round());
    final open = openSince;
    if (open == null || now.isBefore(open)) return counted;
    final lastOut = lastCheckOutBefore(open);
    return counted + now.difference(lastOut ?? open);
  }

  /// The day's last check-out before [at] (its last finished pair's end, else the last press out); null: none.
  DateTime? lastCheckOutBefore(DateTime at) {
    final day = raw['day'];
    final pairs = day is Map ? day['pairs'] : null;
    if (pairs is List) {
      final outs = <DateTime>[];
      for (final p in pairs) {
        final out = p is Map ? DateTime.tryParse('${p['out']}') : null;
        if (out != null && !out.isAfter(at)) outs.add(out);
      }
      outs.sort();
      if (outs.isNotEmpty) return outs.last;
    }
    final presses = punches.where((p) => p.kind == PunchKind.checkOut && !p.at.isAfter(at)).toList();
    return presses.isEmpty ? null : presses.last.at;
  }

  /// The share of the shift's hours a day worked at [now] (1.0: all of them); for the timer's colour.
  double shareAt(DateTime now) => hoursPerDay <= 0 ? 0 : workedAt(now).inMinutes / 60 / hoursPerDay;
}

/// A press's answer: the day after it, what People says, and whether it was kept (false: the same press twice).
typedef PunchResult = ({Today today, List<String> messages, bool kept});

PunchResult punchResultOf(Object? json) {
  final today = Today.fromJson(json);
  final m = json is Map ? json['messages'] : null;
  return (today: today, messages: m is List ? m.whereType<String>().toList() : const <String>[], kept: json is Map && json['kept'] != false);
}

String? _text(Object? v) => v is String && v.trim().isNotEmpty ? v.trim() : null;
