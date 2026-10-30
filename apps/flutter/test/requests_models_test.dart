import 'package:flutter_test/flutter_test.dart';
import 'package:people/features/requests/history.dart';
import 'package:people/features/requests/kinds/leave.dart';
import 'package:people/features/requests/request_text.dart';
import 'package:people/models/leave.dart';
import 'package:people/models/request_forms.dart';
import 'package:people/models/requests.dart';

import 'requests_fixtures.dart';

// The requests as People sends them, read by hand (README: no code generation), and how the Requests tab words them
// and counts them, as the website's My Requests does (apps/web my-requests history.ts, overview.ts; leave list.ts).

void main() {
  group('reading People’s requests', () {
    test('a leave request: its type, days, approver, documents and steps', () {
      final r = LeaveRequest.fromJson({
        ...leaveJson(status: 'with_manager'),
        'documents': [
          {'id': 'd1', 'fileName': 'note.pdf', 'mimeType': 'application/pdf', 'sizeBytes': 120000},
        ],
        'cover': {'id': 'c-omar', 'fullNameEn': 'Omar Adel'},
        'standIn': {'employee': null, 'hr': true},
      });
      expect(r.kind, RequestKind.leave);
      expect(r.typeName, 'Annual leave');
      expect(r.typeKey, 'annual');
      expect(r.days, 3);
      expect(r.status, 'with_manager');
      expect(r.manager?.name, 'Sara Ali');
      expect(r.manager?.role, 'direct_manager');
      expect(r.canCancel, isTrue);
      expect(r.documents.single.fileName, 'note.pdf');
      expect(r.cover, 'Omar Adel');
      expect(r.standIn, isNull);
      expect(r.standInHr, isTrue);
      expect(r.balanceAfter, 16);
      expect(r.steps.single.kind, 'submitted');
      expect(r.employeeName, 'Hazem Soliman');
    });

    test('every kind from its own JSON, and anything of the wrong type as missing', () {
      expect(requestOf(RequestKind.permission, permissionJson()), isA<PermissionRequest>().having((p) => p.hours, 'hours', 2).having((p) => p.fromTime, 'from', '16:00'));
      expect(requestOf(RequestKind.correction, correctionJson()), isA<CorrectionRequest>().having((c) => c.dayBefore?.source, 'source', 'system'));
      expect(requestOf(RequestKind.wfh, wfhJson()), isA<WfhRequest>().having((w) => w.rejectReason, 'reason', 'We need you at the shoot that day.'));
      expect(requestOf(RequestKind.od, odJson()), isA<OdRequest>().having((o) => o.fullDay, 'fullDay', isFalse).having((o) => o.dutyPlace, 'place', 'Client’s office, New Cairo'));
      expect(requestOf(RequestKind.compensatory, compensatoryJson()), isA<CompensatoryRequest>().having((c) => c.dayOff, 'dayOff', '$y-10-29'));
      expect(requestOf(RequestKind.home, homeJson()), isA<HomeLocationRequest>().having((h) => h.canWithdraw, 'withdraw', isTrue).having((h) => h.radiusMetres, 'radius', 100));
      expect(requestOf(RequestKind.claim, claimJson()), isA<ReimbursementClaim>().having((c) => c.amount, 'amount', 250.5).having((c) => c.receipts.length, 'receipts', 1));
      expect(requestOf(RequestKind.resignation, resignationJson()), isA<ResignationRequest>().having((r) => r.canWithdraw, 'withdraw', isTrue).having((r) => r.notice, 'notice', '3 months'));
      final odd = LeaveRequest.fromJson({'id': 7, 'days': '3', 'steps': 'none', 'manager': 'Sara'});
      expect(odd.id, '');
      expect(odd.days, 0);
      expect(odd.steps, isEmpty);
      expect(odd.manager, isNull);
      expect(requestsOf<PeopleRequest>(RequestKind.leave, {'not': 'a list'}), isEmpty);
    });

    test('the forms: leave types and cover, permission hours, work from home, the reimbursement caps, the resignation', () {
      final types = leaveTypesOf(leaveTypesJson());
      expect(types.map((t) => t.key), ['annual', 'casual', 'sick', 'unpaid']);
      expect(types[1].takesFromAnnual, isTrue);
      expect(types[2].documentRequired, isTrue);
      final cover = LeaveFormCoverage.fromJson(coverageJson(required: true));
      expect(cover.coverRequired, isTrue);
      expect(cover.candidates.first.name, 'Omar Adel');
      expect(cover.group, 'Video');
      final month = PermissionMonth.fromJson({...permissionMonthJson(left: 2.5), 'days': [{'date': '$y-10-20', 'hours': 1.5}]});
      expect(month.left, 2.5);
      expect(month.usedOn('$y-10-20'), 1.5);
      expect(WfhAllowance.fromJson(wfhAllowanceJson()).asks, isTrue);
      expect(WfhAllowance.fromJson(wfhAllowanceJson(offered: false)).asks, isFalse);
      final claim = reimbursementTypesOf(claimTypesJson()).single;
      // 500 a claim, 749.50 left of the month's 1,000: 500 at most now
      expect(claim.most, 500);
      final resign = MyResignation.fromJson({'requests': [resignationJson()], 'form': resignationFormJson(offered: false, refusal: 'Ask HR.')});
      expect(resign.requests.single.status, 'sent');
      expect(resign.form.offered, isFalse);
      expect(resign.form.refusal, 'Ask HR.');
      expect(OdForm.fromJson(odFormJson()).shift?.startTime, '09:00');
      expect(CompensatoryForm.fromJson(compensatoryFormJson()).rules.fullDayHours, 6);
    });
  });

  group('how requests read', () {
    test('dates, times, days, hours and money as the website writes them', () {
      expect(dmy('2026-10-05'), '05/10/2026');
      expect(dayWords('2026-10-26'), 'Monday 26/10/2026');
      expect(time12('17:00'), '5:00 PM');
      expect(time12('00:30'), '12:30 AM');
      expect(daysText(0.5), 'Half a day');
      expect(daysText(1), '1 day');
      expect(daysText(2.5), '2.5 days');
      expect(hoursText(1.5), '1 hour 30 minutes');
      expect(hoursText(0.5), '30 minutes');
      expect(clockHours(1.5), '1:30');
      expect(egp(16700), 'EGP 16,700.00');
      expect(egp(250.5), 'EGP 250.50');
      expect(periodText('2026-11-02', '2026-11-04'), '02/11/2026 – 04/11/2026');
      expect(periodText('2026-11-02', '2026-11-02', halfDay: true), 'Monday 02/11/2026 · half a day');
    });

    test('People’s refusals with its dates and times as the website shows them', () {
      expect(shownMessage('You already have Annual leave from 2026-11-02 to 2026-11-04 (with HR) on some of these days.'),
          'You already have Annual leave from 02/11/2026 to 04/11/2026 (with HR) on some of these days.');
      expect(shownMessage('Enter the time it starts as HH:MM, e.g. 17:00.'), 'Enter the time it starts as a 12-hour time, e.g. 5:00 PM.');
    });

    test('where a request stands, and each step, in People’s words', () {
      final waiting = LeaveRequest.fromJson(leaveJson(status: 'with_manager'));
      expect(statusLabelOf(waiting), 'With the manager');
      expect(stateOf(waiting), RequestState.waiting);
      expect(progressOf(waiting).text, 'With the direct manager (Sara Ali)');
      expect(sentTextOf(waiting), 'Request sent. It goes to your direct manager, then HR; each step shows on the request.');
      final ceo = LeaveRequest.fromJson({...leaveJson(status: 'with_hr'), 'confidential': true});
      expect(statusLabelOf(ceo), 'With the CEO');
      expect(progressOf(ceo).text, 'Waiting for the CEO');
      final rejected = WfhRequest.fromJson(wfhJson());
      expect(progressOf(rejected), (text: 'Rejected by the direct manager', reason: 'We need you at the shoot that day.'));
      expect(stepTextOf(rejected.steps.last, rejected.manager, false), 'The direct manager rejected it');
      final lead = Approver.of({'id': 'm', 'fullNameEn': 'Omar', 'role': 'team_lead'});
      expect(yourApprover(lead), 'your team lead');
      expect(stateOf(ReimbursementClaim.fromJson(claimJson())), RequestState.waiting);
      expect(statusLabelOf(ReimbursementClaim.fromJson(claimJson())), 'With Finance');
      expect(stateOf(ResignationRequest.fromJson(resignationJson(status: 'recorded'))), RequestState.approved);
    });
  });

  group('the overview', () {
    test('every request in one list, newest first, and this year’s count with where they stand', () {
      final rows = historyRows([
        LeaveRequest.fromJson(leaveJson(id: 'a', status: 'approved', createdAt: '$y-10-20T08:00:00.000Z')),
        PermissionRequest.fromJson(permissionJson()),
        ReimbursementClaim.fromJson(claimJson()),
        WfhRequest.fromJson(wfhJson()),
        LeaveRequest.fromJson(leaveJson(id: 'a', status: 'approved', createdAt: '$y-10-20T08:00:00.000Z')),
      ]);
      expect(rows.map((r) => r.title), ['Annual leave', 'Permission', 'Reimbursement', 'Work from home']);
      expect(rows.first.when, '02/11/$y – 04/11/$y · 3 days');
      expect(rows[1].when, '${weekdayName('$y-10-20')} 20/10/$y · 2 hours');
      expect(rows[2].when, 'Transport · EGP 250.50 · 18/10/$y');
      expect(rows.first.sent, 'Sent 20/10/$y');
      expect(filterHistory(rows, HistoryFilter.approved).length, 2);
      expect(filterHistory(rows, HistoryFilter.waiting).single.title, 'Reimbursement');
      final summary = yearSummary(rows, y);
      expect(summary.count, 4);
      expect(summary.note, '2 approved · 1 waiting · 1 closed');
      expect(yearSummary(rows.sublist(0, 2), y).note, 'Both requests approved');
      expect(yearSummary(const [], y).note, 'None asked for yet');
      expect(twoDigits(2), '02');
    });

    test('the annual share, the other types’ figures and the permission hours', () {
      final b = LeaveBalances.fromJson(balancesJson());
      expect(percentText(annualShareLeft(b.annual)), '90%');
      final types = leaveTypesOf(leaveTypesJson());
      final others = otherLeaveTypes(b, types);
      expect(others.map((t) => t.nameEn), ['Casual leave', 'Sick leave', 'Unpaid leave']);
      expect(otherLeaveFigure(others.first, types[1]), (value: '6', note: 'of 7 days left this year'));
      expect(otherLeaveFigure(others[1], types[2]), (value: '0', note: 'days used this year'));
      expect(permissionFigure(PermissionMonth.fromJson(permissionMonthJson(left: 2.5))), (value: '2:30', note: 'of 4:00 hours this month', off: false));
      expect(permissionFigure(PermissionMonth.fromJson({...permissionMonthJson(), 'hoursPerMonth': 0})).off, isTrue);
      expect(asksHome([HomeLocationRequest.fromJson(homeJson())]), isTrue);
      expect(asksHome([for (final t in ['home', 'remote_site', 'client']) HomeLocationRequest.fromJson(homeJson(id: t, type: t))]), isFalse);
      expect(underLabourLaw('full_time'), isTrue);
      expect(underLabourLaw('freelance'), isFalse);
    });
  });

  group('leave as the law counts it', () {
    const sunToThu = [0, 1, 2, 3, 4];

    test('working days of the shift, without official holidays; half a day; calendar days', () {
      // Sunday 1 to Saturday 7 November 2026: five working days, one an official holiday
      expect(leaveDaysBetween('2026-11-01', '2026-11-07', workingDays: sunToThu, holidays: {'2026-11-04'}, calendarDays: false), 4);
      expect(leaveDaysBetween('2026-11-01', '2026-11-01', workingDays: sunToThu, holidays: const {}, calendarDays: false, halfDay: true), 0.5);
      expect(leaveDaysBetween('2026-11-01', '2026-11-07', workingDays: sunToThu, holidays: const {}, calendarDays: true), 7);
      expect(leaveDaysBetween('2026-11-07', '2026-11-01', workingDays: sunToThu, holidays: const {}, calendarDays: false), 0);
    });

    test('the first working day from today, the cover rule, the types offered and their rules in a line', () {
      // Friday 30 October 2026: the next working day is Sunday 1 November
      expect(nextWorkingDay('2026-10-30', sunToThu, const {}), '2026-11-01');
      expect(nextWorkingDay('2026-11-01', sunToThu, {'2026-11-01'}), '2026-11-02');
      final types = leaveTypesOf(leaveTypesJson());
      expect(coverRequiredFor(types.first, 3), isTrue);
      expect(coverRequiredFor(types.first, 2), isFalse);
      expect(coverRequiredFor(types[2], 5), isFalse);
      final female = LeaveType.fromJson({...leaveTypeJson('maternity', 'Maternity leave', sort: 9), 'gender': 'female'});
      expect(offeredLeaveTypes([...types, female], 'male').map((t) => t.key), ['annual', 'casual', 'sick', 'unpaid']);
      expect(leaveTypeRulesText(types[1]), 'Paid · Working days · From the annual balance · At most 7 days a year · Half days allowed');
      expect(leaveTypeRulesText(types[2]), 'Paid · Working days · No balance · Document needed');
    });
  });
}
