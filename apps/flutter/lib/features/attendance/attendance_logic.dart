import '../../format.dart';
import '../../models/my_attendance.dart';
import 'attendance_words.dart';

// The Attendance tab's rules as the website shows them (apps/web my-attendance/my-days.ts, attendance/attendance.ts,
// attendance/corrections/corrections.ts; packages/shared attendance-corrections.ts): the month's weeks, how each day looks
// in the calendar, the month's figures, a day's balance and pairs, where most days came from, and what a day offers for a
// correction with the checks People makes. Pure, tested; People checks everything again.

// ---------- months and weeks ----------

DateTime _day(String iso) => DateTime.utc(int.parse(iso.substring(0, 4)), int.parse(iso.substring(5, 7)), int.parse(iso.substring(8, 10)));
String _iso(DateTime d) => d.toIso8601String().substring(0, 10);

/// "2026-10" → "2026-11" (n = 1), "2026-09" (n = −1).
String addMonths(String month, int n) {
  final y = int.parse(month.substring(0, 4));
  final m = int.parse(month.substring(5, 7)) - 1 + n;
  final d = DateTime.utc(y + (m / 12).floor(), m % 12 + 1);
  return _iso(d).substring(0, 7);
}

/// The month's first and last days, YYYY-MM-DD.
({String first, String last}) monthBounds(String month) {
  final first = _day('$month-01');
  final last = DateTime.utc(first.year, first.month + 1, 0);
  return (first: _iso(first), last: _iso(last));
}

/// The month's weeks as its calendar has them, Sunday to Saturday (the working week here starts on Sunday): each 7
/// dates, the first and last weeks reaching into the months around it.
List<List<String>> weeksOf(String month) {
  final b = monthBounds(month);
  final first = _day(b.first);
  var sunday = first.subtract(Duration(days: first.weekday % 7));
  final last = _day(b.last);
  final weeks = <List<String>>[];
  while (!sunday.isAfter(last)) {
    weeks.add([for (var i = 0; i < 7; i++) _iso(sunday.add(Duration(days: i)))]);
    sunday = sunday.add(const Duration(days: 7));
  }
  return weeks;
}

/// The week of the month a day is in (0 = the first), or the first week for a day outside it.
int weekIndexOf(String month, String date) {
  final weeks = weeksOf(month);
  final i = weeks.indexWhere((w) => w.contains(date));
  return i < 0 ? 0 : i;
}

/// "25–31 October": the week's days within the month.
String weekSpanOf(String month, List<String> week) {
  final inMonth = week.where((d) => d.startsWith(month)).toList();
  if (inMonth.isEmpty) return '';
  return AttendanceWords.weekSpan(int.parse(inMonth.first.substring(8)), int.parse(inMonth.last.substring(8)), AttendanceWords.monthOnly(month));
}

// ---------- a day in the calendar ----------

/// How a day looks in the calendar: what it was, or nothing on record.
enum DayLook { worked, rest, leave, holiday, absent, zohoLeave, noCheckIn, none }

DayLook lookOf(DayRecord? day) => switch (day?.status) {
  'worked' => DayLook.worked,
  'rest' => DayLook.rest,
  'leave' => DayLook.leave,
  'holiday' => DayLook.holiday,
  'absent' => DayLook.absent,
  'zoho_leave' => DayLook.zohoLeave,
  'no_check_in' => DayLook.noCheckIn,
  _ => DayLook.none,
};

/// The legend: the design's four always (worked, rest, leave, holiday), and absent, leave in Zoho only and no check-in
/// when the month has any.
List<DayLook> legendOf(MyMonth month) {
  final there = month.days.map(lookOf).toSet();
  return [
    DayLook.worked,
    DayLook.rest,
    DayLook.leave,
    DayLook.holiday,
    for (final l in [DayLook.absent, DayLook.zohoLeave, DayLook.noCheckIn])
      if (there.contains(l)) l,
  ];
}

String legendKey(DayLook l) => switch (l) {
  DayLook.worked => 'worked',
  DayLook.rest => 'rest',
  DayLook.leave => 'leave',
  DayLook.holiday => 'holiday',
  DayLook.absent => 'absent',
  DayLook.zohoLeave => 'zoho_leave',
  DayLook.noCheckIn => 'no_check_in',
  DayLook.none => 'none',
};

// ---------- the month's figures ----------

/// A figure of the month: what it counts, the figure, a note under it, and whether it needs a look (in red).
typedef FigureTile = ({String key, String label, String value, String? note, bool alert});

