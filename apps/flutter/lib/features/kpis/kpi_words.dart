import '../../format.dart';
import '../../models/kpi.dart';

// The KPI screens' words (owner, 31 October 2026: "employees and managers can perform the KPI's from the mobile app"),
// as the People website words them (apps/web kpis/scorecard.ts, mine.ts, mine-ui.tsx, team/page.tsx and the
// scorecard's page and forms), so the app and the website say the same. One place, ready for Arabic.

abstract final class KpiWords {
  // ---------- My KPIs ----------
  static const eyebrow = 'People System · Performance';
  static const myTitle = 'My KPIs';
  static const myIntro = 'Your monthly scorecard, built from your job description: rate yourself, see your score at the sign-off, and sign it.';
  static const yourTurn = 'Your turn';
  static const waitingForYou = 'Waiting for you';
  static const rateIntro = 'Pick how you did on each metric, with a comment if you like. Your manager sees it when scoring.';
  static const signIntro = 'Read the score, the picks and the comments, then sign that you have read it.';
  static const yourScorecards = 'Your scorecards';
  static const history = 'History';
  static const noneTitle = 'Your first scorecard isn’t open yet.';
  static const noneText = 'A month’s scorecard opens on the 1st of the next month once HR has published the KPI template for your job title.';
  static const noneNotify = 'You get a notification when it opens.';
  static const noScore = 'No score';
  static const shownAtSignOff = 'Shown at the sign-off';
  static const selfMissedShort = 'Self-rating missed';
  static const unsignedShort = 'Final without every signature';
  static const howItWorks = 'How it works';
  static const reviewProcess = 'Monthly review process';
  static const payTiming = "Last month's KPI counts in this month's pay.";
  static const notLoaded = 'Couldn’t load your scorecards.';
  static const tryAgain = 'Try again';
  static const back = 'Back';

  // ---------- Team KPIs ----------
  static const teamTitle = 'Team KPIs';
  static const teamIntro =
      'The monthly KPI scorecards of the people you are in charge of. Each person rates themself first; you score the month, seeing their self-rating; HR calibrates it; then you both sign that you have read it. A missed self-rating doesn’t hold up your scoring.';
  static const teamRow = 'Your people’s scorecards';
  static const teamWaitingIntro = 'Score the month, or sign that you have read it as the manager.';
  static const month = 'Month';
  static const teamNotLoaded = 'Couldn’t load the scorecards.';
  static String teamWaitingOf(int n) => n == 1 ? '1 waiting for you' : '$n waiting for you';
  static String scorecardsOf(String month) => 'Scorecards of $month';
  static String noTeamScorecards(String month) =>
      'No scorecards of your people for $month. They open on the 1st of the next month for everyone whose job title has a published template.';
  static String scorecardsCount(int n) => n == 1 ? '1 scorecard' : '$n scorecards';

