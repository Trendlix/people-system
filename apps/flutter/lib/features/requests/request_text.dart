import '../../format.dart';
import '../../models/requests.dart';
import 'requests_words.dart';

// How requests read, as People's website writes them (apps/web lib/format.ts, leave/list.ts, leave/permissions.ts,
// lib/confidential.ts, lib/department-leads.ts): dates as DD/MM/YYYY, times on a 12-hour clock, days and hours in words,
// money in EGP, where a request stands and each of its steps. Pure code, tested.

const _weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

DateTime? _dayOf(String iso) => RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(iso) ? DateTime.tryParse('${iso}T00:00:00Z') : null;

/// 26/10/2026, from 2026-10-26.
String dmy(String iso) {
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(iso);
  return m == null ? iso : '${m[3]}/${m[2]}/${m[1]}';
}

/// Monday, for 2026-10-26; 0 = Sunday.
String weekdayName(String iso) {
  final d = _dayOf(iso);
  return d == null ? '' : _weekdays[d.weekday % 7];
}

/// Monday 26/10/2026.
String dayWords(String iso) => '${weekdayName(iso)} ${dmy(iso)}'.trim();

/// 26/10/2026, the day a moment (ISO) falls on, on the phone's clock.
String dmyOfMoment(String moment) {
  final t = DateTime.tryParse(moment);
  return t == null ? moment : dmy(isoDayOf(t));
}

/// 26/10/2026, 9:05 AM, on the phone's clock.
String dateTimeWords(String moment) {
  final t = DateTime.tryParse(moment)?.toLocal();
  if (t == null) return moment;
  return '${dmy(isoDayOf(t))}, ${time12('${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}')}';
}

/// 5:00 PM, from 17:00.
String time12(String hhmm) {
  final m = RegExp(r'^(\d{1,2}):(\d{2})').firstMatch(hhmm);
  if (m == null) return hhmm;
  final h = int.parse(m[1]!);
  return '${h % 12 == 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}';
}

/// 9:05 AM, the time of a moment (ISO) on the phone's clock.
String timeOfMoment(String moment) {
  final t = DateTime.tryParse(moment)?.toLocal();
  return t == null ? moment : time12(clockOf(t));
}

/// 1, 2.5: days without a needless ".0".
String daysNumber(double days) {
  final r = (days * 10).round() / 10;
  return r == r.roundToDouble() ? r.toInt().toString() : r.toString();
}

/// Half a day, 1 day, 2.5 days.
String daysText(double days) => days == 0.5 ? 'Half a day' : '${daysNumber(days)} ${days == 1 ? 'day' : 'days'}';

/// 2 hours, 1 hour 30 minutes, 30 minutes (permission's hours).
String hoursText(double hours) {
  final minutes = (hours < 0 ? 0 : hours * 60).round();
  final h = minutes ~/ 60;
  final m = minutes % 60;
  final hText = '$h ${h == 1 ? 'hour' : 'hours'}';
  if (m == 0) return hText;
  final mText = '$m ${m == 1 ? 'minute' : 'minutes'}';
  return h == 0 ? mText : '$hText $mText';
}

/// 4 hours, 3.5 hours, 1 hour (the compensatory day's).
String hoursShort(double hours) {
  final r = (hours * 100).round() / 100;
  final n = r == r.roundToDouble() ? r.toInt().toString() : r.toString();
  return '$n ${r == 1 ? 'hour' : 'hours'}';
}

/// 1:30, for 1.5 hours.
String clockHours(double hours) {
  final minutes = (hours.abs() * 60).round();
  return '${hours < 0 && minutes > 0 ? '-' : ''}${minutes ~/ 60}:${(minutes % 60).toString().padLeft(2, '0')}';
}

/// EGP 16,700.00.
String egp(double amount) {
  final fixed = amount.abs().toStringAsFixed(2);
  final parts = fixed.split('.');
  final whole = parts[0].replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
  return 'EGP ${amount < 0 ? '-' : ''}$whole.${parts[1]}';
}

/// 240 KB, 1.2 MB.
String sizeText(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).round()} KB';
  return '${(bytes / 1024 / 1024).toStringAsFixed(1)} MB';
}

/// People's words as the website shows them: its dates as DD/MM/YYYY, its times on a 12-hour clock.
String shownMessage(String message) => message
    .replaceAllMapped(RegExp(r'\b(\d{4})-(\d{2})-(\d{2})\b'), (m) => '${m[3]}/${m[2]}/${m[1]}')
    .replaceAll('as HH:MM', 'as a 12-hour time')
    .replaceAllMapped(RegExp(r'\b([01]\d|2[0-3]):([0-5]\d)\b'), (m) => time12('${m[1]}:${m[2]}'));

// ---------- where a request stands ----------

/// Approved (or recorded, done), being decided, or closed otherwise: the filter's and the badge's reading.
enum RequestState { approved, waiting, closed }