/// The month's figures, as the website's (attendance.ts figureTiles) with the design's words: days worked, hours
/// counted, absent days, short hours, the extra time used (only with extra time), permission, leave days, missing
/// check-outs; missing check-ins and flagged days for someone who checks in on the system (or a month with any); exempt
/// days and compensatory days off when there are any.
List<FigureTile> figureTiles(MyMonth m) {
  final f = m.figures;
  final w = AttendanceWords.hoursText;
  return [
    (key: 'worked', label: AttendanceWords.daysWorked, value: '${f.daysWorked}', note: AttendanceWords.officeRemote(f.officeDays, f.remoteDays), alert: false),
    (key: 'hours', label: AttendanceWords.hoursCounted, value: w(f.hoursCounted), note: m.averageHours == null ? null : AttendanceWords.dailyAverage(w(m.averageHours!)), alert: false),
    (key: 'absent', label: AttendanceWords.absentDays, value: '${f.absentDays}', note: AttendanceWords.noShowDays, alert: f.absentDays > 0),
    (key: 'short', label: AttendanceWords.shortHours, value: w(f.shortHours), note: AttendanceWords.againstShifts(m.hoursADay == null ? null : w(m.hoursADay!)), alert: false),
    if (f.extraHours > 0) (key: 'filled', label: AttendanceWords.extraTimeUsed, value: w(f.shortHoursFilled), note: AttendanceWords.filledShortHours, alert: false),
    (
      key: 'permission',
      label: AttendanceWords.permission,
      value: w(f.permissionHours),
      note: m.permissionFrom == 'system' ? AttendanceWords.permissionSystem : (m.permissionFrom == 'zoho' ? AttendanceWords.permissionZoho : AttendanceWords.hoursThisMonth),
      alert: false,
    ),
    (key: 'leave', label: AttendanceWords.leaveDays, value: '${f.leaveDays}', note: f.zohoLeaveDays > 0 ? AttendanceWords.zohoLeave(f.zohoLeaveDays) : AttendanceWords.approvedLeave, alert: false),
    (key: 'checkouts', label: AttendanceWords.missingCheckOuts, value: '${f.missingCheckOuts}', note: AttendanceWords.missingCheckOutsNote, alert: false),
    if (m.checksIn || f.missingCheckIns > 0)
      (key: 'checkins', label: AttendanceWords.missingCheckIns, value: '${f.missingCheckIns}', note: AttendanceWords.missingCheckInsNote, alert: false),
    if (m.checksIn || f.flaggedDays > 0) (key: 'flagged', label: AttendanceWords.flaggedDays, value: '${f.flaggedDays}', note: AttendanceWords.flaggedDaysNote, alert: false),
    if (f.exemptDays > 0) (key: 'exempt', label: AttendanceWords.exemptDays, value: '${f.exemptDays}', note: AttendanceWords.exemptDaysNote, alert: false),
    if (f.compensatoryDays > 0)
      (key: 'compensatory', label: AttendanceWords.compensatoryDays, value: '${f.compensatoryDays}', note: AttendanceWords.compensatoryDaysNote, alert: false),
  ];
}

// ---------- a day's row and details ----------

/// A day's balance: short of the shift's hours after its permission ("−0:40"), or over them ("+0:46"); null when neither.
({String text, bool short})? balanceOf(DayRecord d) {
  if (d.shortHours > 0) return (text: AttendanceWords.short(AttendanceWords.hoursText(d.shortHours)), short: true);
  if (d.extraHours > 0) return (text: AttendanceWords.extra(AttendanceWords.hoursText(d.extraHours)), short: false);
  return null;
}

/// A day's pairs, its break and an open last check-in, when it has several pairs or an open one after them; else null.
({String pairs, String? breakText, String? open})? pairsOf(DayRecord d) {
  final pairs = d.pairs ?? const <PressPair>[];
  final open = pairs.isNotEmpty && d.openAt != null;
  if (pairs.length < 2 && !open) return null;
  return (
    pairs: pairs.map((p) => '${clockOf(p.checkIn)}–${clockOf(p.checkOut)}').join(' · '),
    breakText: d.breakMinutes != null && d.breakMinutes! > 0 ? AttendanceWords.breakOf(d.breakMinutes!) : null,
    open: open ? AttendanceWords.openPress(clockOf(d.openAt!)) : null,
  );
}

/// A new employee's first day counted from the shift's start: its first pair starts before its check-in.
bool countedFromShiftStart(DayRecord d) {
  final first = d.pairs?.firstOrNull;
  return first != null && d.checkIn != null && first.checkIn.isBefore(d.checkIn!);
}

