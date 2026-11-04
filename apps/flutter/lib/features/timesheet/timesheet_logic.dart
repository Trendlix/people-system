import '../../format.dart';
import '../../models/timesheet.dart';
import 'timesheet_words.dart';

// The timesheet's rules on the phone (packages/shared timesheets.ts): weeks Sunday to Saturday, hours in quarter hours
// from 0.25 to 24 a day, a client or a task on each line, no day to come. People checks everything again. Pure code, tested.

DateTime _day(String iso) => DateTime.parse('${iso}T00:00:00Z');

/// The Sunday a day's week starts on.
String weekOf(String iso) {
  final d = _day(iso);
  return isoDayOf(d.subtract(Duration(days: d.weekday % 7)));
}

/// The week before or after.
String weekShift(String weekStart, int weeks) => isoDayOf(_day(weekStart).add(Duration(days: 7 * weeks)));

/// The week's seven days, Sunday first.
List<String> weekDays(String weekStart) => [for (var i = 0; i < 7; i++) isoDayOf(_day(weekStart).add(Duration(days: i)))];

/// "7.5", "7:30" or "7.75" as hours; null when it isn't one.
double? hoursOf(String text) {
  final t = text.trim();
  final clock = RegExp(r'^(\d{1,2}):([0-5]\d)$').firstMatch(t);
  if (clock != null) return int.parse(clock[1]!) + int.parse(clock[2]!) / 60;
  return double.tryParse(t.replaceAll(',', '.'));
}

/// Whether hours are in quarter hours from 0.25 to 24.
bool hoursOk(double? h) => h != null && h > 0 && h <= 24 && ((h * 4) - (h * 4).round()).abs() < 1e-9;

/// What stops a line being kept, in words: none when it can be.
List<String> lineProblems({required String? clientId, required String task, required double? hours, required String date, required String today, required double otherHoursThatDay}) => [
  if (clientId == null && task.trim().isEmpty) TimesheetWords.clientOrTask,
  if (!hoursOk(hours)) TimesheetWords.hoursRule,
  if (hoursOk(hours) && otherHoursThatDay + hours! > 24) TimesheetWords.dayFull(date),
  if (date.compareTo(today) > 0) TimesheetWords.futureDay,
];

/// A day's hours, all its lines together.
double dayHours(List<TimesheetLine> lines, String date) => lines.where((l) => l.date == date).fold(0, (n, l) => n + l.hours);
