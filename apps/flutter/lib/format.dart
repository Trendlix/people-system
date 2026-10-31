// How times and days read in the app (English for now; one place, ready for Arabic).

import 'package:flutter/widgets.dart' show StringCharacters;

const _weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const _months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/// 09:05, on the phone's clock.
String clockOf(DateTime at) {
  final t = at.toLocal();
  return '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
}

/// Thursday, 30 October.
String dayLineOf(DateTime at) {
  final t = at.toLocal();
  return '${_weekdays[t.weekday - 1]}, ${t.day} ${_months[t.month - 1]}';
}

/// Good morning (before noon), Good afternoon (before 5 PM), Good evening.
String greetingAt(DateTime at) {
  final h = at.toLocal().hour;
  return h < 12 ? 'Good morning' : (h < 17 ? 'Good afternoon' : 'Good evening');
}

/// 7.5 h, 8 h.
String hoursOf(double hours) {
  final rounded = (hours * 10).round() / 10;
  return rounded == rounded.roundToDouble() ? '${rounded.toInt()} h' : '$rounded h';
}

/// Thursday · 30 October (the label over the greeting).
String eyebrowDayOf(DateTime at) {
  final t = at.toLocal();
  return '${_weekdays[t.weekday - 1]} · ${t.day} ${_months[t.month - 1]}';
}

/// 02:35: hours and minutes worked, as the work-time ring shows them.
/// The seconds of a time worked, as the counter shows them beside its minutes: ":07".
String secondsOf(Duration worked) => ':${(worked.isNegative ? 0 : worked.inSeconds % 60).toString().padLeft(2, '0')}';

String workClockOf(Duration worked) {
  final minutes = worked.isNegative ? 0 : worked.inMinutes;
  return '${(minutes ~/ 60).toString().padLeft(2, '0')}:${(minutes % 60).toString().padLeft(2, '0')}';
}

/// 8 hours, 7.5 hours, 1 hour.
String hoursWordsOf(double hours) {
  final rounded = (hours * 10).round() / 10;
  final n = rounded == rounded.roundToDouble() ? '${rounded.toInt()}' : '$rounded';
  return rounded == 1 ? '1 hour' : '$n hours';
}

/// The initials in the avatar: HS for Hazem Soliman, H for Hazem.
String initialsOf(String name) {
  final words = name.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
  if (words.isEmpty) return '?';
  final first = words.first.characters.first;
  return words.length == 1 ? first.toUpperCase() : (first + words.last.characters.first).toUpperCase();
}

const _monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _weekdaysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/// Tuesday · 27 October 2026 (the phone design's line over the greeting).
String eyebrowDateOf(DateTime at) {
  final t = at.toLocal();
  return '${_weekdays[t.weekday - 1]} · ${t.day} ${_months[t.month - 1]} ${t.year}';
}

/// 2026-10-30, the day as People writes it, on the phone's clock.
String isoDayOf(DateTime at) {
  final t = at.toLocal();
  return '${t.year}-${t.month.toString().padLeft(2, '0')}-${t.day.toString().padLeft(2, '0')}';
}

DateTime _day(String iso) => DateTime.parse('${iso}T00:00:00Z');
String _iso(DateTime d) => d.toIso8601String().substring(0, 10);

/// The week `today` is in, Sunday to Saturday (the working week here starts on Sunday); `back` weeks before.
List<String> weekOf(String today, {int back = 0}) {
  final d = _day(today);
  final sunday = d.subtract(Duration(days: d.weekday % 7 + 7 * back));
  return [for (var i = 0; i < 7; i++) _iso(sunday.add(Duration(days: i)))];
}

/// The months ("2026-10") some days fall in, in order.
List<String> monthsOf(Iterable<String> days) => ({for (final d in days) d.substring(0, 7)}.toList()..sort());

/// Sun, Mon … for a day; 0 = Sunday.
String shortWeekday(String iso) => _weekdaysShort[_day(iso).weekday % 7];
int weekdayOf(String iso) => _day(iso).weekday % 7;

/// 14 Feb 2024.
String shortDateOf(String iso) {
  final d = _day(iso);
  return '${d.day} ${_monthsShort[d.month - 1]} ${d.year}';
}

/// The change from last week's hours to this week's, in tenths of a percent; null without last week's.
double? weeklyChange(double thisWeek, double lastWeek) => lastWeek <= 0 ? null : ((thisWeek - lastWeek) / lastWeek * 1000).round() / 10;

/// 7h 07m.
String hoursAndMinutesOf(double hours) {
  final minutes = (hours * 60).round();
  return '${minutes ~/ 60}h ${(minutes % 60).toString().padLeft(2, '0')}m';
}

/// 35.6.
String oneDecimal(double v) {
  final r = (v * 10).round() / 10;
  return r == r.roundToDouble() ? r.toInt().toString() : r.toString();
}

/// October 2026, from "2026-10".
String monthNameOf(String month) {
  final parts = month.split('-');
  if (parts.length < 2) return month;
  final m = int.tryParse(parts[1]);
  return m == null || m < 1 || m > 12 ? month : '${_months[m - 1]} ${parts[0]}';
}
