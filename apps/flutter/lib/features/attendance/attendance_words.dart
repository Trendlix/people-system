import '../../models/my_attendance.dart' show DutyDay, ExemptionPeriod;

/// The Attendance tab's words, in one place (ready for Arabic). People's own words where the website says the same
/// (packages/shared: the day statuses, sources, flags, the correction kinds and checks).
abstract final class AttendanceWords {
  // ---------- the page ----------
  static const eyebrow = 'People System · Attendance';
  static const title = 'My Attendance';
  static const intro = 'Your check-ins and check-outs, counted by the company’s attendance rules.';
  static String showMonth(String month) => 'Show $month';
  static const hold = 'Your access is on hold: you can still check in and out.';
  static String noProfile(String email) => 'No employee record uses your sign-in email ($email) as its work email yet. Ask HR to add it to your profile.';
  static const monthFailed = 'Couldn’t load this month.';
  static const tryAgain = 'Try again';
  static String notYet(String month) =>
      'No attendance for $month yet. Check-ins on the system show here as they are made, and HR imports Zoho People’s attendance with the month’s payroll.';

  // ---------- exempt from check-in (25 October 2026) ----------
  static const exempt = 'Exempt';
  static const exemptionLabel = 'Exempt from check-in';
  static String exemptionWhen(ExemptionPeriod p) => 'From ${dmy(p.startDate)}${p.endDate == null ? ', no end date' : ' until ${dmy(p.endDate!)}'}';
  static String exemptions(List<ExemptionPeriod> periods) =>
      '$exemptionLabel: ${periods.map((p) => exemptionWhen(p).replaceFirst('From', 'from')).join('; ')}. Your working days count as full hours; checking in is optional.';

  // ---------- today ----------
  static String todayOf(String day) => 'Today · $day';
  static const readyToStart = 'Ready to start?';
  static String checkedInAt(String at) => 'Checked in at $at';
  static String checkedOutAt(String at) => 'Checked out at $at';
  static const checkingIn = 'Checking in';
  static const currentTime = 'Current time';
  static const timeWorked = 'Time worked';
  static const inOffice = 'In office';
  static const atHome = 'At home';
  static const remote = 'Remote';
  static const checkedIn = 'Checked in';
  static const checkedOut = 'Checked out';
  static const notCheckedIn = 'Not checked in';
  static const anywhere = 'Anywhere';
  static const officialDuty = 'Official duty';
  static String officeAt(String name) => 'Office · $name';
  static const wfhToday = 'Working from home today';
  static String firstDayToday(String? start) => 'Your first day: it is counted from your shift’s start${start == null ? '' : ', $start'}, whatever time you check in.';
  static const networkNeeded = 'Check-ins need the office network: connect to the office Wi-Fi before you check in or out.';
  static const gpsNeeded = 'Check-ins need you at the office: your location is checked when you check in or out, and the app reads it more precisely than a browser.';
  static const bothNeeded = 'Check-ins need you at the office: on the office Wi-Fi, or with your location inside the office’s area.';

  /// What someone locked to the office network or the check-in locations is told before pressing; null when neither.
  static String? lockText({required bool network, required bool gps, List<String> ownPlaces = const []}) {
    final n = ownPlaces.length;
    final names = ownPlaces.join(', ');
    if (!gps) return network ? (n == 0 ? networkNeeded : '$networkNeeded At your own check-in place${n == 1 ? '' : 's'} ($names) you can check in off it.') : null;
    return '${network ? bothNeeded : gpsNeeded}${n == 0 ? '' : ' Your own check-in place${n == 1 ? '' : 's'} ($names) count${n == 1 ? 's' : ''} too.'}';
  }

  static const officeNotSet = 'HR hasn’t set the office’s location on the system yet, so check-ins are kept as location unknown for now.';
  static const todaysCheckIns = 'Today’s check-ins';
  static String breakNotCounted(String text) => '$text, not counted';

  // ---------- the calendar ----------
  static const calendar = 'Attendance calendar';
  static const week = 'Week';
  static const month = 'Month';
  static String weekNumber(int n) => 'Week $n';
  static String weekSpan(int from, int to, String monthName) => from == to ? '$from $monthName' : '$from–$to $monthName';
  static const previousWeek = 'Previous week';
  static const nextWeek = 'Next week';
  static const nothingOnRecord = 'Nothing on record';
  static String cellLabel(String day, String what, {required bool today}) => '$day, $what${today ? ', today' : ''}';

