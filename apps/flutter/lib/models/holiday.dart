// The official holidays (GET /api/payroll/holidays?year=, one row a day), and the next ones as the Dashboard's schedule
// lists them: a run of days one holiday.

class HolidayDay {
  const HolidayDay({required this.date, required this.nameEn, required this.nameAr});

  factory HolidayDay.fromJson(Object? json) {
    final m = json is Map ? json : const {};
    return HolidayDay(date: '${m['date'] ?? ''}', nameEn: '${m['nameEn'] ?? ''}', nameAr: m['nameAr'] is String ? m['nameAr'] as String : null);
  }

  final String date;
  final String nameEn;
  final String? nameAr;
}

/// A holiday of one or more days in a row, and how far off it is from today.
typedef UpcomingHoliday = ({String from, String to, String nameEn, String? nameAr, int days, int inDays});

/// The next holidays from `today` (YYYY-MM-DD), soonest first, days in a row with one name made one.
List<UpcomingHoliday> upcomingHolidays(List<HolidayDay> days, String today, {int limit = 5}) {
  final sorted = [...days.where((d) => d.date.compareTo(today) >= 0)]..sort((a, b) => a.date.compareTo(b.date));
  final out = <UpcomingHoliday>[];
  DateTime dayOf(String iso) => DateTime.parse('${iso}T00:00:00Z');
  for (final d in sorted) {
    final last = out.isEmpty ? null : out.last;
    if (last != null && last.nameEn == d.nameEn && dayOf(d.date).difference(dayOf(last.to)).inDays == 1) {
      out[out.length - 1] = (from: last.from, to: d.date, nameEn: last.nameEn, nameAr: last.nameAr, days: last.days + 1, inDays: last.inDays);
    } else {
      if (out.length == limit) break;
      out.add((from: d.date, to: d.date, nameEn: d.nameEn, nameAr: d.nameAr, days: 1, inDays: dayOf(d.date).difference(dayOf(today)).inDays));
    }
  }
  return out;
}

/// In 3 days, Tomorrow, Today.
String inDaysText(int days) => days <= 0 ? 'Today' : (days == 1 ? 'Tomorrow' : 'In $days days');
