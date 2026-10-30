// What the Attendance tab's Today panel reads of GET /api/me/attendance/today beyond `Today` (apps/api check-in.service.ts
// `CheckInTodayView`), from the day as People sent it: the working day, where the work arrangement expects them, their
// first day, their exemption from check-in, their own check-in places, whether the office's location is set, and the day
// so far (its check-out, place, flags, break). Read by hand; an older API's missing ones are none.

import 'my_attendance.dart' show ExemptionPeriod;

class TodayDetails {
  const TodayDetails({
    this.date,
    this.expected,
    this.firstDay = false,
    this.exemption,
    this.ownPlaces = const [],
    this.officeLocationSet = true,
    this.dayCheckIn,
    this.dayCheckOut,
    this.dayPlace,
    this.dayFlags = const [],
    this.breakMinutes,
    this.shiftStart,
    this.locationKinds = const [],
  });

  factory TodayDetails.of(Map raw) {
    final day = raw['day'];
    final d = day is Map ? day : const {};
    final shift = raw['shift'];
    final punches = raw['punches'];
    return TodayDetails(
      date: _text(raw['date']),
      expected: _text(raw['expected']),
      firstDay: raw['firstDay'] == true,
      exemption: ExemptionPeriod.of(raw['exemption']),
      ownPlaces: raw['ownPlaces'] is List ? (raw['ownPlaces'] as List).whereType<String>().map((s) => s.trim()).where((s) => s.isNotEmpty).toSet().toList() : const [],
      officeLocationSet: raw['officeLocationSet'] != false,
      dayCheckIn: _moment(d['checkIn']),
      dayCheckOut: _moment(d['checkOut']),
      dayPlace: _text(d['place']),
      dayFlags: d['flags'] is List ? (d['flags'] as List).whereType<String>().toList() : const [],
      breakMinutes: d['breakMinutes'] is num ? (d['breakMinutes'] as num).toDouble() : null,
      shiftStart: shift is Map ? _text(shift['startTime']) : null,
      locationKinds: punches is List ? [for (final p in punches) p is Map ? _text(p['locationKind']) : null] : const [],
    );
  }

  /// The working day the next press counts on, YYYY-MM-DD.
  final String? date;

  /// office or anywhere: where the work arrangement expects them today.
  final String? expected;

  /// The first working day of their employment: counted from the shift's start.
  final bool firstDay;
  final ExemptionPeriod? exemption;

  /// Their own check-in places (sub-locations), by name.
  final List<String> ownPlaces;
  final bool officeLocationSet;
  final DateTime? dayCheckIn;
  final DateTime? dayCheckOut;
  final String? dayPlace;
  final List<String> dayFlags;
  final double? breakMinutes;

  /// The shift's start, HH:MM.
  final String? shiftStart;

  /// Each of today's presses' kind of place (remote_site, client), in the order People sent them.
  final List<String?> locationKinds;
}

String? _text(Object? v) => v is String && v.trim().isNotEmpty ? v.trim() : null;
DateTime? _moment(Object? v) => v is String ? DateTime.tryParse(v) : null;