RequestState stateOf(PeopleRequest r) => switch (r) {
  HomeLocationRequest() => r.status == 'approved' ? RequestState.approved : (r.status == 'with_hr' || r.status == 'with_ceo' ? RequestState.waiting : RequestState.closed),
  ReimbursementClaim() => r.status == 'approved' ? RequestState.approved : (r.status == 'rejected' || r.status == 'cancelled' ? RequestState.closed : RequestState.waiting),
  ResignationRequest() => r.status == 'recorded' ? RequestState.approved : (r.status == 'sent' ? RequestState.waiting : RequestState.closed),
  _ => r.status == 'approved' ? RequestState.approved : (r.status == 'with_manager' || r.status == 'with_hr' ? RequestState.waiting : RequestState.closed),
};

/// The status as the badge says it: "With the CEO" for a C-level person's at HR's (or Finance's) stage.
String statusLabelOf(PeopleRequest r) {
  if (r is ResignationRequest && r.statusLabel.isNotEmpty) return r.statusLabel;
  if (r is HomeLocationRequest && r.ended) return RequestsWords.ended;
  if (r.confidential && (r.status == 'with_hr' || r.status == 'with_finance')) return RequestsWords.withTheCeo;
  return RequestsWords.statusLabels[r.status] ?? r.status;
}

/// Direct manager, Team lead, Head of department.
String approverLabel(Approver? m) => RequestsWords.approverLabels[m?.role] ?? RequestsWords.approverLabels['direct_manager']!;

/// the direct manager, the team lead, the head of department.
String approverPhrase(Approver? m) {
  final l = approverLabel(m);
  return 'the ${l[0].toLowerCase()}${l.substring(1)}';
}

/// your direct manager, your team lead…
String yourApprover(Approver? m) => approverPhrase(m).replaceFirst('the ', 'your ');

/// The direct manager, The team lead… (a step's subject).
String _approverSubject(Approver? m) {
  final p = approverPhrase(m);
  return p[0].toUpperCase() + p.substring(1);
}

/// Where a leave-like request stands (leave, permission, correction, work from home, official duty, compensatory day),
/// and the reason given for a rejection or a cancellation.
({String text, String? reason}) progressOf(PeopleRequest r) {
  switch (r.status) {
    case 'with_manager':
      return (text: RequestsWords.withApprover(approverPhrase(r.manager), r.manager?.name), reason: null);
    case 'with_hr':
      return (text: RequestsWords.waitingFor(RequestsWords.hrStage(r.confidential)), reason: null);
    case 'rejected':
      if (r.rejectedStage == 'hr' && r.confidential) return (text: 'Rejected ${RequestsWords.atHrStage}', reason: r.rejectReason);
      final who = r.rejectedStage == 'manager' ? approverPhrase(r.manager) : (r.rejectedStage == 'hr' ? 'HR' : null);
      return (text: who == null ? RequestsWords.rejected : RequestsWords.rejectedBy(who), reason: r.rejectReason);
    case 'cancelled':
      final step = r.steps.lastWhere((s) => s.kind == 'cancelled', orElse: () => const RequestStep(kind: '', decision: null, comment: null, actor: null, onBehalfOf: null, at: ''));
      return (text: step.actor == null ? RequestsWords.cancelled : RequestsWords.cancelledBy(step.actor!), reason: step.comment);
    default:
      return (text: r.recordedByHr ? RequestsWords.recordedByHr : RequestsWords.approved, reason: null);
  }
}

/// A leave-like request's step in words; each kind words its own steps over this (cancelled, imported…).
String stepTextOf(RequestStep s, Approver? manager, bool confidential) {
  switch (s.kind) {
    case 'submitted':
      return RequestsWords.stepSubmitted;
    case 'no_manager':
      return confidential ? RequestsWords.stepNoManagerCeo : RequestsWords.stepNoManager;
    case 'recorded_by_hr':
      return RequestsWords.stepRecordedByHr;
    case 'manager_decision':
    case 'hr_decision':
      if (s.kind == 'hr_decision' && confidential) return s.decision == 'reject' ? RequestsWords.stepRejectedAtHr : RequestsWords.stepApprovedAtHr;
      final who = s.kind == 'manager_decision' ? _approverSubject(manager) : 'HR';
      return s.decision == 'reject' ? RequestsWords.stepRejected(who) : RequestsWords.stepApproved(who);
    case 'cancelled':
      return RequestsWords.stepCancelled;
    case 'cover_changed':
      return RequestsWords.stepCoverChanged;
    case 'edited':
      return RequestsWords.stepEdited;
    case 'restored':
      return RequestsWords.stepRestored;
    case 'imported':
      return RequestsWords.stepImported;
    default:
      return s.kind;
  }
}

