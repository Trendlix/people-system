import '../../models/leave.dart';
import '../../models/request_forms.dart';
import '../../models/requests.dart';
import 'request_text.dart';
import 'requests_words.dart';

// My Requests' overview (the website's my-requests/history.ts and overview.ts, 30 October 2026, drawn to the owner's
// design): every request of every kind in one list, newest asked first, with where it stands for the All / Approved /
// Waiting filter; the requests asked this year; the share of the annual leave still there; what is left of the other
// types; this month's permission hours. Pure code, tested.

/// One row of Recent requests.
class HistoryRow {
  const HistoryRow({required this.request, required this.title, required this.when, required this.sent, required this.status, required this.state});

  final PeopleRequest request;
  final String title;

  /// The day or days it is for, and how long ("Monday 26/10/2026 · 1 day"); empty for one about no day.
  final String when;

  /// When it was asked ("Sent 26/10/2026", "Recorded by HR 26/10/2026").
  final String sent;
  final String status;
  final RequestState state;

  String get key => '${request.kind.name}:${request.id}';
}

/// A request's row: its title, what it is for, when it was asked, where it stands.
HistoryRow historyRowOf(PeopleRequest r) {
  final title = r is LeaveRequest ? r.typeName : (RequestsWords.kindTitles[r.kind.name] ?? r.kind.name);
  final when = switch (r) {
    LeaveRequest() => '${periodText(r.startDate, r.endDate, halfDay: r.halfDay)}${r.startDate == r.endDate && r.halfDay ? '' : ' · ${daysText(r.days)}'}',
    PermissionRequest() => '${dayWords(r.date)} · ${hoursText(r.hours)}',
    CorrectionRequest() => dayWords(r.date),
    WfhRequest() => dayWords(r.date),
    OdRequest() => odWhenWords(r.startDate, r.endDate, r.fullDay, r.fromTime, r.toTime),
    CompensatoryRequest() => compensatoryDaysLine(r),
    HomeLocationRequest() => homeWhatText(r),
    ReimbursementClaim() => '${r.typeName} · ${egp(r.amount)} · ${dmy(r.expenseDate)}',
    ResignationRequest() => RequestsWords.lastDayOf(dmy(r.ruleLastDay)),
    _ => '',
  };
  final sent = switch (r) {
    ResignationRequest() => RequestsWords.sentOn(dmy(r.sentOn)),
    CorrectionRequest() when r.recordedByHr => RequestsWords.correctedByHrOn(dmyOfMoment(r.createdAt)),
    _ => sentLineOf(r),
  };
  return HistoryRow(request: r, title: title, when: when, sent: sent, status: statusLabelOf(r), state: stateOf(r));
}

/// Every request in one list, newest asked first; each once.
List<HistoryRow> historyRows(Iterable<PeopleRequest> requests) {
  final seen = <String>{};
  final rows = [
    for (final r in requests)
      if (seen.add('${r.kind.name}:${r.id}')) historyRowOf(r),
  ];
  rows.sort((a, b) {
    final at = b.request.createdAt.compareTo(a.request.createdAt);
    return at != 0 ? at : b.key.compareTo(a.key);
  });
  return rows;
}

/// All, Approved, Waiting.
enum HistoryFilter { all, approved, waiting }

List<HistoryRow> filterHistory(List<HistoryRow> rows, HistoryFilter show) => switch (show) {
  HistoryFilter.all => rows,
  HistoryFilter.approved => [for (final r in rows) if (r.state == RequestState.approved) r],
  HistoryFilter.waiting => [for (final r in rows) if (r.state == RequestState.waiting) r],
};

String emptyHistoryText(HistoryFilter show) => switch (show) {
  HistoryFilter.all => RequestsWords.emptyAll,
  HistoryFilter.approved => RequestsWords.emptyApproved,
  HistoryFilter.waiting => RequestsWords.emptyWaiting,
};