  // ---------- a scorecard ----------
  static const scorecard = 'KPI scorecard';
  static const notYours = 'This scorecard isn’t yours to see.';
  static const yours = 'Yours';
  static const yourStep = 'Your step';
  static const about = 'About this scorecard';
  static const scoredBy = 'Scored by';
  static const whereItStands = 'Where it stands';
  static const finalAndLocked = 'Final and locked';
  static const selfMissed = 'The self-rating was missed: not sent by its day.';
  static const deadlines = 'Deadlines';
  static const pay = 'Pay';
  static const payNote = 'Its final % is the KPI that payroll’s variable part follows.';
  static const signatures = 'Signatures';
  static const template = 'Template';
  static const practice = 'Practice';
  static const practiceBanner = 'Practice: not counted anywhere';
  static const practiceNote =
      'Nobody is told of it, no deadline holds a step back, and it never reaches payroll, the payslips, the KPI figures or the Excel. The employee and their manager never see it in their own sign-in.';
  static const cLevel = 'C-level';
  static const calibrateOnWebsite = 'HR’s calibration is taken on the People website, where every pick can be changed with its reason.';
  static const comments = 'Comments';
  static const noComments = 'No comments yet.';
  static const everyStep = 'Every step';
  static const noSteps = 'No steps logged yet.';
  static const target = 'Target';
  static const selfRating = 'Self-rating';
  static const managerTag = 'Manager';
  static const calibratedByHr = 'Calibrated by HR';
  static const notPicked = 'not picked';
  static const howMeasured = 'How it’s measured:';
  static const measures = 'Measures:';
  static const automatic = 'Automatic';
  static const attendanceMetric = 'Attendance';
  static const attendanceAbout = 'The month’s worked hours against the expected, as payroll counts them. Filled in by the system; nobody picks it.';
  static const noMetrics = 'No metrics in this pillar.';
  static const notScored = 'Not scored';
  static const comment = 'Comment';
  static const optional = '(optional)';
  static const addComment = 'Add a comment';
  static const pickHowYouDid = 'Pick how you did';
  static const pickOne = 'Pick one';
  static const workedOut = 'Worked out as you pick.';
  static const cappedNote = 'Capped at 110%.';
  static const neededToSend = '(needed to send)';
  static const sendSelf = 'Send self-rating';
  static const sendScoring = 'Send scoring';
  static const save = 'Save';
  static const sending = 'Sending…';
  static const saving = 'Saving…';
  static const signing = 'Signing…';
  static const iveReadIt = 'I’ve read it';
  static const cancel = 'Cancel';
  static const signYours = 'Sign your scorecard';
  static const signAsManager = 'Sign as the manager';
  static const signEmployeeText = 'Read the scorecard above: the score, the picks and the comments. Signing says you have read it.';
  static const signManagerText = 'Read the scorecard as it goes to the employee. Signing says you have read it, as their manager.';
  static const readyToSend = 'Every metric is picked: ready to send.';
  static const writeComments = 'Write your comments: how the month went and the areas of focus.';
  static const moved = 'This scorecard has moved on since you opened it. It shows where it stands now.';
  static const scoreTitle = 'Score';
  static const finalScore = 'Final score';
  static const yourSelfRating = 'Your self-rating';
  static const yourScoring = 'Your scoring';
  static const selfRatingTitle = 'Self-rating';
  static const managersBeforeHr = 'The manager’s scoring, before HR’s calibration.';
  static const ownSelfNote = 'Your own rating. The score that counts shows here from the sign-off.';
  static const othersSelfNote = 'The employee’s own rating; not scored yet.';
  static const ownNoScore = 'The score that counts shows here from the sign-off.';
  static const notScoredYet = 'Not scored yet.';
  static const performanceOnly = 'The KPI is performance only: attendance is cut on the fixed part.';
  static const commentSelfLabel = 'Your comment on the month';
  static const commentSelfHint = 'What went well, and what held you back. Your manager reads it.';
  static const commentScoreLabel = 'Your comments and areas of focus';
  static const commentScoreHint = 'What went well, and what to focus on next month. The employee reads it at the sign-off.';
  static const confirmSelf = 'Send your self-rating? You can’t change it once it is sent.';
  static String confirmScore(String name) => 'Send your scoring of $name? You can’t change it once it is sent.';
  static String upTo(int n) => 'Up to $n characters.';
  static String stillToPick(List<String> names) => 'Pick a criterion for every metric to send it. Still to pick: ${names.join(', ')}.';
  static String waitsForSelf(String date) => 'The self-rating is due by $date. Save your scoring now; send it once the self-rating is in, or after that day.';
  static String notPickedYet(int n) => '${n == 1 ? 'One metric' : '$n metrics'} not picked yet: ${n == 1 ? 'it counts' : 'they count'} 0 until picked.';
  static String selfLine(KpiScoreResult s) => 'Self-rating: ${kpiPercentText(s.finalPercent)} · ${s.levelLabel}.';
  static String hrChanged(int n) => 'HR changed ${n == 1 ? 'one pick' : '$n picks'}, each with its reason.';
  static String pillarHead(int number, double weight) => 'Pillar $number · weight ${_number(weight)}%';
  static String ofPoints(double max) => 'of ${pointsText(max)}';
  static String leftOutText(double weight) => 'Not scored: attendance is out of the KPI, so this pillar’s ${_number(weight)}% is spread over the other pillars.';
  static String signNote(String deadline) => 'Not signed by $deadline, it is final anyway, and that is noted.';
  static String version(int n) => 'Version $n';
}

// ---------- the website's wording, as functions (apps/web kpis/scorecard.ts) ----------

/// "35", "2.5".
String _number(double n) => oneDecimal(n);

/// "35 pts", "1 pt".
String pointsText(double n) => '${_number(n)} ${n == 1 ? 'pt' : 'pts'}';

/// A day as the website shows it: 03/11/2026.
String kpiDate(String iso) {
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(iso);
  return m == null ? iso : '${m[3]}/${m[2]}/${m[1]}';
}

