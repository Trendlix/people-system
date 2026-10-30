// One's interview hours (GET and PUT /api/me/interview-hours; packages/shared interview-availability.ts): the weekly
// ranges by weekday (Cairo, "HH:mm" on the quarter hour), the day they count from, one's notice and buffer (the
// company's, or stricter), the one-off changes, the interviews to come; and how one's calendar is read (GET
// /api/calendars/mine). Read by hand; the API checks every value again.

String? _str(Object? v) => v is String && v.trim().isNotEmpty ? v.trim() : null;
int? _int(Object? v) => v is num ? v.toInt() : null;

/// The weekdays as People numbers them, 0 Sunday … 6 Saturday.
const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/// What People allows (packages/shared INTERVIEW_HOURS_LIMITS).
abstract final class HoursLimits {
  static const rangesPerDay = 4;
  static const changes = 60;
}

/// A weekly range: a weekday and its hours, "HH:mm".
typedef WeeklyWindow = ({int day, String from, String to});

/// A one-off change: a day off from interviews (no hours), or extra hours on a date (YYYY-MM-DD).
typedef HoursChange = ({String date, String kind, String? from, String? to});

/// The company's least notice (hours) and buffer between one person's interviews (minutes).
typedef InterviewDefaults = ({int noticeHours, int bufferMinutes});

class InterviewHours {
  const InterviewHours({required this.windows, required this.changes, required this.effectiveFrom, required this.noticeHours, required this.bufferMinutes});

  static InterviewHours? fromJson(Object? json) {
    if (json is! Map) return null;
    final windows = json['windows'] is List ? json['windows'] as List : const [];
    final changes = json['changes'] is List ? json['changes'] as List : const [];
    return InterviewHours(
      windows: [
        for (final w in windows)
          if (w is Map && _int(w['day']) != null && _str(w['from']) != null && _str(w['to']) != null)
            (day: _int(w['day'])!, from: _str(w['from'])!, to: _str(w['to'])!),
      ],
      changes: [
        for (final c in changes)
          if (c is Map && _str(c['date']) != null && (c['kind'] == 'off' || c['kind'] == 'extra'))
            (date: _str(c['date'])!, kind: c['kind'] as String, from: _str(c['from']), to: _str(c['to'])),
      ],
      effectiveFrom: _str(json['effectiveFrom']) ?? '',
      noticeHours: _int(json['noticeHours']),
      bufferMinutes: _int(json['bufferMinutes']),
    );
  }

  final List<WeeklyWindow> windows;
  final List<HoursChange> changes;

  /// YYYY-MM-DD: the weekly hours count from this day on.
  final String effectiveFrom;

  /// One's own; null: the company's.
  final int? noticeHours;
  final int? bufferMinutes;

  /// What PUT /api/me/interview-hours takes.
  Map<String, Object?> toJson() => {
    'windows': [
      for (final w in windows) {'day': w.day, 'from': w.from, 'to': w.to},
    ],
    'changes': [
      for (final c in changes) {'date': c.date, 'kind': c.kind, 'from': c.from, 'to': c.to},
    ],
    'effectiveFrom': effectiveFrom,
    'noticeHours': noticeHours,
    'bufferMinutes': bufferMinutes,
  };
}

/// An interview of one's still to come.
typedef UpcomingInterview = ({String id, DateTime? startsAt, int minutes, String kind, String candidate, String job});

/// GET /api/me/interview-hours.
class MyInterviewHours {
  const MyInterviewHours({
    required this.hours,
    required this.defaults,
    required this.updatedAt,
    required this.updatedBy,
    required this.upcoming,
    required this.needsHours,
  });

  factory MyInterviewHours.fromJson(Object? json) {
    if (json is! Map) throw const FormatException('MyInterviewHours: not an object');
    final d = json['defaults'] is Map ? json['defaults'] as Map : const {};
    final upcoming = json['upcoming'] is List ? json['upcoming'] as List : const [];
    final by = json['updatedBy'];
    return MyInterviewHours(
      hours: InterviewHours.fromJson(json['hours']),
      defaults: (noticeHours: _int(d['noticeHours']) ?? 24, bufferMinutes: _int(d['bufferMinutes']) ?? 15),
      updatedAt: DateTime.tryParse('${json['updatedAt']}'),
      updatedBy: by is Map ? _str(by['name']) : null,
      upcoming: [
        for (final i in upcoming)
          if (i is Map && _str(i['id']) != null)
            (
              id: _str(i['id'])!,
              startsAt: DateTime.tryParse('${i['startsAt']}'),
              minutes: _int(i['minutes']) ?? 0,
              kind: _str(i['kind']) ?? '',
              candidate: _str(i['candidate']) ?? '',
              job: _str(i['job']) ?? '',
            ),
      ],
      needsHours: json['needsHours'] == true,
    );
  }