  /// The legend's words, short; a day's own label says its status in full.
  static const legend = {
    'worked': 'Worked',
    'rest': 'Rest',
    'leave': 'Leave',
    'holiday': 'Holiday',
    'absent': 'Absent',
    'zoho_leave': 'Leave in Zoho only',
    'no_check_in': 'No check-in',
  };

  // ---------- the month's figures ----------
  static const daysWorked = 'Days worked';
  static String officeRemote(int office, int remote) => '$office office · $remote remote';
  static const hoursCounted = 'Hours counted';
  static String dailyAverage(String h) => '$h daily average';
  static const absentDays = 'Absent days';
  static const noShowDays = 'No-show days';
  static const shortHours = 'Short hours';
  static String againstShifts(String? h) => h == null ? 'Against the shift’s hours a day' : 'Against $h shifts';
  static const extraTimeUsed = 'Extra time used';
  static const filledShortHours = 'Filled short hours';
  static const permission = 'Permission';
  static const permissionSystem = 'Approved in the system';
  static const permissionZoho = 'Zoho’s, within the month’s allowance';
  static const hoursThisMonth = 'Hours this month';
  static const leaveDays = 'Leave days';
  static const approvedLeave = 'Approved leave';
  static String zohoLeave(int n) => 'And $n ${n == 1 ? 'day' : 'days'} of leave in Zoho only, to record';
  static const missingCheckOuts = 'Missing check-outs';
  static const missingCheckOutsNote = 'A check-in without a check-out: counted as half a day until corrected';
  static const missingCheckIns = 'Missing check-ins';
  static const missingCheckInsNote = 'A check-out without a check-in: no hours';
  static const flaggedDays = 'Flagged days';
  static const flaggedDaysNote = 'A check-in outside the work arrangement’s rule, or on a fake GPS';
  static const exemptDays = 'Exempt days';
  static const exemptDaysNote = 'Exempt from check-in: counted as full hours';
  static const compensatoryDays = 'Compensatory days off';
  static const compensatoryDaysNote = 'Counted as full paid days: never absent or short';

  // ---------- your days ----------
  static const yourDays = 'Your days';
  static const myCorrections = 'My corrections';
  static const askCorrection = 'Ask for a correction';
  static const daysNote = 'A day that isn’t right? Ask for a correction on its row: your manager, then HR, decide it.';
  static const daysNoteNoCorrections = 'Something wrong? Ask HR to check it.';
  static String usualSource(String source) => 'Where the days came from: $source, unless a day says otherwise.';
  static const balanceNote = 'Balance: the time over (+) or short (−) of your shift’s hours that day, after its permission.';
  static String importedOn(String date) => 'Days from Zoho People imported by HR on $date.';
  static String correctionOf(String status) => 'Correction ${status[0].toLowerCase()}${status.substring(1)}';
  static String openDay(String day) => 'Open $day';

  static const statuses = {
    'worked': 'Worked',
    'absent': 'Absent',
    'rest': 'Rest day',
    'holiday': 'Official holiday',
    'leave': 'On leave',
    'zoho_leave': 'Leave in Zoho only',
    'no_check_in': 'No check-in, not absent',
  };
  static String statusOf(String s) => statuses[s] ?? s;

  static const sources = {'zoho': 'Zoho People', 'system': 'Checked in on the system', 'device': 'Attendance device', 'correction': 'Corrected'};
  static String sourceOf(String s) => sources[s] ?? s;

  static const flags = {
    'outside_office': 'Checked in outside the office on an office day',
    'location_unknown': 'Location unknown on an office day',
    'fake_gps': 'Fake GPS suspected',
    'not_home_or_office': 'Not at home or the office',
    'not_their_location': 'Checked in at a sub-location they aren’t linked to',
  };
  static const flagsShort = {
    'outside_office': 'Outside the office',
    'location_unknown': 'No location',
    'fake_gps': 'Fake GPS suspected',
    'not_home_or_office': 'Not at home or the office',
    'not_their_location': 'Not their location',
  };

  static const places = {'office': 'Office', 'home': 'Home', 'remote': 'Remote', 'unknown': 'Location unknown'};

  /// A press's place: "Remote - Studio", "Client · Acme", "Remote site · Flat", else the place's word.
  static String pressPlace(String place, {String? name, String? kind}) {
    if (place == 'remote' && name != null && name.trim().isNotEmpty) {
      final n = name.trim().replaceAll(RegExp(r'\s+'), ' ');
      return kind == 'client' ? 'Client · $n' : (kind == 'remote_site' ? 'Remote site · $n' : 'Remote - $n');
    }
    return places[place] ?? place;
  }

