// How times and days read in the app (English for now; one place, ready for Arabic).

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
