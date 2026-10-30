// The employee's own month as the Attendance tab shows it, read from GET /api/attendance/me?month=YYYY-MM in full
// (apps/web lib/attendance-types.ts `PersonAttendanceView`, packages/shared attendance-days.ts `AttendanceDayView` and
// `AttendanceFigures`): every day kept with what it was, its times, pairs, place, flags, balance, Zoho's status and where
// it came from; the month's figures; its work from home and official duty days; its exemptions from check-in; every
// press; its corrections and whether its days can be corrected now. Read by hand; anything an older API leaves out is
// read as none.

/// A finished check-in → check-out pair.
class PressPair {
  const PressPair(this.checkIn, this.checkOut);

  final DateTime checkIn;
  final DateTime checkOut;

  static List<PressPair>? listOf(Object? json) {
    if (json is! List) return null;
    return [
      for (final p in json)
        if (p is Map && _moment(p['in']) != null && _moment(p['out']) != null) PressPair(_moment(p['in'])!, _moment(p['out'])!),
    ];
  }
}

/// An official duty approved on a day: its request, the full day or its times (HH:MM).
class DutyDay {
  const DutyDay({required this.date, required this.requestId, required this.fullDay, required this.fromTime, required this.toTime});

  static DutyDay? of(Object? json, {String? date}) {
    if (json is! Map) return null;
    final id = json['requestId'];
    if (id is! String) return null;
    return DutyDay(
      date: _text(json['date']) ?? date ?? '',
      requestId: id,
      fullDay: json['fullDay'] == true,
      fromTime: _text(json['fromTime']),
      toTime: _text(json['toTime']),
    );
  }

  final String date;
  final String requestId;
  final bool fullDay;
  final String? fromTime;
  final String? toTime;
}

/// A period exempt from check-in: its first day and its last (null: no end), YYYY-MM-DD.
class ExemptionPeriod {
  const ExemptionPeriod(this.startDate, this.endDate);

  static ExemptionPeriod? of(Object? json) {
    if (json is! Map) return null;
    final start = _text(json['startDate']);
    return start == null ? null : ExemptionPeriod(start, _text(json['endDate']));
  }

  final String startDate;
  final String? endDate;
}

/// A press of Check in or Check out in the month (`punches`): its day, in or out, when, where, its flags, and the spot
/// (the employee sees their own).
class MonthPress {
  const MonthPress({
    required this.date,
    required this.checkIn,
    required this.at,
    required this.place,
    required this.flags,
    this.locationName,
    this.locationKind,
    this.officeNetwork,
    this.latitude,
    this.longitude,
    this.accuracyMetres,
    this.pointFrom,
    this.odRequestId,
  });

  static MonthPress? of(Object? json) {
    if (json is! Map) return null;
    final at = _moment(json['at']);
    final date = _text(json['date']);
    if (at == null || date == null) return null;
    return MonthPress(
      date: date,
      checkIn: json['kind'] != 'out',
      at: at,
      place: _text(json['place']) ?? 'unknown',
      flags: _strings(json['flags']),
      locationName: _text(json['locationName']),
      locationKind: _text(json['locationKind']),
      officeNetwork: _text(json['officeNetwork']),
      latitude: _number(json['latitude']),
      longitude: _number(json['longitude']),
      accuracyMetres: _number(json['accuracyMetres']),
      pointFrom: _text(json['pointFrom']),
      odRequestId: _text(json['odRequestId']),
    );
  }

  final String date;

  /// A check-in (else a check-out).
  final bool checkIn;
  final DateTime at;

  /// office, home, remote or unknown.
  final String place;
  final List<String> flags;
  final String? locationName;

  /// remote_site or client, within one.
  final String? locationKind;
  final String? officeNetwork;
  final double? latitude;
  final double? longitude;
  final double? accuracyMetres;

  /// press, or (an old office press) location: the location's point, the spot itself not kept then.
  final String? pointFrom;

  /// Pressed within an approved official duty.
  final String? odRequestId;
}

/// What a corrected day was before its correction (none: no day on record).
class CorrectedFrom {
  const CorrectedFrom({required this.status, required this.checkIn, required this.checkOut, required this.pairs, required this.openAt});

  static CorrectedFrom? of(Object? json) {
    if (json is! Map) return null;
    return CorrectedFrom(
      status: _text(json['status']) ?? '',
      checkIn: _moment(json['checkIn']),
      checkOut: _moment(json['checkOut']),
      pairs: PressPair.listOf(json['pairs']),
      openAt: _moment(json['openAt']),
    );
  }

  final String status;
  final DateTime? checkIn;
  final DateTime? checkOut;
  final List<PressPair>? pairs;
  final DateTime? openAt;
}