/// "Corrected from 09:30 – no check-out"; null for a day not corrected.
String? correctedNoteOf(DayRecord d) {
  if (!d.corrected) return null;
  final from = d.correctedFrom;
  if (from == null) return AttendanceWords.correctedFrom(known: false);
  final pairs = from.pairs ?? const <PressPair>[];
  final several = pairs.length > 1 || (from.openAt != null && pairs.isNotEmpty);
  return AttendanceWords.correctedFrom(
    known: true,
    status: from.status,
    checkIn: from.checkIn == null ? null : clockOf(from.checkIn!),
    checkOut: from.checkOut == null ? null : clockOf(from.checkOut!),
    pairs: several
        ? [
            for (final p in pairs) '${clockOf(p.checkIn)} – ${clockOf(p.checkOut)}',
            if (from.openAt != null) '${clockOf(from.openAt!)} – no check-out',
          ]
        : null,
  );
}

/// The press a day's check-in (or check-out) is, at its moment; none for a time no press made (Zoho's, a correction's).
MonthPress? pressAt(List<MonthPress> presses, DateTime? at, {required bool checkIn}) =>
    at == null ? null : presses.where((p) => p.checkIn == checkIn && p.at.isAtSameMomentAs(at)).firstOrNull;

/// Where most of the month's days came from, said once under the list; null without days.
String? usualSourceOf(List<DayRecord> days) {
  final counts = <String, int>{};
  for (final d in days) {
    counts[d.source] = (counts[d.source] ?? 0) + 1;
  }
  String? best;
  for (final e in counts.entries) {
    if (best == null || e.value > counts[best]!) best = e.key;
  }
  return best;
}

/// The Map link of a press where People gives its spot: Google Maps at its point.
Uri? mapOf(MonthPress p) {
  final lat = p.latitude;
  final lng = p.longitude;
  if (lat == null || lng == null) return null;
  return Uri.parse('https://www.google.com/maps?q=${lat.toStringAsFixed(6)},${lng.toStringAsFixed(6)}');
}

// ---------- corrections ----------

/// What a day offers: the correction of it being decided, a way to ask for one, or nothing.
sealed class DayOffer {
  const DayOffer();
}

class OpenCorrection extends DayOffer {
  const OpenCorrection(this.correction);

  final MonthCorrection correction;
}

class CanAsk extends DayOffer {
  const CanAsk();
}

class NoOffer extends DayOffer {
  const NoOffer();
}

/// A day of the month (the website's dayCorrection): its correction being decided, else a way to ask on a day gone by or
/// today, not of leave, in a month whose payroll isn't approved; nothing from an API from before corrections.
DayOffer offerFor(MyMonth m, String date, String today) {
  if (m.corrections == null) return const NoOffer();
  final open = m.openCorrectionOn(date);
  if (open != null) return OpenCorrection(open);
  if (m.correctable != true || date.compareTo(today) > 0 || m.dayOn(date)?.status == 'leave') return const NoOffer();
  return const CanAsk();
}

/// Whether the month offers "Ask for a correction" at all: its days can be corrected and one of them has come.
bool monthAsks(MyMonth m, String today) => m.corrections != null && m.correctable == true && monthBounds(m.month).first.compareTo(today) <= 0;

/// A day as it is on record (or was, when a correction was asked): "09:05 – no check-out", "Absent", "Rest day", "No
/// day on record".
String onRecordText({required bool known, String? status, DateTime? checkIn, DateTime? checkOut}) {
  if (!known) return AttendanceWords.noDayOnRecord;
  if (checkIn == null && checkOut == null) return status == 'absent' ? AttendanceWords.absent : (AttendanceWords.leaveLike[status] ?? AttendanceWords.noCheckInOrOut);
  return AttendanceWords.times(checkIn == null ? null : clockOf(checkIn), checkOut == null ? null : clockOf(checkOut));
}

/// The right times a correction asks for: "09:05 – 18:30", "In at 09:05", "Out at 18:30", or "As on record".
String rightTimesText(DateTime? checkIn, DateTime? checkOut) {
  if (checkIn != null && checkOut != null) return '${clockOf(checkIn)} – ${clockOf(checkOut)}';
  if (checkIn != null) return AttendanceWords.inAt(clockOf(checkIn));
  if (checkOut != null) return AttendanceWords.outAt(clockOf(checkOut));
  return AttendanceWords.asOnRecord;
}

/// A moment as the lists say it: "27/10/2026, 09:05".
String momentText(DateTime at) => '${AttendanceWords.dmy(isoDayOf(at))}, ${clockOf(at)}';

/// The correction kinds, in the form's order.
const correctionKinds = ['forgot_check_in', 'forgot_check_out', 'wrong_time', 'worked_remotely'];

