import 'requests.dart' show JsonMap;

// Timesheets as People sends them (owner, 4 November 2026: "Timesheet in app/website", "Direct manager, weekly";
// packages/shared timesheets.ts MyTimesheetView, TimesheetWeekView, TimesheetListItem), read by hand: only what the app
// shows, every field checked for its type.

/// A week's status: not sent yet, waiting for approval, approved, rejected; null while nothing is saved for it.
enum TimesheetStatus { draft, submitted, approved, rejected }

TimesheetStatus? timesheetStatusOf(String? s) => switch (s) {
  'draft' => TimesheetStatus.draft,
  'submitted' => TimesheetStatus.submitted,
  'approved' => TimesheetStatus.approved,
  'rejected' => TimesheetStatus.rejected,
  _ => null,
};

/// A client account to log hours against: those they work on first.
class TimesheetClient {
  const TimesheetClient({required this.id, required this.name, required this.assigned});

  factory TimesheetClient.fromJson(Object? json) {
    final j = JsonMap(json);
    return TimesheetClient(id: j.str('id'), name: j.str('name'), assigned: j.flag('assigned'));
  }

  final String id;
  final String name;
  final bool assigned;
}

/// A line: a day's hours against a client, a task, or both; a note.
class TimesheetLine {
  const TimesheetLine({required this.date, required this.hours, this.clientId, this.clientName, this.task, this.note});

  factory TimesheetLine.fromJson(Object? json) {
    final j = JsonMap(json);
    final client = j.obj('client');
    return TimesheetLine(
      date: j.str('date'),
      hours: j.number('hours'),
      clientId: client.text('id'),
      clientName: client.text('name'),
      task: j.text('task'),
      note: j.text('note'),
    );
  }

  final String date;
  final double hours;
  final String? clientId;
  final String? clientName;
  final String? task;
  final String? note;

  /// What it is for, in a line: "Acme · Shoot day", "Acme", "Editing".
  String get what => [?clientName, ?task].join(' · ');

  /// As PUT /api/me/timesheet takes it.
  Map<String, Object?> toJson() => {'date': date, 'clientAccountId': clientId, 'task': task, 'hours': hours, 'note': note};
}

/// A week of someone's hours.
class TimesheetWeek {
  TimesheetWeek.read(JsonMap j)
    : id = j.text('id'),
      employeeName = j.obj('employee').str('fullNameEn'),
      weekStart = j.str('weekStart'),
      weekEnd = j.str('weekEnd'),
      status = timesheetStatusOf(j.text('status')),
      lines = j.list('entries', TimesheetLine.fromJson),
      totalHours = j.number('totalHours'),
      days = j.list('days', (d) {
        final x = JsonMap(d);
        return (date: x.str('date'), hours: x.number('hours'));
      }),
      submittedAt = j.text('submittedAt'),
      decidedAt = j.text('decidedAt'),
      decidedBy = j.text('decidedBy'),
      rejectReason = j.text('rejectReason'),
      approverName = j.obj('approver').text('fullNameEn'),
      waitingForYou = j.flag('waitingForYou'),
      canEdit = j.obj('can').flag('edit'),
      canSubmit = j.obj('can').flag('submit'),
      canDecide = j.obj('can').flag('decide');

  factory TimesheetWeek.fromJson(Object? json) => TimesheetWeek.read(JsonMap(json));

  /// None while nothing is saved for the week yet.
  final String? id;
  final String employeeName;
  final String weekStart;
  final String weekEnd;
  final TimesheetStatus? status;
  final List<TimesheetLine> lines;
  final double totalHours;

  /// Each day of the week and its hours, Sunday first.
  final List<({String date, double hours})> days;
  final String? submittedAt;
  final String? decidedAt;
  final String? decidedBy;
  final String? rejectReason;

  /// Who approves it; null: HR.
  final String? approverName;
  final bool waitingForYou;
  final bool canEdit;
  final bool canSubmit;
  final bool canDecide;

  /// The lines of a day.
  List<TimesheetLine> linesOn(String date) => [for (final l in lines) if (l.date == date) l];
}

/// GET /api/me/timesheet: the week, why they can't log hours (null: they do), the clients, the earlier weeks not sent.
class MyTimesheet extends TimesheetWeek {
  MyTimesheet.read(super.j) : refusal = j.text('refusal'), clients = j.list('clients', TimesheetClient.fromJson), unsent = j.strings('unsent'), super.read();

  factory MyTimesheet.fromJson(Object? json) => MyTimesheet.read(JsonMap(json));

  final String? refusal;
  final List<TimesheetClient> clients;

  /// The earlier weeks not sent yet, or rejected: their Sundays, newest first.
  final List<String> unsent;
}

/// A week in the approver's list.
class TimesheetListItem {
  const TimesheetListItem({required this.id, required this.employeeName, required this.weekStart, required this.weekEnd, required this.totalHours, required this.waitingForYou});

  factory TimesheetListItem.fromJson(Object? json) {
    final j = JsonMap(json);
    return TimesheetListItem(
      id: j.str('id'),
      employeeName: j.obj('employee').str('fullNameEn'),
      weekStart: j.str('weekStart'),
      weekEnd: j.str('weekEnd'),
      totalHours: j.number('totalHours'),
      waitingForYou: j.flag('waitingForYou'),
    );
  }

  final String id;
  final String employeeName;
  final String weekStart;
  final String weekEnd;
  final double totalHours;
  final bool waitingForYou;
}
