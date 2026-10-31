// What People gives the employee's forms to start a request with (README Phase 2, "faster requests"): the leave types
// and who may cover, the month's permission hours, the work from home allowance, the official duty's and the
// compensatory day's forms, the reimbursement types with what is left of their caps, and the resignation form. Read by
// hand from apps/api's views (apps/web lib/types.ts, wfh-types.ts, od-types.ts, compensatory-types.ts,
// resignation-types.ts, packages/shared leave-coverage.ts); every rule stays People's, these only show it.

import 'requests.dart';

// ---------- leave ----------

/// A type of leave HR set up (GET /api/leave/types), with its rules from the Labour Law.
class LeaveType {
  const LeaveType({
    required this.id,
    required this.key,
    required this.kind,
    required this.nameEn,
    required this.nameAr,
    required this.paid,
    required this.payPercent,
    required this.balance,
    required this.daysPerYear,
    required this.maxPerRequest,
    required this.maxTimesInService,
    required this.minServiceMonths,
    required this.noticeDays,
    required this.documentRequired,
    required this.gender,
    required this.calendarDays,
    required this.halfDays,
    required this.active,
    required this.sortOrder,
  });

  factory LeaveType.fromJson(Object? json) {
    final j = JsonMap(json);
    return LeaveType(
      id: j.str('id'),
      key: j.str('key'),
      kind: j.str('kind', j.str('key')),
      nameEn: j.str('nameEn'),
      nameAr: j.text('nameAr'),
      paid: j.str('paid', 'paid'),
      payPercent: j.numberOrNull('payPercent'),
      balance: j.str('balance', 'none'),
      daysPerYear: j.numberOrNull('daysPerYear'),
      maxPerRequest: j.numberOrNull('maxPerRequest'),
      maxTimesInService: j.integerOrNull('maxTimesInService'),
      minServiceMonths: j.integerOrNull('minServiceMonths'),
      noticeDays: j.integerOrNull('noticeDays'),
      documentRequired: j.flag('documentRequired'),
      gender: j.text('gender'),
      calendarDays: j.flag('calendarDays'),
      halfDays: j.flag('halfDays'),
      active: j.m['active'] != false,
      sortOrder: j.integer('sortOrder'),
    );
  }

  final String id;
  final String key;

  /// annual, casual, sick, … or custom: what the staffing limit and the cover rule go by.
  final String kind;
  final String nameEn;
  final String? nameAr;

  /// paid, unpaid or partly.
  final String paid;
  final double? payPercent;

  /// annual, from_annual, yearly, per_request or none.
  final String balance;
  final double? daysPerYear;
  final double? maxPerRequest;
  final int? maxTimesInService;
  final int? minServiceMonths;
  final int? noticeDays;
  final bool documentRequired;

  /// male, female, or null for everyone.
  final String? gender;
  final bool calendarDays;
  final bool halfDays;
  final bool active;
  final int sortOrder;

  /// It takes from the annual balance (annual leave itself, or casual leave counted against it).
  bool get takesFromAnnual => balance == 'annual' || balance == 'from_annual';
}

List<LeaveType> leaveTypesOf(Object? json) => json is List ? [for (final t in json) LeaveType.fromJson(t)] : const [];

/// A colleague who may cover the leave, or stand in for its employee.
typedef Colleague = ({String id, String name, String? department, String? team, bool sameTeam});

Colleague _colleague(Object? json) {
  final j = JsonMap(json);
  return (id: j.str('id'), name: j.str('fullNameEn'), department: j.text('department'), team: j.text('team'), sameTeam: j.flag('sameTeam'));
}

/// Who is off when, who must cover and who may stand in, for the days a new leave would take
/// (GET /api/me/leave/coverage?from&to&typeId&halfDay).
class LeaveFormCoverage {
  const LeaveFormCoverage({
    required this.leaveDays,
    required this.coverRequired,
    required this.candidates,
    required this.standInNeeded,
    required this.standInDefault,
    required this.standInDefaultHr,
    required this.standInOptions,
    required this.standInHr,
    required this.cLevel,
    required this.group,
    required this.overLimit,
    required this.covering,
  });