enum TimeNeed { required, optional, none }

/// The times each kind asks for: forgot to check in, the time they came in (and when they left, if they know it);
/// forgot to check out, the time they left; a time wrong, either or both; worked remotely or at a client, both, the
/// check-in needed when none is on record.
({TimeNeed checkIn, TimeNeed checkOut}) timesNeeded(String? kind, DayRecord? day) => switch (kind) {
  'forgot_check_in' => (checkIn: TimeNeed.required, checkOut: TimeNeed.optional),
  'forgot_check_out' => (checkIn: TimeNeed.none, checkOut: TimeNeed.required),
  'worked_remotely' => (checkIn: day?.checkIn != null ? TimeNeed.optional : TimeNeed.required, checkOut: TimeNeed.optional),
  _ => (checkIn: TimeNeed.optional, checkOut: TimeNeed.optional),
};

/// A correction as typed: the day (YYYY-MM-DD), what was wrong, the times (HH:MM), why.
typedef TypedCorrection = ({String? date, String? kind, String? checkIn, String? checkOut, String reason});

const correctionReasonMax = 500;

/// What POST /api/me/attendance/corrections takes: the times only those the kind asks for.
Map<String, Object> correctionBody(TypedCorrection t) {
  final needs = timesNeeded(t.kind, null);
  return {
    'date': t.date!,
    'kind': t.kind!,
    if (needs.checkIn != TimeNeed.none && t.checkIn != null) 'checkIn': t.checkIn!,
    if (needs.checkOut != TimeNeed.none && t.checkOut != null) 'checkOut': t.checkOut!,
    'reason': t.reason.trim(),
  };
}

/// Why it can't be sent yet, in the order to fix them (none: it can): People's checks against the day as on record in
/// the month (`m`), and a time not yet come today (`now`). What isn't known here People checks when it is sent.
List<String> correctionProblems(TypedCorrection t, MyMonth m, {required String today, required DateTime now}) {
  if (t.date == null) return const [AttendanceWords.needDay];
  final date = t.date!;
  final shown = AttendanceWords.dmy(date);
  if (date.compareTo(today) > 0) return [AttendanceWords.stillToCome(shown)];
  final problems = <String>[];
  if (t.kind == null || !correctionKinds.contains(t.kind)) problems.add(AttendanceWords.needKind);
  final reason = t.reason.trim();
  if (reason.isEmpty) {
    problems.add(AttendanceWords.needReason);
  } else if (reason.length > correctionReasonMax) {
    problems.add(AttendanceWords.reasonTooLong(reason.length));
  }
  final day = date.startsWith(m.month) ? m.dayOn(date) : null;
  if (m.openCorrectionOn(date) != null) problems.add(AttendanceWords.alreadyAsked(shown));
  if (day?.status == 'leave') problems.add(AttendanceWords.onLeave(shown));
  if (problems.isNotEmpty) return problems;

  final kind = t.kind!;
  final needs = timesNeeded(kind, day);
  final inTime = needs.checkIn == TimeNeed.none ? null : t.checkIn;
  final outTime = needs.checkOut == TimeNeed.none ? null : t.checkOut;
  if (kind == 'forgot_check_in') {
    if (inTime == null) {
      problems.add(AttendanceWords.needCameIn);
    } else if (day?.checkIn != null) {
      problems.add(AttendanceWords.checkedInAlready(clockOf(day!.checkIn!), shown));
    }
  } else if (kind == 'forgot_check_out') {
    if (outTime == null) {
      problems.add(AttendanceWords.needLeft);
    } else if (day?.checkOut != null && day?.openAt == null) {
      problems.add(AttendanceWords.checkedOutAlready(clockOf(day!.checkOut!), shown));
    }
  } else if (kind == 'wrong_time') {
    if (inTime == null && outTime == null) {
      problems.add(AttendanceWords.needATime);
    } else if (day?.checkIn == null && day?.checkOut == null) {
      problems.add(AttendanceWords.nothingToCorrect(shown));
    }
  } else if (inTime == null && day?.checkIn == null) {
    problems.add(AttendanceWords.needStart(shown));
  }
  if (problems.isNotEmpty) return problems;
  // a time not yet come today (owner, 26 October 2026: refuse it), by the phone's clock; People checks it by its own
  if (date == isoDayOf(now)) {
    for (final time in [inTime, outTime]) {
      if (time == null) continue;
      final at = DateTime(now.year, now.month, now.day, int.parse(time.substring(0, 2)), int.parse(time.substring(3, 5)));
      if (at.isAfter(now)) problems.add(AttendanceWords.notYetCome(time));
    }
  }
  return problems;
}
