// One's own requests, as People sends them to the employee (README Phase 2, "faster requests"; the phone design's
// Requests tab, 30 October 2026): leave, permission, attendance corrections, working from home, official duty,
// compensatory days, check-in locations, reimbursements and the resignation. Each kind's view is apps/api's own
// (apps/web lib/types.ts, correction-types.ts, wfh-types.ts, od-types.ts, compensatory-types.ts, home-location-types.ts,
// resignation-types.ts), read by hand: only what the app shows, every field checked for its type.

/// Reads one JSON object by hand: a field of the wrong type reads as missing.
class JsonMap {
  JsonMap(Object? json) : m = json is Map ? json : const {};

  final Map m;

  String str(String key, [String or = '']) => m[key] is String ? m[key] as String : or;

  /// Text that says something; null when missing or blank.
  String? text(String key) {
    final v = m[key];
    return v is String && v.trim().isNotEmpty ? v : null;
  }

  double number(String key, [double or = 0]) => m[key] is num ? (m[key] as num).toDouble() : or;
  double? numberOrNull(String key) => m[key] is num ? (m[key] as num).toDouble() : null;
  int integer(String key, [int or = 0]) => m[key] is num ? (m[key] as num).toInt() : or;
  int? integerOrNull(String key) => m[key] is num ? (m[key] as num).toInt() : null;
  bool flag(String key) => m[key] == true;
  JsonMap obj(String key) => JsonMap(m[key]);
  bool has(String key) => m[key] is Map;
  List<T> list<T>(String key, T Function(Object?) read) => m[key] is List ? [for (final v in m[key] as List) read(v)] : <T>[];
  List<String> strings(String key) => m[key] is List ? (m[key] as List).whereType<String>().toList() : const [];
  List<int> ints(String key) => m[key] is List ? (m[key] as List).whereType<num>().map((n) => n.toInt()).toList() : const [];
}

/// The kinds of request the tab lists and starts.
enum RequestKind { leave, permission, correction, wfh, od, compensatory, home, claim, resignation }

/// Who decides first: the direct manager, else the team lead, else the head of the department.
class Approver {
  const Approver({required this.id, required this.name, required this.role});

  static Approver? of(Object? json) {
    if (json is! Map) return null;
    final j = JsonMap(json);
    return Approver(id: j.str('id'), name: j.str('fullNameEn'), role: j.text('role') ?? 'direct_manager');
  }

  final String id;
  final String name;

  /// direct_manager, team_lead or department_head (a missing one counts as the direct manager).
  final String role;
}

/// A step of a request: sent, a decision, cancelled, recorded by HR, added to the payroll…
class RequestStep {
  const RequestStep({
    required this.kind,
    required this.decision,
    required this.comment,
    required this.actor,
    required this.onBehalfOf,
    required this.at,
    this.amount,
    this.payMonth,
    this.radiusMetres,
  });

  factory RequestStep.fromJson(Object? json) {
    final j = JsonMap(json);
    return RequestStep(
      kind: j.str('kind'),
      decision: j.text('decision'),
      comment: j.text('comment'),
      actor: j.text('actor'),
      onBehalfOf: j.obj('onBehalfOf').text('fullNameEn'),
      at: j.str('at'),
      amount: j.numberOrNull('amount'),
      payMonth: j.text('payMonth'),
      radiusMetres: j.integerOrNull('radiusMetres'),
    );
  }

  final String kind;

  /// approve, approve_other (a lower amount) or reject; null for a step that isn't a decision.
  final String? decision;
  final String? comment;

  /// Who took it (a display name); null for the system's own steps.
  final String? actor;

  /// Whom the actor stood in for.
  final String? onBehalfOf;

  /// When, ISO.
  final String at;

  /// A claim's amount at the step (claimed, approved, added to the payroll).
  final double? amount;
  final String? payMonth;

  /// A check-in location's radius at the step.
  final int? radiusMetres;
}

/// A file kept with a request: a leave's document, a claim's receipt, a resignation's letter.
class RequestFile {
  const RequestFile({required this.id, required this.fileName, required this.mimeType, required this.sizeBytes});

  factory RequestFile.fromJson(Object? json) {
    final j = JsonMap(json);
    return RequestFile(
      id: j.str('id'),
      fileName: j.text('fileName') ?? j.str('letterFileName'),
      mimeType: j.str('mimeType'),
      sizeBytes: j.integer('sizeBytes'),
    );
  }

  final String id;
  final String fileName;
  final String mimeType;
  final int sizeBytes;
}