/// A moment as the website shows it: "29/10/2026, 10:15 AM" (the phone's clock).
String kpiDateTime(String iso) {
  final at = DateTime.tryParse(iso)?.toLocal();
  if (at == null) return iso;
  final h = at.hour % 12 == 0 ? 12 : at.hour % 12;
  final date = '${at.day.toString().padLeft(2, '0')}/${at.month.toString().padLeft(2, '0')}/${at.year}';
  return '$date, $h:${at.minute.toString().padLeft(2, '0')} ${at.hour < 12 ? 'AM' : 'PM'}';
}

/// People's messages with any date still written YYYY-MM-DD as the screens show it.
String kpiMessage(String message) => message.replaceAllMapped(RegExp(r'\b(\d{4})-(\d{2})-(\d{2})\b'), (m) => '${m[3]}/${m[2]}/${m[1]}');

/// A percent ("86%", "89.6%"); a dash when there is none.
String percentText(double? percent) => percent == null ? '—' : kpiPercentText(percent);

/// What the caller may do, as its button says it.
const kpiActionLabels = {'self_rate': 'Rate yourself', 'score': 'Score', 'calibrate': 'Calibrate', 'sign': 'Sign'};

/// Where a scorecard stands, by who scores it: "With the manager", or with HR, the CEO or a Super Admin.
String statusText(String status, String scorer) {
  if (status != 'manager') return kpiStatusLabels[status] ?? status;
  if (scorer == 'hr') return 'With HR';
  if (scorer == 'ceo') return 'With the CEO';
  if (scorer == 'super_admin') return 'With a Super Admin';
  return kpiStatusLabels['manager']!;
}

/// Who scores it: "Sara Ali (manager)", "HR", "The CEO".
String scorerText(String kind, String? name) {
  switch (kind) {
    case 'manager':
      return name != null ? '$name (manager)' : 'The manager';
    case 'hr':
      return name != null ? '$name (HR)' : 'HR: nobody is in charge of this person';
    case 'ceo':
      return name != null ? '$name (the CEO)' : 'The CEO';
    case 'super_admin':
      return name != null ? '$name (Super Admin)' : 'A Super Admin';
    default:
      return name ?? kind;
  }
}

String _scorerSubject(String scorer) => scorer == 'manager' ? 'Your manager' : (scorer == 'hr' ? 'HR' : (scorer == 'ceo' ? 'The CEO' : 'A Super Admin'));

/// What the caller is to do on it, and by when: "Score by 06/11/2026", "Rate yourself by 03/11/2026"; null: nothing.
String? actionText(KpiScorecard s) {
  final action = s.action;
  if (action == null) return null;
  final date = s.deadline == null ? null : kpiDate(s.deadline!);
  if (action == 'score' && s.status == 'self_rating') return date != null ? 'Self-rating due $date, then score' : 'Score once the self-rating is in';
  return '${kpiActionLabels[action] ?? action}${date != null ? ' by $date' : ''}';
}

/// The button on a row waiting for the caller: Rate yourself, Score, Calibrate, Sign; Open otherwise.
String actionButton(KpiScorecard s) => s.action == null ? 'Open' : (kpiActionLabels[s.action] ?? 'Open');

/// The employee's own card: "Your October 2026 KPI: rate yourself by 03/11/2026".
String ownCardText(KpiScorecard s) {
  final head = 'Your ${monthNameOf(s.month)} KPI${s.practice ? ' (practice)' : ''}';
  final by = s.deadline == null ? '' : ' by ${kpiDate(s.deadline!)}';
  if (s.action == 'self_rate') return '$head: rate yourself$by';
  if (s.action == 'sign') return '$head: ready to sign$by';
  return head;
}

/// A scorecard waiting in a list, in a line: "October 2026 · Score by 06/11/2026".
String waitingLine(KpiScorecard s) => [if (s.practice) KpiWords.practice, monthNameOf(s.month), ?actionText(s)].join(' · ');

/// The deadline of the step it is at (the step's own day); null once final.
String? stepDeadline(String status, KpiDeadlines d) => switch (status) {
  'self_rating' => d.selfRating,
  'manager' => d.manager,
  'hr' => d.hr,
  'sign_off' => d.signOff,
  _ => null,
};

/// The step it is at and by when ("Scoring by 06/11/2026"); null once final.
String? stepDeadlineText(String status, KpiDeadlines d) {
  final deadline = stepDeadline(status, d);
  if (deadline == null) return null;
  final date = kpiDate(deadline);
  return switch (status) {
    'self_rating' => 'Self-rating by $date',
    'manager' => 'Scoring by $date',
    'hr' => "HR's calibration by $date",
    'sign_off' => 'Sign-off by $date; final then even if not signed',
    _ => null,
  };
}

