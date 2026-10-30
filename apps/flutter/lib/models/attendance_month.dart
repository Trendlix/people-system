// A month of the employee's own attendance (GET /api/attendance/me?month=YYYY-MM, apps/web lib/attendance-types.ts
// `PersonAttendanceView`): the shift's hours a day, and each day's date, what it was and the hours counted. Only what
// the app shows, read by hand; the Attendance tab reads the rest as it needs it.

class AttendanceDay {
  const AttendanceDay({
    required this.date,
    required this.status,
    required this.hoursCounted,
    required this.checkIn,
    required this.checkOut,
    required this.place,
    required this.raw,
  });

  factory AttendanceDay.fromJson(Object? json) {
    final m = json is Map ? json : const {};
    return AttendanceDay(
      date: '${m['date'] ?? ''}',
      status: '${m['status'] ?? ''}',
      hoursCounted: m['hoursCounted'] is num ? (m['hoursCounted'] as num).toDouble() : 0,
      checkIn: m['checkIn'] is String ? m['checkIn'] as String : null,
      checkOut: m['checkOut'] is String ? m['checkOut'] as String : null,
      place: m['place'] is String ? m['place'] as String : null,
      raw: m,
    );
  }

  /// YYYY-MM-DD.
  final String date;
  final String status;
  final double hoursCounted;
  final String? checkIn;
  final String? checkOut;
  final String? place;

  /// The day as People sent it, for what a screen needs beyond these.
  final Map raw;
}

class AttendanceMonth {
  const AttendanceMonth({required this.month, required this.hoursADay, required this.days, required this.figures, required this.raw});

  factory AttendanceMonth.fromJson(Object? json) {
    if (json is! Map) throw const FormatException('AttendanceMonth: not an object');
    final person = json['person'];
    final p = person is Map ? person : const {};
    final days = p['days'];
    final figures = p['figures'];
    return AttendanceMonth(
      month: '${json['month'] ?? ''}',
      hoursADay: p['hoursADay'] is num ? (p['hoursADay'] as num).toDouble() : null,
      days: days is List ? days.map(AttendanceDay.fromJson).toList() : const [],
      figures: figures is Map ? figures : const {},
      raw: json,
    );
  }

  final String month;
  final double? hoursADay;
  final List<AttendanceDay> days;

  /// The month's figures (days worked, hours counted, absent days …), as People sent them.
  final Map figures;
  final Map raw;
}
