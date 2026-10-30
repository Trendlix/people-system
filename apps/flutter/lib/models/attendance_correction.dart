// An attendance correction as People sends it to its employee (GET /api/me/attendance/corrections, POST
// /api/me/attendance/corrections; apps/api correction-views.ts `correctionView`, apps/web lib/correction-types.ts
// `AttendanceCorrectionView`): its day, what was wrong, the right times asked for, why, what was on record then, where it
// stands and every step. Read by hand.

/// The day as it was when the correction was asked for.
class DayBefore {
  const DayBefore({required this.status, required this.checkIn, required this.checkOut, required this.source});

  static DayBefore? of(Object? json) {
    if (json is! Map) return null;
    return DayBefore(
      status: _text(json['status']) ?? '',
      checkIn: _moment(json['checkIn']),
      checkOut: _moment(json['checkOut']),
      source: _text(json['source']) ?? 'zoho',
    );
  }

  final String status;
  final DateTime? checkIn;
  final DateTime? checkOut;
  final String source;
}

/// A step of a correction: sent, a decision, cancelled, recorded by HR.
class CorrectionStep {
  const CorrectionStep({required this.kind, required this.decision, required this.comment, required this.actor, required this.onBehalfOf, required this.at});

  static CorrectionStep? of(Object? json) {
    if (json is! Map) return null;
    final at = _moment(json['at']);
    if (at == null) return null;
    final behalf = json['onBehalfOf'];
    return CorrectionStep(
      kind: _text(json['kind']) ?? '',
      decision: _text(json['decision']),
      comment: _text(json['comment']),
      actor: _text(json['actor']),
      onBehalfOf: behalf is Map ? _text(behalf['fullNameEn']) : null,
      at: at,
    );
  }

  /// submitted, no_manager, recorded_by_hr, manager_decision, hr_decision or cancelled.
  final String kind;

  /// approve or reject, for a decision.
  final String? decision;
  final String? comment;

  /// Who took it, by name.
  final String? actor;

  /// The approver on leave a stand-in decided it for.
  final String? onBehalfOf;
  final DateTime at;
}

class AttendanceCorrection {
  const AttendanceCorrection({
    required this.id,
    required this.date,
    required this.kind,
    required this.checkIn,
    required this.checkOut,
    required this.reason,
    required this.dayBefore,
    required this.status,
    required this.canCancel,
    required this.confidential,
    required this.managerName,
    required this.managerRole,
    required this.rejectReason,
    required this.recordedByHr,
    required this.appliedAt,
    required this.steps,
    required this.createdAt,
  });

  factory AttendanceCorrection.fromJson(Object? json) {
    if (json is! Map) throw const FormatException('AttendanceCorrection: not an object');
    final id = _text(json['id']);
    final date = _text(json['date']);
    if (id == null || date == null) throw const FormatException('AttendanceCorrection: no id or day');
    final manager = json['manager'];
    final steps = json['steps'];
    return AttendanceCorrection(
      id: id,
      date: date,
      kind: _text(json['correctionKind']) ?? '',
      checkIn: _moment(json['checkIn']),
      checkOut: _moment(json['checkOut']),
      reason: _text(json['reason']) ?? '',
      dayBefore: DayBefore.of(json['dayBefore']),
      status: _text(json['status']) ?? '',
      canCancel: json['canCancel'] == true,
      confidential: json['confidential'] == true,
      managerName: manager is Map ? _text(manager['fullNameEn']) : null,
      managerRole: manager is Map ? _text(manager['role']) ?? 'direct_manager' : null,
      rejectReason: _text(json['rejectReason']),
      recordedByHr: json['recordedByHr'] == true,
      appliedAt: _moment(json['appliedAt']),
      steps: steps is List ? [for (final s in steps) ?CorrectionStep.of(s)] : const [],
      createdAt: _moment(json['createdAt']),
    );
  }

  final String id;

  /// YYYY-MM-DD.
  final String date;

  /// forgot_check_in, forgot_check_out, wrong_time or worked_remotely.
  final String kind;

  /// The right moments asked for; null: as on record.
  final DateTime? checkIn;
  final DateTime? checkOut;
  final String reason;

  /// The day as it was when asked; null: no day on record.
  final DayBefore? dayBefore;

  /// with_manager, with_hr, approved, rejected or cancelled.
  final String status;
  final bool canCancel;

  /// A C-level person's: the CEO decides HR's stage.
  final bool confidential;

  /// Who it went to first (null: none, sent straight to HR), and as what (direct_manager, team_lead, department_head).
  final String? managerName;
  final String? managerRole;
  final String? rejectReason;
  final bool recordedByHr;

  /// When its approval changed the day.
  final DateTime? appliedAt;
  final List<CorrectionStep> steps;
  final DateTime? createdAt;

  bool get open => status == 'with_manager' || status == 'with_hr';
}

/// The employee's corrections, as People lists them (the latest day first).
List<AttendanceCorrection> correctionsOf(Object? json) => json is List ? [for (final c in json) AttendanceCorrection.fromJson(c)] : const [];

String? _text(Object? v) => v is String && v.trim().isNotEmpty ? v.trim() : null;
DateTime? _moment(Object? v) => v is String ? DateTime.tryParse(v) : null;