  // ---------- a day ----------
  static const yourDay = 'Your day';
  static const whatItWas = 'What it was';
  static const checkIn = 'Check-in';
  static const checkOut = 'Check-out';
  static const missing = 'Missing';
  static const pairs = 'Its check-ins and check-outs';
  static String breakOf(double minutes) {
    final m = minutes.round();
    return m < 60 ? 'Break $m min' : 'Break ${m ~/ 60} h${m % 60 == 0 ? '' : ' ${m % 60} min'}';
  }

  static String openPress(String at) => 'Checked in $at · not checked out';
  static const halfDay = 'Counted as half a day until corrected.';
  static const hours = 'Hours';
  static const balance = 'Balance';
  static String short(String h) => '−$h short';
  static const shortTitle = 'Short of the shift’s hours, after the day’s permission';
  static String extra(String h) => '+$h extra';
  static const extraTitle = 'Extra time past the shift’s hours';
  static String permissionOf(String h) => '$h permission';
  static const zohoSays = 'Zoho says';
  static const cameFrom = 'Where it came from';
  static String allPresses(int n) => 'All presses ($n)';
  static String press(bool checkIn, String at) => '${checkIn ? 'In' : 'Out'} $at';
  static const map = 'Map';
  static String mapOf(bool checkIn, String at) => 'Open the ${checkIn ? 'check-in' : 'check-out'} at $at on the map';
  static const odMark = 'OD';
  static const odMarkTitle = 'Pressed within an approved official duty: taken from where you were.';
  static const wfhDay = 'Working from home';
  static const odDay = 'On official duty';
  static String odDayWhen(DutyDay od) => !od.fullDay && od.fromTime != null && od.toTime != null ? '$odDay, ${od.fromTime}–${od.toTime}' : '$odDay, the full day';
  static const exemptDayTitle = '$exemptionLabel: counted as full hours; any presses are kept for reference only';
  static const compensatoryDayOff = 'Compensatory day off';
  static const compensatoryDayTitle = 'A full paid day in exchange for a rest day or an official holiday worked; never absent or short';
  static String compensatoryHours(double h) => 'Compensatory hours off: ${_trim(h)} h';
  static const compensatoryHoursTitle = 'Hours off for part of a rest day or an official holiday worked: counted as worked hours that day, with no deduction';
  static String firstDayNote(String at) => 'First day: counted from the shift start (checked in $at)';
  static const correction = 'Correction';

  /// "Corrected from 09:30 – no check-out", "Corrected from absent", "Corrected from no day on record".
  static String correctedFrom({required bool known, String? status, String? checkIn, String? checkOut, List<String>? pairs}) {
    if (!known) return 'Corrected from no day on record';
    if (pairs != null && pairs.isNotEmpty) return 'Corrected from ${pairs.join(' · ')}';
    if (checkIn == null && checkOut == null) {
      return status == 'worked' ? 'Corrected from no check-in or check-out' : 'Corrected from ${status == 'absent' ? 'absent' : 'a day not worked'}';
    }
    return 'Corrected from ${checkIn ?? 'no check-in'} – ${checkOut ?? 'no check-out'}';
  }

  // ---------- asking for a correction ----------
  static const newRequest = 'New request';
  static const correctionIntro = 'Your direct manager decides first (without one, your lead), then HR.';
  static const correctionIntroCeo = 'Your direct manager decides first (without one, your lead), then the CEO.';
  static const day = 'Day';
  static const chooseDay = 'Choose the day';
  static const dayHint = 'A day gone by, or today, in a month whose payroll isn’t approved yet.';
  static String onRecordFor(String day) => 'On record for $day';
  static const whatWasWrong = 'What was wrong';
  static const kinds = {
    'forgot_check_in': 'I forgot to check in',
    'forgot_check_out': 'I forgot to check out',
    'wrong_time': 'A time is wrong',
    'worked_remotely': 'I worked remotely or at a client',
  };
  static const kindNames = {
    'forgot_check_in': 'Forgot to check in',
    'forgot_check_out': 'Forgot to check out',
    'wrong_time': 'Wrong time',
    'worked_remotely': 'Worked remotely or at a client',
  };
  static String kindName(String k) => kindNames[k] ?? k;
  static const cameInAt = 'Came in at';
  static const startedAt = 'Started work at';
  static const leftAt = 'Left at';
  static const optional = '(optional)';
  static const chooseTime = 'Choose a time';
  static String clear(String what) => 'Clear $what';
  static const timesHint = 'A time left empty stays as on record.';
  static const why = 'Why';
  static const whyHint = 'E.g. I left for a client meeting and forgot to check out. Your manager and HR read it. Up to 500 characters.';
  static const beforeSend = 'Before you can send it:';
  static const cancel = 'Cancel';
  static const send = 'Send request';
  static const sending = 'Sending…';