/// What every kind of request shares: who it is from, where it stands, who decides, every step.
abstract class PeopleRequest {
  PeopleRequest.read(JsonMap j)
    : id = j.str('id'),
      status = j.str('status'),
      createdAt = j.str('createdAt'),
      canCancel = j.flag('canCancel'),
      confidential = j.flag('confidential'),
      recordedByHr = j.flag('recordedByHr'),
      manager = Approver.of(j.m['manager']),
      rejectedStage = j.text('rejectedStage'),
      rejectReason = j.text('rejectReason'),
      steps = j.list('steps', RequestStep.fromJson),
      warnings = j.strings('warnings'),
      employeeName = j.obj('employee').str('fullNameEn'),
      department = j.obj('employee').text('department'),
      team = j.obj('employee').text('team');

  RequestKind get kind;

  final String id;

  /// with_manager, with_hr, approved, rejected, cancelled (and each kind's own: with_finance, with_ceo, sent…).
  final String status;

  /// When it was sent, ISO.
  final String createdAt;

  /// Whether its employee may cancel (or withdraw) it now, as People says.
  final bool canCancel;

  /// A C-level person's: HR's stage is the CEO's.
  final bool confidential;
  final bool recordedByHr;

  /// Who decides first; null: nobody, it went straight to HR.
  final Approver? manager;
  final String? rejectedStage;
  final String? rejectReason;
  final List<RequestStep> steps;

  /// What HR recorded it past.
  final List<String> warnings;
  final String employeeName;
  final String? department;
  final String? team;
}

// ---------- leave ----------

class LeaveRequest extends PeopleRequest {
  LeaveRequest._(super.j)
    : typeId = j.obj('type').str('id'),
      typeKey = j.obj('type').str('key'),
      typeName = j.obj('type').str('nameEn'),
      typeNameAr = j.obj('type').text('nameAr'),
      paid = j.obj('type').str('paid', 'paid'),
      startDate = j.str('startDate'),
      endDate = j.str('endDate'),
      halfDay = j.flag('halfDay'),
      days = j.number('days'),
      reason = j.text('reason'),
      documents = j.list('documents', RequestFile.fromJson),
      balanceAfter = j.numberOrNull('balanceAfter'),
      cover = j.obj('cover').text('fullNameEn'),
      handoverNote = j.text('handoverNote'),
      overStaffingLimit = j.flag('overStaffingLimit'),
      standIn = j.has('standIn') ? j.obj('standIn').obj('employee').text('fullNameEn') : null,
      standInHr = j.obj('standIn').flag('hr'),
      super.read();

  factory LeaveRequest.fromJson(Object? json) => LeaveRequest._(JsonMap(json));

  @override
  RequestKind get kind => RequestKind.leave;

  final String typeId;
  final String typeKey;
  final String typeName;
  final String? typeNameAr;

  /// paid, unpaid or partly.
  final String paid;
  final String startDate;
  final String endDate;
  final bool halfDay;
  final double days;
  final String? reason;
  final List<RequestFile> documents;

  /// For leave from the annual balance: what is available once this is taken.
  final double? balanceAfter;
  final String? cover;
  final String? handoverNote;
  final bool overStaffingLimit;
  final String? standIn;
  final bool standInHr;
}

// ---------- permission ----------

class PermissionRequest extends PeopleRequest {
  PermissionRequest._(super.j)
    : date = j.str('date'),
      hours = j.number('hours'),
      fromTime = j.text('fromTime'),
      toTime = j.text('toTime'),
      reason = j.text('reason'),
      monthLeft = j.numberOrNull('monthLeft'),
      super.read();

  factory PermissionRequest.fromJson(Object? json) => PermissionRequest._(JsonMap(json));

  @override
  RequestKind get kind => RequestKind.permission;

  final String date;
  final double hours;

  /// HH:MM, as given or worked out.
  final String? fromTime;
  final String? toTime;
  final String? reason;

  /// What is left of its month's hours, with it counted.
  final double? monthLeft;
}

// ---------- attendance correction ----------

/// The day as it was shown when the correction was asked for.
typedef CorrectionDayBefore = ({String status, String? checkIn, String? checkOut, String source});

class CorrectionRequest extends PeopleRequest {
  CorrectionRequest._(super.j)
    : date = j.str('date'),
      correctionKind = j.str('correctionKind'),
      checkIn = j.text('checkIn'),
      checkOut = j.text('checkOut'),
      reason = j.str('reason'),
      dayBefore = j.has('dayBefore')
          ? (
              status: j.obj('dayBefore').str('status'),
              checkIn: j.obj('dayBefore').text('checkIn'),
              checkOut: j.obj('dayBefore').text('checkOut'),
              source: j.obj('dayBefore').str('source', 'zoho'),
            )
          : null,
      appliedAt = j.text('appliedAt'),
      super.read();

  factory CorrectionRequest.fromJson(Object? json) => CorrectionRequest._(JsonMap(json));

  @override
  RequestKind get kind => RequestKind.correction;

  final String date;

  /// forgot_check_in, forgot_check_out, wrong_time or worked_remotely.
  final String correctionKind;