/// "Counts in the November 2026 payroll".
String payrollText(String payrollMonth) => 'Counts in the ${monthNameOf(payrollMonth)} payroll';

/// The Attendance metric in words: where it was read, and the month's hours and score.
({String source, String detail}) attendanceText(KpiAttendance a) {
  final source = a.source == 'payroll' ? "From the month's payroll line" : (a.source == 'attendance' ? "From the month's attendance" : 'Not counted: full points');
  if (a.ratio == null && a.score == null) return (source: source, detail: "Attendance isn't counted for this month, so it counts as full.");
  final parts = [
    if (a.ratio != null) 'Worked ${kpiPercentText(a.ratio! * 100)} of the expected hours',
    if (a.score != null) 'attendance score ${kpiPercentText(a.score! * 100)}',
  ].join(', ');
  return (source: source, detail: '${parts[0].toUpperCase()}${parts.substring(1)}.');
}

/// A pick in words: "No delays · 35 pts"; null for none.
String? pickText(KpiMetric m, int? choice) => choice != null && choice >= 0 && choice < m.criteria.length ? '${m.criteria[choice].label} · ${pointsText(m.criteria[choice].points)}' : null;

/// The criterion worth the metric's target (its 100%), marked on the scale; -1 when none is.
int targetIndex(KpiMetric m) => m.criteria.indexWhere((c) => c.points == m.targetPoints);

/// The pick that counts as the caller sees it: HR's change, else the manager's.
int? countedChoice(KpiMetric m) => m.hr?.choice ?? m.manager?.choice;

/// The step a review has, with the day it is due by (the KPI settings; null when they couldn't be read).
List<({String title, String text, String? due})> reviewSteps(KpiSettings? s) {
  String? due(int? day) => day == null ? null : 'By the ${ordinalDay(day)}';
  return [
    (title: 'Self-rating', text: 'From the 1st of the next month, you pick how you did on each metric, with a comment if you like.', due: due(s?.selfRatingDay)),
    (title: 'Manager’s scoring', text: 'Your manager scores the month, seeing your self-rating.', due: due(s?.managerDay)),
    (title: 'HR calibration', text: 'HR checks the scoring and may change a pick, giving the reason.', due: due(s?.hrDay)),
    (title: 'Sign-off', text: 'You see the score, then you both sign that you have read it.', due: due(s?.signOffDay)),
  ];
}

/// "1st", "2nd", "3rd", "11th", "21st".
String ordinalDay(int day) {
  final tens = day % 100;
  if (tens >= 11 && tens <= 13) return '${day}th';
  final unit = day % 10;
  return '$day${unit == 1 ? 'st' : (unit == 2 ? 'nd' : (unit == 3 ? 'rd' : 'th'))}';
}

/// What a page says once a step is done, and in which tone (the website's doneText).
({String text, bool ok}) doneText(String done, KpiScorecardView v) {
  final d = v.deadlines;
  switch (done) {
    case 'self_saved':
      return (text: 'Your self-rating is saved, not sent yet. Send it by ${kpiDate(d.selfRating)}.', ok: true);
    case 'self_sent':
      return (text: 'Your self-rating is sent. ${_scorerSubject(v.card.scorerKind)} scores the month next; you see the score at the sign-off.', ok: true);
    case 'score_saved':
      return (text: 'Your scoring is saved, not sent yet. Send it by ${kpiDate(d.manager)}.', ok: true);
    case 'score_sent':
      return (
        text: v.card.status == 'hr' ? 'Your scoring is sent to HR to calibrate.' : 'Your scoring is sent. The scorecard is ready for the employee and the manager to sign.',
        ok: true,
      );
    case 'signed':
      return (text: v.card.status == 'final' ? 'Signed. The scorecard is final.' : 'Signed. It is final once both have signed, or after ${kpiDate(d.signOff)} anyway.', ok: true);
    default:
      return (text: KpiWords.moved, ok: false);
  }
}

/// The scorecard month of a day: the month before it (kpiScorecardMonthOn).
String scorecardMonthOn(String today) {
  final y = int.parse(today.substring(0, 4)), m = int.parse(today.substring(5, 7));
  return m == 1 ? '${y - 1}-12' : '$y-${(m - 1).toString().padLeft(2, '0')}';
}