/// A day kept, as People shows it.
class DayRecord {
  const DayRecord({
    required this.date,
    required this.status,
    this.checkIn,
    this.checkOut,
    this.place,
    this.zohoStatus,
    this.permissionHours = 0,
    this.hoursCounted = 0,
    this.source = 'zoho',
    this.flags = const [],
    this.corrected = false,
    this.correctedFrom,
    this.od,
    this.pairs,
    this.openAt,
    this.breakMinutes,
    this.exempt = false,
    this.wfhDay = false,
    this.compensatory = false,
    this.compensated = false,
    this.compensatoryHours,
    this.expectedHours,
    this.shortHours = 0,
    this.extraHours = 0,
    this.missingCheckOut = false,
    this.openHalfDay = false,
    this.missingCheckIn = false,
  });

  static DayRecord? of(Object? json) {
    if (json is! Map) return null;
    final date = _text(json['date']);
    if (date == null) return null;
    return DayRecord(
      date: date,
      status: _text(json['status']) ?? '',
      checkIn: _moment(json['checkIn']),
      checkOut: _moment(json['checkOut']),
      place: _text(json['place']),
      zohoStatus: _text(json['zohoStatus']),
      permissionHours: _number(json['permissionHours']) ?? 0,
      hoursCounted: _number(json['hoursCounted']) ?? 0,
      // a day without one is Zoho's, as every day was before 19 October 2026's check-ins
      source: _text(json['source']) ?? 'zoho',
      flags: _strings(json['flags']),
      corrected: json['source'] == 'correction',
      correctedFrom: CorrectedFrom.of(json['correctedFrom']),
      od: DutyDay.of(json['od'], date: date),
      pairs: PressPair.listOf(json['pairs']),
      openAt: _moment(json['openAt']),
      breakMinutes: _number(json['breakMinutes']),
      exempt: json['exempt'] == true,
      wfhDay: json['wfhDay'] == true,
      compensatory: json['compensatory'] == true,
      compensated: json['compensated'] == true,
      compensatoryHours: _number(json['compensatoryHours']),
      expectedHours: _number(json['expectedHours']),
      shortHours: _number(json['shortHours']) ?? 0,
      extraHours: _number(json['extraHours']) ?? 0,
      missingCheckOut: json['missingCheckOut'] == true,
      openHalfDay: json['openHalfDay'] == true,
      missingCheckIn: json['missingCheckIn'] == true,
    );
  }

  /// YYYY-MM-DD.
  final String date;

  /// worked, absent, rest, holiday, leave, zoho_leave or no_check_in.
  final String status;
  final DateTime? checkIn;
  final DateTime? checkOut;

  /// office, remote, home or unknown.
  final String? place;
  final String? zohoStatus;
  final double permissionHours;
  final double hoursCounted;

  /// zoho, system, device or correction.
  final String source;
  final List<String> flags;

  /// Kept from an approved correction; [correctedFrom] is the day before it (null: no day on record then).
  final bool corrected;
  final CorrectedFrom? correctedFrom;
  final DutyDay? od;

  /// Its finished pairs (null: not kept by pairs), an open last check-in, and the break between the pairs.
  final List<PressPair>? pairs;
  final DateTime? openAt;
  final double? breakMinutes;
  final bool exempt;
  final bool wfhDay;
  final bool compensatory;
  final bool compensated;
  final double? compensatoryHours;
  final double? expectedHours;

  /// Short of the shift's hours after the day's permission, or past them (extra time).
  final double shortHours;
  final double extraHours;
  final bool missingCheckOut;
  final bool openHalfDay;
  final bool missingCheckIn;

  bool get worked => status == 'worked';
}

/// The month's figures (packages/shared `AttendanceFigures`); an older API's missing ones are 0.
class MonthFigures {
  const MonthFigures(this._m);

  factory MonthFigures.of(Object? json) => MonthFigures(json is Map ? json : const {});

  final Map _m;

  int _int(String k) => _m[k] is num ? (_m[k] as num).round() : 0;
  double _hours(String k) => _m[k] is num ? (_m[k] as num).toDouble() : 0;

  int get daysWorked => _int('daysWorked');
  double get hoursCounted => _hours('hoursCounted');
  int get absentDays => _int('absentDays');
  double get shortHours => _hours('shortHours');
  double get extraHours => _hours('extraHours');
  double get shortHoursFilled => _hours('shortHoursFilled');
  double get permissionHours => _hours('permissionHours');
  int get officeDays => _int('officeDays');
  int get remoteDays => _int('remoteDays');
  int get leaveDays => _int('leaveDays');
  int get zohoLeaveDays => _int('zohoLeaveDays');
  int get missingCheckOuts => _int('missingCheckOuts');
  int get missingCheckIns => _int('missingCheckIns');
  int get flaggedDays => _int('flaggedDays');
  int get exemptDays => _int('exemptDays');
  int get compensatoryDays => _int('compensatoryDays');
}