  /// The right moments asked for, ISO; null: as on record.
  final String? checkIn;
  final String? checkOut;
  final String reason;
  final CorrectionDayBefore? dayBefore;

  /// When approval changed the day.
  final String? appliedAt;
}

// ---------- work from home ----------

class WfhRequest extends PeopleRequest {
  WfhRequest._(super.j) : date = j.str('date'), reason = j.text('reason'), monthUsed = j.integerOrNull('monthUsed'), source = j.str('source', 'system'), super.read();

  factory WfhRequest.fromJson(Object? json) => WfhRequest._(JsonMap(json));

  @override
  RequestKind get kind => RequestKind.wfh;

  final String date;
  final String? reason;

  /// Its month's days taken (approved and being decided), this one counted.
  final int? monthUsed;

  /// system, or zoho (imported).
  final String source;
}

// ---------- official duty ----------

/// A rest day's or an official holiday's compensation carried by an official duty.
typedef OdCompensation = ({String id, String status, String outcome, String? dayOff, double? hoursWorked, double? hoursOff});

class OdRequest extends PeopleRequest {
  OdRequest._(super.j)
    : startDate = j.str('startDate'),
      endDate = j.str('endDate'),
      fullDay = j.m['fullDay'] != false,
      fromTime = j.text('fromTime'),
      toTime = j.text('toTime'),
      dutyPlace = j.str('dutyPlace'),
      reason = j.str('reason'),
      late = j.flag('late'),
      imported = j.flag('imported'),
      compensation = j.has('compensation')
          ? (
              id: j.obj('compensation').str('id'),
              status: j.obj('compensation').str('status'),
              outcome: j.obj('compensation').str('outcome', 'day_off'),
              dayOff: j.obj('compensation').text('dayOff'),
              hoursWorked: j.obj('compensation').numberOrNull('hoursWorked'),
              hoursOff: j.obj('compensation').numberOrNull('hoursOff'),
            )
          : null,
      super.read();

  factory OdRequest.fromJson(Object? json) => OdRequest._(JsonMap(json));

  @override
  RequestKind get kind => RequestKind.od;

  final String startDate;
  final String endDate;
  final bool fullDay;
  final String? fromTime;
  final String? toTime;
  final String dutyPlace;
  final String reason;

  /// Asked after its first day ("requested after").
  final bool late;
  final bool imported;
  final OdCompensation? compensation;
}

// ---------- compensatory day ----------

class CompensatoryRequest extends PeopleRequest {
  CompensatoryRequest._(super.j)
    : dayWorked = j.str('dayWorked'),
      dayOff = j.text('dayOff'),
      reason = j.text('reason'),
      outcome = j.text('outcome'),
      cashDays = j.number('cashDays', 1.5),
      hoursWorked = j.numberOrNull('hoursWorked'),
      hoursOff = j.numberOrNull('hoursOff'),
      od = j.has('od') ? (id: j.obj('od').str('id'), startDate: j.obj('od').str('startDate'), status: j.obj('od').str('status')) : null,
      noCheckIn = j.flag('noCheckIn'),
      super.read();

  factory CompensatoryRequest.fromJson(Object? json) => CompensatoryRequest._(JsonMap(json));

  @override
  RequestKind get kind => RequestKind.compensatory;

  final String dayWorked;
  final String? dayOff;
  final String? reason;

  /// HR's decision once approved: day_off or cash.
  final String? outcome;
  final double cashDays;

  /// Null: the whole day.
  final double? hoursWorked;
  final double? hoursOff;

  /// Carried by an official duty: decided and cancelled with it.
  final ({String id, String startDate, String status})? od;
  final bool noCheckIn;
}

// ---------- check-in location ----------

class HomeLocationRequest extends PeopleRequest {
  HomeLocationRequest._(super.j)
    : type = j.text('type') ?? 'home',
      reason = j.text('reason'),
      wishedEndDate = j.text('wishedEndDate'),
      validity = j.text('validity'),
      validUntil = j.text('validUntil'),
      endsOn = j.text('endsOn'),
      inForce = j.m['inForce'] is bool ? j.m['inForce'] as bool : null,
      latitude = j.numberOrNull('latitude'),
      longitude = j.numberOrNull('longitude'),
      label = j.text('label'),
      radiusMetres = j.integer('radiusMetres', 100),
      accuracyMetres = j.numberOrNull('accuracyMetres'),
      canWithdraw = j.flag('canWithdraw'),
      canRemove = j.flag('canRemove'),
      approvedAt = j.text('approvedAt'),
      endedAt = j.text('endedAt'),
      locationName = j.obj('location').text('name'),
      locationEndedAt = j.obj('location').text('endedAt'),
      super.read();

  factory HomeLocationRequest.fromJson(Object? json) => HomeLocationRequest._(JsonMap(json));