  // the checks, in People's words (packages/shared attendance-corrections.ts correctionProblems)
  static const needDay = 'Choose the day to correct.';
  static const needKind = 'Choose what was wrong.';
  static const needReason = 'Write why the day needs correcting, e.g. I left for a client meeting and forgot to check out.';
  static String reasonTooLong(int n) => 'Keep the reason to 500 characters; it has $n.';
  static String stillToCome(String day) => '$day is still to come: only a day gone by, or today, can be corrected.';
  static String alreadyAsked(String day) => 'You asked to correct $day already: wait for it to be decided, or cancel it.';
  static String onLeave(String day) => 'You have approved leave on $day: there is no attendance to correct on a day of leave.';
  static const needCameIn = 'Enter the time you came in.';
  static const needLeft = 'Enter the time you left.';
  static String checkedInAlready(String at, String day) => 'You checked in at $at on $day already: choose “${kinds['wrong_time']}” to change it.';
  static String checkedOutAlready(String at, String day) => 'You checked out at $at on $day already: choose “${kinds['wrong_time']}” to change it.';
  static const needATime = 'Enter the right time of the check-in, of the check-out, or both.';
  static String nothingToCorrect(String day) => 'There is no check-in or check-out on $day to correct: choose “${kinds['forgot_check_in']}”.';
  static String needStart(String day) => 'Enter the time you started work on $day.';
  static String notYetCome(String at) => 'Choose a time that has passed: $at today hasn’t come yet.';

  /// Once it can be sent: what and where it goes.
  static String ready(String kind, String day, {bool toCeo = false}) =>
      'Ready to send: ${kindName(kind).toLowerCase()} on $day, to your direct manager (without one, your lead), then ${toCeo ? 'the CEO' : 'HR'}.';

  /// Once sent: where it goes.
  static String sent(String status, {String? managerRole, bool confidential = false}) {
    final hr = confidential ? 'the CEO' : 'HR';
    if (status == 'approved') return 'Day corrected, approved at once: its hours are counted again, and the month’s draft payroll takes it.';
    final first = managerRole == 'team_lead' ? 'your team lead' : (managerRole == 'department_head' ? 'your head of department' : 'your direct manager');
    return status == 'with_manager' ? 'Request sent. It goes to $first, then $hr; each step shows on the request.' : 'Request sent. It goes to $hr; each step shows on the request.';
  }

  // ---------- my corrections ----------
  static const correctionsEyebrow = 'Attendance · Corrections';
  static const correctionsIntro = 'Your attendance corrections, the latest day first, with each step as it is decided.';
  static const noCorrections = 'No corrections yet. Open a day of your attendance that isn’t right to ask for one.';
  static const correctionsFailed = 'Couldn’t load your corrections.';
  static const back = 'Back';
  static const rightTimes = 'The right times';
  static const asOnRecord = 'As on record';
  static String inAt(String at) => 'In at $at';
  static String outAt(String at) => 'Out at $at';
  static const onRecordWhenAsked = 'On record when asked';
  static const noDayOnRecord = 'No day on record';
  static const noCheckInOrOut = 'No check-in or check-out';
  static const absent = 'Absent';
  static const leaveLike = {'rest': 'Rest day', 'holiday': 'Official holiday', 'leave': 'On leave', 'zoho_leave': 'Leave in Zoho only', 'no_check_in': 'No check-in'};
  static String times(String? checkIn, String? checkOut) => '${checkIn ?? 'no check-in'} – ${checkOut ?? 'no check-out'}';
  static const remoteNote = 'Counted as remote work, no longer flagged once approved';
  static const whereItStands = 'Where it stands';
  static const rejectedBecause = 'Why it was rejected';
  static String appliedOn(String when) => 'The day was corrected $when';
  static String sentOn(String when) => 'Sent $when';
  static const correctedByHr = 'Corrected by HR';
  static const everyStep = 'Every step';
  static const statusLabels = {'with_manager': 'With the manager', 'with_hr': 'With HR', 'approved': 'Approved', 'rejected': 'Rejected', 'cancelled': 'Cancelled'};

