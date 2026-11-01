import '../../models/today.dart';
import '../../platform/locator.dart';

/// The words of checking in, in one place (ready for Arabic): the Dashboard's shift card and the Attendance tab's.
abstract final class CheckInWords {
  static const checkIn = 'Check in';
  static const checkInForWork = 'Check in for work';
  static const checkOut = 'Check out';
  static const findingYou = 'Finding your location…';
  static const notYet = 'Not checked in';
  static const readyToStart = 'Ready to start';
  static const workedToday = 'Worked today';

  /// The timer's share of the shift's hours, for a screen reader: "85% of the day's hours".
  static String ofTheDay(double share) => '${(share * 100).round()}% of the day’s hours';
  static String statusIn(String at) => 'Checked in · $at';
  static String statusOut(String at) => 'Checked out · $at';
  static String checkedIn(String at, String place) => 'Checked in at $at · $place';
  static String checkedOut(String at, String place) => 'Checked out at $at · $place';
  static String shift(String from, String to) => 'Shift $from – $to';
  static const sameAgain = 'Already done: kept once.';
  static const networkNeeded = 'Office network';
  static const wfh = 'Working from home';
  static const duty = 'Official duty';
  static const optional = 'Check-in optional today';
  static const tryAgain = 'Try again';
  static const loadFailed = 'Couldn’t load today.';

  static const places = {'office': 'Office', 'home': 'Home', 'remote': 'Remote', 'unknown': 'Location unknown'};

  static String placeOf(Punch p) {
    final place = places[p.place] ?? places['unknown']!;
    return p.place == 'remote' && p.locationName != null ? '$place · ${p.locationName}' : place;
  }

  static String noLocation(LocationProblem p) => switch (p) {
    LocationProblem.serviceOff => 'Your phone’s location is off: turn it on to check in.',
    LocationProblem.denied => 'Allow your location when the phone asks, to check in.',
    LocationProblem.deniedForever => 'Location is blocked for Trendlix People: allow it in the app’s settings.',
    LocationProblem.timeout => 'Couldn’t find your location in time: move near a window, then try again.',
    LocationProblem.unavailable => 'Couldn’t read your location: please try again.',
  };

  static String locationAction(LocationProblem p) => switch (p) {
    LocationProblem.serviceOff => 'Turn on location',
    LocationProblem.deniedForever => 'Open settings',
    _ => tryAgain,
  };

  /// What today brings beside the check-in: the office network's lock, working from home, official duty, an exemption.
  static List<String> notes(Today t) => [
    if (t.networkLocked) networkNeeded,
    if (t.workingFromHome) wfh,
    if (t.officialDutyNow) duty,
    if (t.exempt) optional,
  ];
}