  factory LeaveFormCoverage.fromJson(Object? json) {
    final j = JsonMap(json);
    final standIn = j.obj('standIn');
    return LeaveFormCoverage(
      leaveDays: j.numberOrNull('leaveDays'),
      coverRequired: j.obj('cover').flag('required'),
      candidates: j.obj('cover').list('candidates', _colleague),
      standInNeeded: standIn.flag('needed'),
      standInDefault: standIn.obj('default').obj('employee').text('fullNameEn'),
      standInDefaultHr: standIn.obj('default').flag('hr'),
      standInOptions: standIn.list('options', _colleague),
      standInHr: standIn.flag('hr'),
      cLevel: standIn.flag('cLevel'),
      group: j.obj('group').text('nameEn'),
      overLimit: j.flag('overLimit'),
      covering: j.list('covering', (c) {
        final x = JsonMap(c);
        return (name: x.obj('employee').str('fullNameEn'), startDate: x.str('startDate'), endDate: x.str('endDate'), waiting: x.flag('waiting'));
      }),
    );
  }

  /// The days it takes, as the law counts them.
  final double? leaveDays;

  /// Annual or unpaid leave of more than 2 working days names a colleague who covers.
  final bool coverRequired;
  final List<Colleague> candidates;

  /// Whether they decide others' requests, so someone stands in while they are away.
  final bool standInNeeded;
  final String? standInDefault;
  final bool standInDefaultHr;
  final List<Colleague> standInOptions;
  final bool standInHr;
  final bool cLevel;

  /// Their team or department, for "who else is off".
  final String? group;

  /// It would take the team past its staffing limit: HR approves it too.
  final bool overLimit;

  /// Colleagues' leave they cover on these days.
  final List<({String name, String startDate, String endDate, bool waiting})> covering;
}

// ---------- permission ----------

/// A month's permission hours (GET /api/me/permissions/allowance?month=).
class PermissionMonth {
  const PermissionMonth({
    required this.month,
    required this.hoursPerMonth,
    required this.maxHoursPerDay,
    required this.approved,
    required this.pending,
    required this.left,
    required this.days,
  });

  factory PermissionMonth.fromJson(Object? json) {
    final j = JsonMap(json);
    return PermissionMonth(
      month: j.str('month'),
      hoursPerMonth: j.number('hoursPerMonth'),
      maxHoursPerDay: j.number('maxHoursPerDay', 2),
      approved: j.number('approved'),
      pending: j.number('pending'),
      left: j.number('left'),
      days: j.list('days', (d) => (date: JsonMap(d).str('date'), hours: JsonMap(d).number('hours'))),
    );
  }

  /// YYYY-MM.
  final String month;

  /// 0: permission is turned off in Leave Setup.
  final double hoursPerMonth;
  final double maxHoursPerDay;
  final double approved;
  final double pending;
  final double left;

  /// The hours approved and being decided, a day.
  final List<({String date, double hours})> days;

  /// The hours already asked for on a day.
  double usedOn(String date) => days.where((d) => d.date == date).fold(0, (a, d) => a + d.hours);
}

// ---------- work from home ----------

/// The work from home allowance (GET /api/me/wfh/allowance).
class WfhAllowance {
  const WfhAllowance({
    required this.month,
    required this.daysPerMonth,
    required this.minGapDays,
    required this.used,
    required this.taken,
    required this.nextPossible,
    required this.offered,
    required this.refusal,
    required this.today,
  });

  factory WfhAllowance.fromJson(Object? json) {
    final j = JsonMap(json);
    return WfhAllowance(
      month: j.str('month'),
      daysPerMonth: j.integer('daysPerMonth'),
      minGapDays: j.integer('minGapDays', 7),
      used: j.integer('used'),
      taken: j.list('taken', (t) => (date: JsonMap(t).str('date'), status: JsonMap(t).str('status'))),
      nextPossible: j.text('nextPossible'),
      offered: j.flag('offered'),
      refusal: j.text('refusal'),
      today: j.str('today'),
    );
  }

  final String month;

  /// 0: turned off in Leave Setup.
  final int daysPerMonth;

  /// The fewest days between any two.
  final int minGapDays;
  final int used;

  /// The days approved and being decided, around today.
  final List<({String date, String status})> taken;

  /// The first day from tomorrow within the limits; null: none soon.
  final String? nextPossible;

  /// Their arrangement ever expects them at the office.
  final bool offered;

  /// Why they can't ask at all.
  final String? refusal;

  /// Today in Cairo.
  final String today;

  /// Whether they may ask now (the website's offersWfh).
  bool get asks => offered && refusal == null && daysPerMonth > 0;
}

// ---------- official duty and the compensatory day ----------

/// Compensatory Setup: what a rest day or an official holiday worked earns.
class CompensatoryRules {
  const CompensatoryRules({required this.cashRate, required this.minHours, required this.hoursCap, required this.fullDayHours, required this.offWithinDays});