/// The requests asked this year (sent in it, on the phone's clock) and where they stand, in the figure's note: "Both
/// requests approved", "3 approved · 1 waiting · 1 closed", "None asked for yet".
({int count, String note}) yearSummary(List<HistoryRow> rows, int year) {
  final mine = [
    for (final r in rows)
      if (DateTime.tryParse(r.request.createdAt)?.toLocal().year == year) r,
  ];
  final count = mine.length;
  final approved = mine.where((r) => r.state == RequestState.approved).length;
  final waiting = mine.where((r) => r.state == RequestState.waiting).length;
  final closed = count - approved - waiting;
  final String note;
  if (count == 0) {
    note = RequestsWords.noneAskedYet;
  } else if (approved == count) {
    note = count == 1 ? RequestsWords.approvedOne : (count == 2 ? RequestsWords.bothApproved : RequestsWords.allApproved);
  } else {
    note = [
      if (approved > 0) RequestsWords.approvedCount(approved),
      if (waiting > 0) RequestsWords.waitingCount(waiting),
      if (closed > 0) RequestsWords.closedCount(closed),
    ].join(' · ');
  }
  return (count: count, note: note);
}

/// The figure as the design writes it, two digits: "02", "14".
String twoDigits(int n) => n >= 0 && n < 10 ? '0$n' : '$n';

/// The share of the year's annual leave still available, 0 to 1: the days available of the entitlement with what was
/// carried in and HR's adjustments.
double annualShareLeft(AnnualBalance a) {
  final total = a.year;
  if (total <= 0) return 0;
  return (a.available / total).clamp(0, 1).toDouble();
}

/// "90%".
String percentText(double share) => '${(share * 100).round()}%';

/// The other types the cards show: not the annual leave itself (the figure above); a type off for new requests only once
/// used.
List<TypeBalance> otherLeaveTypes(LeaveBalances b, List<LeaveType>? types) => [
  for (final t in b.types)
    if (types?.where((x) => x.id == t.typeId).firstOrNull case final type)
      if (type?.balance != 'annual' && (type?.active != false || t.used > 0)) t,
];

/// An other type's figure, large, and what it is of: the days left of its own a year ("6", "of 7 days left this year"),
/// the times left in service ("2", "of 3 times left in service"), or the days used this year ("0", "days used this
/// year"). The design's "Full" and "Open" have nothing behind them in People: these are what People knows.
({String value, String note}) otherLeaveFigure(TypeBalance b, LeaveType? type) {
  if (b.left != null) {
    final yearly = b.daysPerYear ?? type?.daysPerYear;
    return (
      value: daysNumber(b.left!),
      note: yearly != null ? RequestsWords.ofDaysLeftThisYear(daysNumber(yearly), yearly) : RequestsWords.daysLeftThisYear(b.left!),
    );
  }
  if (type?.maxTimesInService != null) {
    final max = type!.maxTimesInService!;
    final left = max - b.timesInService;
    return (value: '${left < 0 ? 0 : left}', note: RequestsWords.ofTimesLeftInService(max));
  }
  return (value: daysNumber(b.used), note: RequestsWords.daysUsedThisYear(b.used));
}

/// The permission figure: this month's hours left as a clock ("3:30") and what of; off when Leave Setup gives none.
({String value, String note, bool off}) permissionFigure(PermissionMonth m) {
  if (m.hoursPerMonth <= 0) return (value: RequestsWords.permissionOffValue, note: RequestsWords.permissionOff, off: true);
  return (value: clockHours(m.left), note: RequestsWords.ofHoursThisMonth(clockHours(m.hoursPerMonth)), off: false);
}

/// Whether someone works under the labour law (not a freelancer, not an unpaid intern): leave and permission are theirs.
bool underLabourLaw(String? employmentType) => employmentType != null && employmentType != 'freelance' && employmentType != 'intern';

/// Whether a check-in location may be asked for: a type of the three without a request being decided.
bool asksHome(List<HomeLocationRequest> homes) {
  const types = ['home', 'remote_site', 'client'];
  final open = {
    for (final h in homes)
      if (h.status == 'with_hr' || h.status == 'with_ceo') h.type,
  };
  return types.any((t) => !open.contains(t));
}