/// Who took a step, and when: "Sara Ali, standing in for Omar Adel · 26/10/2026, 9:05 AM".
String stepWhoLine(RequestStep s) {
  final who = [
    if (s.actor != null) s.actor!,
    if (s.onBehalfOf != null) RequestsWords.standingIn(s.onBehalfOf!),
  ].join(', ');
  final when = s.at.isEmpty ? '' : dateTimeWords(s.at);
  return [if (who.isNotEmpty) who, if (when.isNotEmpty) when].join(' · ');
}

/// Once a leave-like request is sent: where it goes next.
String sentTextOf(PeopleRequest r) {
  final hr = RequestsWords.hrStage(r.confidential);
  if (r.status == 'approved') return RequestsWords.sentApprovedAtOnce;
  if (r.status == 'with_manager') return RequestsWords.sentGoesTo(yourApprover(r.manager), hr);
  return RequestsWords.sentGoesToHr(hr);
}

/// "Sent 26/10/2026", or "Recorded by HR 26/10/2026".
String sentLineOf(PeopleRequest r) => r.recordedByHr ? RequestsWords.recordedByHrOn(dmyOfMoment(r.createdAt)) : RequestsWords.sentOn(dmyOfMoment(r.createdAt));

/// The days a leave is for: "Monday 26/10/2026 · half a day", "26/10/2026 – 28/10/2026".
String periodText(String start, String end, {bool halfDay = false}) =>
    start == end ? '${dayWords(start)}${halfDay ? ' · half a day' : ''}' : '${dmy(start)} – ${dmy(end)}';

/// 5:00 PM – 7:00 PM, from 5:00 PM, until 7:00 PM; null without times.
String? timesText(String? from, String? to) {
  if (from != null && to != null) return '${time12(from)} – ${time12(to)}';
  if (from != null) return 'from ${time12(from)}';
  if (to != null) return 'until ${time12(to)}';
  return null;
}

/// Monday 26/10/2026, 10:00 AM–2:00 PM; Sunday 01/11/2026 – Tuesday 03/11/2026 (an official duty's days).
String odWhenWords(String start, String end, bool fullDay, String? from, String? to) {
  if (start != end) return '${dayWords(start)} – ${dayWords(end)}';
  if (!fullDay && from != null && to != null) return '${dayWords(start)}, ${time12(from)}–${time12(to)}';
  return dayWords(start);
}

/// "Worked Friday 06/11/2026 · day off Tuesday 10/11/2026" (a compensatory day's days).
String compensatoryDaysLine(CompensatoryRequest r) {
  final worked = 'Worked ${dayWords(r.dayWorked)}${r.hoursWorked != null ? ' (${hoursShort(r.hoursWorked!)})' : ''}';
  if (r.outcome == 'cash') return '$worked · paid in cash instead';
  if (r.dayOff == null) return worked;
  return '$worked · ${r.hoursOff != null ? '${hoursShort(r.hoursOff!)} off' : 'day off'} ${dayWords(r.dayOff!)}';
}

/// "Home location", or "Remote site: Studio · 100 m" (a check-in location).
String homeWhatText(HomeLocationRequest r) {
  final lead = r.type == 'home' ? '' : '${RequestsWords.homeTypes[r.type] ?? r.type}: ';
  if (r.latitude == null) return '$lead${RequestsWords.pointDeleted}';
  return '$lead${r.label ?? RequestsWords.pointOnMap} · ${r.radiusMetres} m';
}

/// The month after a day (YYYY-MM-DD) plus some days, as YYYY-MM-DD.
String addDays(String iso, int days) {
  final d = _dayOf(iso);
  return d == null ? iso : d.add(Duration(days: days)).toIso8601String().substring(0, 10);
}

/// Whole days from one day to another.
int daysBetween(String from, String to) {
  final a = _dayOf(from);
  final b = _dayOf(to);
  return a == null || b == null ? 0 : b.difference(a).inDays;
}

/// 0 = Sunday, for a day.
int weekdayIndex(String iso) => (_dayOf(iso)?.weekday ?? 7) % 7;

/// The first working day of the shift from [today] on that isn't an official holiday (today itself when it is one); a
/// fortnight on at most.
String nextWorkingDay(String today, List<int> workingDays, Set<String> holidays) {
  for (var i = 0; i < 14; i++) {
    final d = addDays(today, i);
    if (workingDays.contains(weekdayIndex(d)) && !holidays.contains(d)) return d;
  }
  return today;
}

/// A day as a DateTime at midnight, local, for the date picker.
DateTime? pickerDay(String? iso) {
  if (iso == null) return null;
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(iso);
  return m == null ? null : DateTime(int.parse(m[1]!), int.parse(m[2]!), int.parse(m[3]!));
}

/// Today, YYYY-MM-DD, on the phone's clock.
String todayIso() => isoDayOf(DateTime.now());