  factory CompensatoryRules.fromJson(Object? json) {
    final j = JsonMap(json);
    return CompensatoryRules(
      cashRate: j.number('cashRate', 1.5),
      minHours: j.number('minHours', 2),
      hoursCap: j.number('hoursCap', 4),
      fullDayHours: j.number('fullDayHours', 6),
      offWithinDays: j.integerOrNull('offWithinDays'),
    );
  }

  /// Days' pay for a whole day, paid in cash instead.
  final double cashRate;

  /// Under these hours, nothing is earned.
  final double minHours;

  /// The most hours off a part day earns.
  final double hoursCap;

  /// From these hours, a whole day.
  final double fullDayHours;

  /// The day off within so many days after the day worked; null: in the same month.
  final int? offWithinDays;
}

typedef NamedDay = ({String date, String name});

NamedDay _namedDay(Object? json) => (date: JsonMap(json).str('date'), name: JsonMap(json).str('nameEn'));

/// The official duty's form (GET /api/me/official-duty/form).
class OdForm {
  const OdForm({
    required this.today,
    required this.earliest,
    required this.shift,
    required this.refusal,
    required this.toCeo,
    required this.workingDays,
    required this.holidays,
    required this.rules,
    required this.hoursADay,
    required this.compensated,
  });

  factory OdForm.fromJson(Object? json) {
    final j = JsonMap(json);
    final shift = j.obj('shift');
    return OdForm(
      today: j.str('today'),
      earliest: j.str('earliest'),
      shift: j.has('shift') ? (startTime: shift.str('startTime'), endTime: shift.str('endTime'), graceMinutes: shift.integer('graceMinutes')) : null,
      refusal: j.text('refusal'),
      toCeo: j.flag('toCeo'),
      workingDays: j.m['workingDays'] is List ? j.ints('workingDays') : const [0, 1, 2, 3, 4],
      holidays: j.list('holidays', _namedDay),
      rules: j.has('rules') ? CompensatoryRules.fromJson(j.m['rules']) : null,
      hoursADay: j.numberOrNull('hoursADay'),
      compensated: j.list('compensated', (c) => (date: JsonMap(c).str('date'), status: JsonMap(c).str('status'))),
    );
  }

  final String today;

  /// The first day it may still be asked for (3 days ago).
  final String earliest;
  final ({String startTime, String endTime, int graceMinutes})? shift;
  final String? refusal;

  /// A C-level person's: the CEO decides after the manager, not HR.
  final bool toCeo;

  /// 0 = Sunday.
  final List<int> workingDays;
  final List<NamedDay> holidays;
  final CompensatoryRules? rules;
  final double? hoursADay;

  /// Rest days and holidays worked already compensated, with the status in words.
  final List<({String date, String status})> compensated;
}

/// A day the day worked is picked from (owner, 31 October 2026: "let the employee pick from a drop menu the eligable day,
/// or choose a future day in the same month only, for upcomming days"): one gone by that qualifies today, or one to come
/// this month (packages/shared compensatoryEligibleDays).
typedef CompensatoryEligibleDay = ({String date, bool upcoming, String? holiday, bool checkedIn});

CompensatoryEligibleDay _eligibleDay(Object? json) {
  final j = JsonMap(json);
  return (date: j.str('date'), upcoming: j.str('when') == 'upcoming', holiday: j.text('holiday'), checkedIn: j.flag('checkedIn'));
}

/// The compensatory day's form (GET /api/me/compensatory/form).
class CompensatoryForm {
  const CompensatoryForm({
    required this.refusal,
    required this.offered,
    required this.today,
    required this.cashDays,
    required this.rules,
    required this.hoursADay,
    required this.workingDays,
    required this.holidays,
    required this.leave,
    required this.other,
    required this.claimed,
    required this.checkedIn,
    required this.from,
    required this.to,
    this.eligibleDays,
  });

  factory CompensatoryForm.fromJson(Object? json) {
    final j = JsonMap(json);
    return CompensatoryForm(
      refusal: j.text('refusal'),
      offered: j.flag('offered'),
      today: j.str('today'),
      cashDays: j.number('cashDays', 1.5),
      rules: CompensatoryRules.fromJson(j.m['rules']),
      hoursADay: j.numberOrNull('hoursADay'),
      workingDays: j.m['workingDays'] is List ? j.ints('workingDays') : const [0, 1, 2, 3, 4],
      holidays: j.list('holidays', _namedDay),
      leave: j.list('leave', (l) => (date: JsonMap(l).str('date'), type: JsonMap(l).str('type'), status: JsonMap(l).str('status'))),
      other: j.list('other', (o) => (date: JsonMap(o).str('date'), what: JsonMap(o).str('what'))),
      claimed: j.strings('claimed'),
      checkedIn: j.strings('checkedIn'),
      from: j.str('from'),
      to: j.str('to'),
      eligibleDays: j.m['eligibleDays'] is List ? j.list('eligibleDays', _eligibleDay) : null,
    );
  }