  @override
  RequestKind get kind => RequestKind.home;

  /// home, remote_site or client.
  final String type;
  final String? reason;
  final String? wishedEndDate;

  /// until_date, contract or no_end; null until HR sets it.
  final String? validity;
  final String? validUntil;
  final String? endsOn;
  final bool? inForce;

  /// Only while it is open or approved; null once its point is deleted.
  final double? latitude;
  final double? longitude;
  final String? label;
  final int radiusMetres;

  /// Null: put on the map, not read on a device.
  final double? accuracyMetres;
  final bool canWithdraw;
  final bool canRemove;
  final String? approvedAt;
  final String? endedAt;
  final String? locationName;
  final String? locationEndedAt;

  /// Approved but no longer counting.
  bool get ended => status == 'approved' && inForce == false;
}

// ---------- reimbursement ----------

class ReimbursementClaim extends PeopleRequest {
  ReimbursementClaim._(super.j)
    : typeId = j.obj('type').str('id'),
      typeName = j.obj('type').str('nameEn'),
      typeNameAr = j.obj('type').text('nameAr'),
      receiptRequired = j.obj('type').flag('receiptRequired'),
      expenseDate = j.str('expenseDate'),
      amount = j.number('amount'),
      approvedAmount = j.numberOrNull('approvedAmount'),
      description = j.str('description'),
      payMonth = j.text('payMonth'),
      payrollStatus = j.obj('payroll').text('status'),
      payrollMonth = j.obj('payroll').text('runMonth'),
      receipts = j.list('receipts', RequestFile.fromJson),
      super.read();

  factory ReimbursementClaim.fromJson(Object? json) => ReimbursementClaim._(JsonMap(json));

  @override
  RequestKind get kind => RequestKind.claim;

  final String typeId;
  final String typeName;
  final String? typeNameAr;
  final bool receiptRequired;
  final String expenseDate;

  /// EGP, as claimed.
  final double amount;

  /// As last approved at any stage; final once approved.
  final double? approvedAmount;
  final String description;
  final String? payMonth;

  /// pending, applied or cancelled, once Finance added it to a payroll.
  final String? payrollStatus;
  final String? payrollMonth;
  final List<RequestFile> receipts;
}

// ---------- resignation ----------

class ResignationRequest extends PeopleRequest {
  ResignationRequest._(super.j)
    : statusLabel = j.str('statusLabel'),
      reason = j.text('reason'),
      preferredLastDay = j.text('preferredLastDay'),
      sentOn = j.str('sentOn'),
      notice = j.str('notice'),
      ruleLastDay = j.str('ruleLastDay'),
      letter = j.has('letter') ? RequestFile.fromJson(j.m['letter']) : null,
      withdrawnAt = j.text('withdrawnAt'),
      returnedReason = j.obj('returned').text('reason'),
      returnedAt = j.obj('returned').text('at'),
      recordedAt = j.obj('recorded').text('at'),
      mine = j.m['mine'] != false,
      super.read();

  factory ResignationRequest.fromJson(Object? json) => ResignationRequest._(JsonMap(json));

  @override
  RequestKind get kind => RequestKind.resignation;

  /// sent, recorded, withdrawn or returned, and People's words for it.
  final String statusLabel;
  final String? reason;
  final String? preferredLastDay;

  /// The notice received day.
  final String sentOn;

  /// "3 months": the resignation rule's notice when it was sent.
  final String notice;

  /// The last working day that notice gives from the day it was sent.
  final String ruleLastDay;
  final RequestFile? letter;
  final String? withdrawnAt;
  final String? returnedReason;
  final String? returnedAt;
  final String? recordedAt;
  final bool mine;

  /// Withdrawn by its employee only while HR hasn't recorded it.
  bool get canWithdraw => mine && status == 'sent';
}

/// A kind's request from People's JSON.
PeopleRequest requestOf(RequestKind kind, Object? json) => switch (kind) {
  RequestKind.leave => LeaveRequest.fromJson(json),
  RequestKind.permission => PermissionRequest.fromJson(json),
  RequestKind.correction => CorrectionRequest.fromJson(json),
  RequestKind.wfh => WfhRequest.fromJson(json),
  RequestKind.od => OdRequest.fromJson(json),
  RequestKind.compensatory => CompensatoryRequest.fromJson(json),
  RequestKind.home => HomeLocationRequest.fromJson(json),
  RequestKind.claim => ReimbursementClaim.fromJson(json),
  RequestKind.resignation => ResignationRequest.fromJson(json),
};

/// A list of a kind's requests (anything but a list reads as none).
List<T> requestsOf<T extends PeopleRequest>(RequestKind kind, Object? json) => json is List ? [for (final r in json) requestOf(kind, r) as T] : <T>[];