  /// Where a correction stands: its status, "With the CEO" for a C-level person's at HR's stage.
  static String statusOfCorrection(String status, {bool confidential = false}) =>
      confidential && status == 'with_hr' ? 'With the CEO' : (statusLabels[status] ?? status);

  static const approverRoles = {'direct_manager': 'Direct manager', 'team_lead': 'Team lead', 'department_head': 'Head of department'};

  /// "With the team lead (Sara Ali)".
  static String withApprover(String? role, String? name) {
    final label = approverRoles[role] ?? approverRoles['direct_manager']!;
    return 'With the ${label[0].toLowerCase()}${label.substring(1)}${name == null ? '' : ' ($name)'}';
  }

  /// A step as its timeline says it.
  static String step(String kind, String? decision, {String? managerRole, bool confidential = false}) {
    switch (kind) {
      case 'submitted':
        return 'Asked for by the employee';
      case 'no_manager':
        return confidential ? 'No direct manager or lead: sent straight to HR’s stage' : 'No direct manager or lead: sent straight to HR';
      case 'recorded_by_hr':
        return 'Corrected by HR directly, approved at once';
      case 'cancelled':
        return 'Cancelled by the employee';
      case 'manager_decision':
      case 'hr_decision':
        if (kind == 'hr_decision' && confidential) return decision == 'reject' ? 'Rejected at HR’s stage' : 'Approved at HR’s stage';
        final label = kind == 'hr_decision' ? 'HR' : 'The ${(approverRoles[managerRole] ?? approverRoles['direct_manager']!).toLowerCase()}';
        return decision == 'reject' ? '$label rejected it' : '$label approved it';
      default:
        return kind;
    }
  }

  static String standingIn(String name) => 'standing in for $name';
  static const cancelTitle = 'Cancel the correction';
  static const cancelBody = 'While it is being decided you can cancel it, e.g. to ask again with other times. The day stays as it is.';
  static String cancelAsk(String day) => 'Cancel the correction of $day?';
  static const keepIt = 'Keep it';
  static const cancelIt = 'Cancel it';
  static const cancelling = 'Cancelling…';
  static const cancelled = 'Correction cancelled. It stays on the list, cancelled; the day is as it was.';
  static const movedOn = 'This correction has moved on since you opened it, or can’t be applied now: it shows where it stands, and why.';

  // ---------- dates and hours as attendance shows them ----------
  static const _weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  static const _weekdaysShort = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  static const _months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  static DateTime _date(String iso) => DateTime.utc(int.parse(iso.substring(0, 4)), int.parse(iso.substring(5, 7)), int.parse(iso.substring(8, 10)));

  /// 27/10/2026.
  static String dmy(String iso) => iso.length < 10 ? iso : '${iso.substring(8, 10)}/${iso.substring(5, 7)}/${iso.substring(0, 4)}';

  /// Tuesday 27/10/2026.
  static String dayTitle(String iso) => '${_weekdays[_date(iso).weekday - 1]} ${dmy(iso)}';

  /// "Thu 01" over "/10/2026", as a day's row starts.
  static ({String day, String rest}) dayLabel(String iso) => (day: '${_weekdaysShort[_date(iso).weekday - 1]} ${iso.substring(8, 10)}', rest: '/${iso.substring(5, 7)}/${iso.substring(0, 4)}');

  /// Sun, Mon … Sat, the calendar's columns.
  static const weekdayColumns = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /// Thu 1 October 2026, for a screen reader.
  static String dayLong(String iso) {
    final d = _date(iso);
    return '${_weekdaysShort[d.weekday - 1]} ${d.day} ${_months[d.month - 1]} ${d.year}';
  }

  /// October, from "2026-10".
  static String monthOnly(String month) => _months[int.parse(month.substring(5, 7)) - 1];

  /// Hours as attendance shows them, to the minute: 141.93 → "141:56", 0 → "0:00".
  static String hoursText(double h) {
    if (!h.isFinite) return '';
    final minutes = (h.abs() * 60).round();
    return '${h < 0 && minutes > 0 ? '-' : ''}${minutes ~/ 60}:${(minutes % 60).toString().padLeft(2, '0')}';
  }

  static String _trim(double v) {
    final r = (v * 100).round() / 100;
    return r == r.roundToDouble() ? r.toInt().toString() : r.toString();
  }
}