  final String? refusal;
  final bool offered;
  final String today;
  final double cashDays;

  /// Compensatory Setup's (its defaults when People sends none).
  final CompensatoryRules rules;
  final double? hoursADay;
  final List<int> workingDays;
  final List<NamedDay> holidays;

  /// Days of leave, approved or being decided, one row a day.
  final List<({String date, String type, String status})> leave;

  /// Days taken otherwise: "a work from home day", "a compensatory day off", "an official duty".
  final List<({String date, String what})> other;

  /// Days worked already claimed.
  final List<String> claimed;

  /// Days with a check-in kept.
  final List<String> checkedIn;
  final String from;
  final String to;

  /// The days the day worked is picked from, worked then to come; null from a People from before them.
  final List<CompensatoryEligibleDay>? eligibleDays;

  bool get asks => offered && refusal == null;
}

// ---------- reimbursement ----------

/// A type of expense the employee may claim (GET /api/me/reimbursement-types?expenseDate=), with what its caps have
/// taken in the expense's month and year.
class ReimbursementType {
  const ReimbursementType({
    required this.id,
    required this.nameEn,
    required this.nameAr,
    required this.description,
    required this.receiptRequired,
    required this.capPerClaim,
    required this.capPerMonth,
    required this.capPerYear,
    required this.claimWithinDays,
    required this.usedInMonth,
    required this.usedInYear,
  });

  factory ReimbursementType.fromJson(Object? json) {
    final j = JsonMap(json);
    return ReimbursementType(
      id: j.str('id'),
      nameEn: j.str('nameEn'),
      nameAr: j.text('nameAr'),
      description: j.text('description'),
      receiptRequired: j.flag('receiptRequired'),
      capPerClaim: j.numberOrNull('capPerClaim'),
      capPerMonth: j.numberOrNull('capPerMonth'),
      capPerYear: j.numberOrNull('capPerYear'),
      claimWithinDays: j.integerOrNull('claimWithinDays'),
      usedInMonth: j.number('usedInMonth'),
      usedInYear: j.number('usedInYear'),
    );
  }

  final String id;
  final String nameEn;
  final String? nameAr;
  final String? description;
  final bool receiptRequired;

  /// EGP; null: no cap.
  final double? capPerClaim;
  final double? capPerMonth;
  final double? capPerYear;

  /// Claimed within so many days of the expense; null: no deadline.
  final int? claimWithinDays;
  final double usedInMonth;
  final double usedInYear;

  /// The most that may be claimed now, under every cap; null: no cap.
  double? get most {
    final caps = [
      ?capPerClaim,
      if (capPerMonth != null) (capPerMonth! - usedInMonth).clamp(0, double.infinity).toDouble(),
      if (capPerYear != null) (capPerYear! - usedInYear).clamp(0, double.infinity).toDouble(),
    ];
    return caps.isEmpty ? null : caps.reduce((a, b) => a < b ? a : b);
  }
}

List<ReimbursementType> reimbursementTypesOf(Object? json) => json is List ? [for (final t in json) ReimbursementType.fromJson(t)] : const [];

// ---------- resignation ----------

/// The resignation form (GET /api/me/resignation's `form`).
class ResignationForm {
  const ResignationForm({required this.offered, required this.refusal, required this.today, required this.notice, required this.lastDayIfToday});

  factory ResignationForm.fromJson(Object? json) {
    final j = JsonMap(json);
    return ResignationForm(offered: j.flag('offered'), refusal: j.text('refusal'), today: j.str('today'), notice: j.text('notice'), lastDayIfToday: j.text('lastDayIfToday'));
  }

  final bool offered;
  final String? refusal;
  final String today;

  /// "3 months": the resignation rule's notice.
  final String? notice;

  /// The last working day the notice gives if it is sent today.
  final String? lastDayIfToday;
}

/// One's resignation requests and the form (GET /api/me/resignation).
class MyResignation {
  const MyResignation({required this.requests, required this.form});

  factory MyResignation.fromJson(Object? json) {
    final j = JsonMap(json);
    return MyResignation(requests: requestsOf<ResignationRequest>(RequestKind.resignation, j.m['requests']), form: ResignationForm.fromJson(j.m['form']));
  }

  final List<ResignationRequest> requests;
  final ResignationForm form;
}