/// A correction of the month, as the month has it by day.
class MonthCorrection {
  const MonthCorrection({required this.id, required this.date, required this.kind, required this.status});

  static MonthCorrection? of(Object? json) {
    if (json is! Map) return null;
    final id = _text(json['id']);
    final date = _text(json['date']);
    if (id == null || date == null) return null;
    return MonthCorrection(id: id, date: date, kind: _text(json['correctionKind']) ?? '', status: _text(json['status']) ?? '');
  }

  final String id;
  final String date;
  final String kind;

  /// with_manager, with_hr, approved, rejected or cancelled.
  final String status;

  bool get open => status == 'with_manager' || status == 'with_hr';
}

/// The employee's month.
class MyMonth {
  const MyMonth({
    required this.month,
    this.hoursADay,
    this.averageHours,
    this.permissionFrom,
    this.checksIn = false,
    this.days = const [],
    this.figures = const MonthFigures({}),
    this.wfhDays = const [],
    this.odDays = const [],
    this.exemptions = const [],
    this.presses = const [],
    this.corrections,
    this.correctable,
    this.correctableReason,
    this.importedAt,
  });

  factory MyMonth.fromJson(Object? json) {
    if (json is! Map) throw const FormatException('MyMonth: not an object');
    final person = json['person'];
    final p = person is Map ? person : const {};
    final corrections = json['corrections'];
    final correctable = json['correctable'];
    final sources = json['sources'];
    final imported = sources is List
        ? (sources.whereType<Map>().map((s) => _text(s['appliedAt']) ?? _text(s['createdAt'])).whereType<String>().toList()..sort()).lastOrNull
        : null;
    return MyMonth(
      month: _text(json['month']) ?? _text(p['month']) ?? '',
      hoursADay: _number(p['hoursADay']),
      averageHours: _number(p['averageHours']),
      permissionFrom: _text(p['permissionFrom']),
      checksIn: p['checksIn'] == true,
      days: [for (final d in _list(p['days'])) ?DayRecord.of(d)],
      figures: MonthFigures.of(p['figures']),
      wfhDays: _strings(p['wfhDays']),
      odDays: [for (final d in _list(p['odDays'])) ?DutyDay.of(d)],
      exemptions: [for (final e in _list(p['exemptions'])) ?ExemptionPeriod.of(e)],
      // every press is the view's own, beside the person
      presses: [for (final x in _list(json['punches'])) ?MonthPress.of(x)],
      corrections: corrections is List ? [for (final c in corrections) ?MonthCorrection.of(c)] : null,
      correctable: correctable is Map ? correctable['allowed'] == true : null,
      correctableReason: correctable is Map ? _text(correctable['reason']) : null,
      importedAt: imported == null ? null : DateTime.tryParse(imported),
    );
  }

  /// YYYY-MM.
  final String month;

  /// The shift's hours a day; null without a shift.
  final double? hoursADay;

  /// The hours counted on average a day counted.
  final double? averageHours;

  /// Where the permission hours came from: system, zoho, or none.
  final String? permissionFrom;

  /// They checked in on the system that month.
  final bool checksIn;
  final List<DayRecord> days;
  final MonthFigures figures;
  final List<String> wfhDays;
  final List<DutyDay> odDays;
  final List<ExemptionPeriod> exemptions;
  final List<MonthPress> presses;

  /// The month's corrections; null from an API from before them (then no correction is offered).
  final List<MonthCorrection>? corrections;

  /// Whether its days can be corrected now (not once its payroll is approved or paid), and why not.
  final bool? correctable;
  final String? correctableReason;

  /// When HR last imported Zoho People's days of the month (applied, else read).
  final DateTime? importedAt;

  DayRecord? dayOn(String date) => days.where((d) => d.date == date).firstOrNull;

  /// A day's presses, in the order pressed.
  List<MonthPress> pressesOn(String date) => presses.where((p) => p.date == date).toList()..sort((a, b) => a.at.compareTo(b.at));

  /// A correction of the day being decided, if any.
  MonthCorrection? openCorrectionOn(String date) => corrections?.where((c) => c.date == date && c.open).firstOrNull;
}

String? _text(Object? v) => v is String && v.trim().isNotEmpty ? v.trim() : null;
double? _number(Object? v) => v is num && v.isFinite ? v.toDouble() : null;
DateTime? _moment(Object? v) => v is String ? DateTime.tryParse(v) : null;
List<Object?> _list(Object? v) => v is List ? v : const [];
List<String> _strings(Object? v) => v is List ? v.whereType<String>().toList() : const [];