  /// None set yet: null.
  final InterviewHours? hours;
  final InterviewDefaults defaults;
  final DateTime? updatedAt;
  final String? updatedBy;
  final List<UpcomingInterview> upcoming;

  /// The dashboard asks them to set hours.
  final bool needsHours;
}

// ---------- the words (packages/shared and apps/web lib/interview-hours.ts) ----------

/// The notice choices (hours) and buffer choices (minutes) offered beside the company's.
const noticeChoices = [0, 2, 4, 8, 12, 24, 48, 72, 96, 120, 168, 336];
const bufferChoices = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120];

/// "24 hours", "2 days", "1 hour".
String noticeText(int hours) => hours >= 48 && hours % 24 == 0 ? '${hours ~/ 24} days' : '$hours ${hours == 1 ? 'hour' : 'hours'}';

/// "15 minutes", "1 minute".
String minutesText(int m) => m == 1 ? '1 minute' : '$m minutes';

/// A choice in a list: its value (null: the company's) and its words.
typedef HoursChoice = ({int? value, String label});

/// The company's (sent as null) first, then each stricter choice, and the saved one if off the list.
List<HoursChoice> _stricter(List<int> choices, int company, int? saved, String Function(int) text) {
  final values = {
    for (final n in choices)
      if (n > company) n,
  };
  if (saved != null && saved > company) values.add(saved);
  return [(value: null, label: 'The company’s (${text(company)})'), for (final n in values.toList()..sort()) (value: n, label: text(n))];
}

List<HoursChoice> noticeOptions(InterviewDefaults d, int? saved) => _stricter(noticeChoices, d.noticeHours, saved, noticeText);
List<HoursChoice> bufferOptions(InterviewDefaults d, int? saved) => _stricter(bufferChoices, d.bufferMinutes, saved, minutesText);

/// "24 hours’ notice · 15 minutes between interviews": what is in effect.
String rulesText(int? noticeHours, int? bufferMinutes, InterviewDefaults d) {
  final notice = noticeHours != null && noticeHours > d.noticeHours ? noticeHours : d.noticeHours;
  final buffer = bufferMinutes != null && bufferMinutes > d.bufferMinutes ? bufferMinutes : d.bufferMinutes;
  final n = noticeText(notice);
  final noticePart = notice == 0 ? 'No minimum notice' : '$n${n.endsWith('s') ? '’' : '’s'} notice';
  return '$noticePart · ${buffer == 0 ? 'no buffer' : minutesText(buffer)} between interviews';
}

/// "13:30" → "1:30 PM".
String clock12(String hhmm) {
  final m = RegExp(r'^([01]\d|2[0-3]):([0-5]\d)$').firstMatch(hhmm);
  if (m == null) return hhmm;
  final h = int.parse(m.group(1)!);
  return '${h % 12 == 0 ? 12 : h % 12}:${m.group(2)} ${h < 12 ? 'AM' : 'PM'}';
}

/// "10:00 AM – 12:00 PM".
String rangeText(String from, String to) => '${clock12(from)} – ${clock12(to)}';

/// Every quarter hour of a day, "00:00" … "23:45".
final quarterHours = [for (var m = 0; m < 24 * 60; m += 15) '${(m ~/ 60).toString().padLeft(2, '0')}:${(m % 60).toString().padLeft(2, '0')}'];

/// The words for how an interview is held (packages/shared INTERVIEW_KIND_LABELS).
const interviewKindLabels = {'in_person': 'In person', 'online': 'Online', 'phone': 'By phone'};

// ---------- one's calendar ----------

/// A calendar of one's connected here: which, as which account, and whether it still works.
typedef CalendarLink = ({String provider, String account, bool working});

/// GET /api/calendars/mine: what reads one's busy times.
class MyCalendars {
  const MyCalendars({required this.companyZoho, required this.companyMicrosoft, required this.workEmail, required this.connected});

  factory MyCalendars.fromJson(Object? json) {
    if (json is! Map) throw const FormatException('MyCalendars: not an object');
    final providers = json['providers'] is List ? json['providers'] as List : const [];
    return MyCalendars(
      companyZoho: json['companyZoho'] == true,
      companyMicrosoft: json['companyMicrosoft'] == true,
      workEmail: _str(json['workEmail']),
      connected: [
        for (final p in providers)
          if (p is Map && p['connection'] is Map && _str(p['provider']) != null)
            (
              provider: _str(p['provider'])!,
              account: _str((p['connection'] as Map)['accountEmail']) ?? '',
              working: (p['connection'] as Map)['status'] != 'needs_reconnecting',
            ),
      ],
    );
  }

  final bool companyZoho;
  final bool companyMicrosoft;
  final String? workEmail;
  final List<CalendarLink> connected;
}

/// The words for each calendar (packages/shared CALENDAR_PROVIDER_LABELS).
const calendarLabels = {'zoho': 'Zoho Calendar', 'google': 'Google Calendar', 'microsoft': 'Outlook Calendar'};
