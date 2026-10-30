import 'package:flutter_test/flutter_test.dart';
import 'package:people/features/attendance/attendance_logic.dart';
import 'package:people/features/attendance/attendance_words.dart';
import 'package:people/format.dart';
import 'package:people/models/attendance_correction.dart';
import 'package:people/models/attendance_today.dart';
import 'package:people/models/my_attendance.dart';
import 'package:people/models/today.dart';

// The Attendance tab's models from People's JSON as GET /api/attendance/me, GET /api/me/attendance/corrections and GET
// /api/me/attendance/today send it, and its rules as the website shows them. The fixtures here are the other attendance
// tests' too.

/// A day of October 2026 as People sends it (packages/shared AttendanceDayView), its times on Cairo's clock.
Map<String, Object?> dayJson(
  String date, {
  String status = 'worked',
  String? inAt,
  String? outAt,
  double hours = 0,
  String place = 'office',
  String source = 'system',
  double shortHours = 0,
  double extraHours = 0,
  Map<String, Object?> extra = const {},
}) {
  final worked = status == 'worked';
  return {
    'date': date,
    'status': status,
    'checkIn': worked && inAt != null ? '${date}T$inAt:00.000+03:00' : null,
    'checkOut': worked && outAt != null ? '${date}T$outAt:00.000+03:00' : null,
    'place': worked ? place : null,
    'zohoStatus': null,
    'permissionHours': 0,
    'hoursCounted': hours,
    'source': source,
    'flags': <String>[],
    'pairs': worked && inAt != null && outAt != null
        ? [
            {'in': '${date}T$inAt:00.000+03:00', 'out': '${date}T$outAt:00.000+03:00'},
          ]
        : null,
    'openAt': null,
    'breakMinutes': null,
    'exempt': false,
    'compensatory': false,
    'compensated': false,
    'expectedHours': worked ? 9 : null,
    'shortHours': shortHours,
    'extraHours': extraHours,
    'missingCheckOut': false,
    'openHalfDay': false,
    'missingCheckIn': false,
    'importId': null,
    ...extra,
  };
}

Map<String, Object?> pressJson(String date, String kind, String at, {String place = 'office', List<String> flags = const []}) => {
  'date': date,
  'kind': kind,
  'at': '${date}T$at:00.000+03:00',
  'place': place,
  'flags': flags,
  'locationName': place == 'office' ? 'Head office' : null,
  'officeNetwork': null,
  'latitude': 30.0596,
  'longitude': 31.3462,
  'accuracyMetres': 12,
  'pointFrom': 'press',
};

/// October 2026 as GET /api/attendance/me answers it for an employee who checks in on the system: worked days, the
/// weekend's rest days, an official holiday on the 8th, leave on the 25th, a work from home day, a day of two pairs, a
/// corrected day, an official duty, and a correction being decided.
Map<String, Object?> octoberJson({bool correctable = true, List<Map<String, Object?>>? corrections}) {
  final days = <Map<String, Object?>>[
    dayJson('2026-10-01', inAt: '08:58', outAt: '17:57', hours: 8.98),
    dayJson('2026-10-02', status: 'rest'),
    dayJson('2026-10-03', status: 'rest'),
    dayJson('2026-10-04', inAt: '09:00', outAt: '18:01', hours: 9.02, extraHours: 0.02),
    dayJson('2026-10-05', inAt: '09:10', outAt: '17:30', hours: 8.33, shortHours: 0.67),
    dayJson('2026-10-06', inAt: '08:30', outAt: '18:16', hours: 9.77, extraHours: 0.77),
    dayJson('2026-10-07', inAt: '09:02', outAt: '18:20', hours: 9.3, place: 'home', extra: {'wfhDay': false}),
    dayJson('2026-10-08', status: 'holiday'),
    dayJson('2026-10-09', status: 'rest'),
    dayJson('2026-10-10', status: 'rest'),
    dayJson(
      '2026-10-11',
      inAt: '09:05',
      outAt: '17:47',
      hours: 8.7,
      shortHours: 0.3,
      extra: {
        'od': {'requestId': 'od1', 'fullDay': false, 'fromTime': '13:00', 'toTime': '15:00', 'hours': 2},
      },
    ),
    dayJson(
      '2026-10-12',
      inAt: '09:02',
      outAt: '18:05',
      hours: 9.18,
      extraHours: 0.18,
      extra: {
        'pairs': [
          {'in': '2026-10-12T09:02:00.000+03:00', 'out': '2026-10-12T13:10:00.000+03:00'},
          {'in': '2026-10-12T14:00:00.000+03:00', 'out': '2026-10-12T18:05:00.000+03:00'},
        ],
        'breakMinutes': 50,
      },
    ),
    dayJson(
      '2026-10-13',
      inAt: '09:00',
      outAt: '17:40',
      hours: 8.67,
      shortHours: 0.33,
      source: 'correction',
      extra: {
        'correctedFrom': {'source': 'system', 'status': 'worked', 'checkIn': '2026-10-13T09:00:00.000+03:00', 'checkOut': null, 'place': 'office'},
        'correctionId': 'c1',
      },
    ),
    for (final d in ['14', '15', '18', '19', '20', '21', '22']) dayJson('2026-10-$d', inAt: '09:00', outAt: '18:00', hours: 9),
    dayJson('2026-10-16', status: 'rest'),
    dayJson('2026-10-17', status: 'rest'),
    dayJson('2026-10-23', status: 'rest'),
    dayJson('2026-10-24', status: 'rest'),
    dayJson('2026-10-25', status: 'leave'),
    dayJson('2026-10-26', inAt: '09:20', outAt: '17:15', hours: 7.92, shortHours: 1.08),
    dayJson('2026-10-27', inAt: '08:57', outAt: '17:57', hours: 9),
  ]..sort((a, b) => '${a['date']}'.compareTo('${b['date']}'));
  return {
    'month': '2026-10',
    'self': true,
    'person': {
      'employee': {'id': 'e1', 'employeeCode': 'TX-001', 'fullNameEn': 'Mohamed Abdelrahman', 'jobTitle': null, 'department': null, 'departmentId': null, 'confidential': false},
      'month': '2026-10',
      'hoursADay': 9,
      'figures': {
        'daysRecorded': 27,
        'daysWorked': 16,
        'daysCounted': 16,
        'hoursCounted': 141.93,
        'absentDays': 0,
        'shortHours': 3.63,
        'extraHours': 1.57,
        'shortHoursFilled': 1.57,
        'permissionHours': 0,
        'officeDays': 15,
        'remoteDays': 1,
        'leaveDays': 1,
        'zohoLeaveDays': 0,
        'missingCheckOuts': 0,
        'missingCheckIns': 0,
        'flaggedDays': 0,
        'noCheckInDays': 0,
        'holidays': 1,
        'restDays': 9,
        'exemptDays': 0,
        'compensatoryDays': 0,
      },
      'averageHours': 8.87,
      'permissionFrom': null,
      'checksIn': true,
      'days': days,
      'wfhDays': ['2026-10-07'],
      'odDays': [
        {'date': '2026-10-11', 'requestId': 'od1', 'fullDay': false, 'fromTime': '13:00', 'toTime': '15:00'},
      ],
      'exemptions': <Object>[],
    },
    'sources': <Object>[],
    'run': null,
    'corrections':
        corrections ??
        [
          {'id': 'c1', 'date': '2026-10-13', 'correctionKind': 'forgot_check_out', 'status': 'approved', 'checkIn': null, 'checkOut': '2026-10-13T14:40:00.000Z'},
          {'id': 'c2', 'date': '2026-10-26', 'correctionKind': 'wrong_time', 'status': 'with_manager', 'checkIn': '2026-10-26T06:05:00.000Z', 'checkOut': null},
        ],
    'correctable': correctable ? {'allowed': true, 'reason': null} : {'allowed': false, 'reason': 'The October 2026 payroll is approved, so its days can’t be corrected any more.'},
    'canCorrect': false,
    'punches': [
      for (final d in days)
        if (d['status'] == 'worked') ...[
          pressJson('${d['date']}', 'in', '${d['checkIn']}'.substring(11, 16), place: '${d['place']}'),
          pressJson('${d['date']}', 'out', '${d['checkOut']}'.substring(11, 16), place: '${d['place']}'),
        ],
    ],
  };
}

/// A correction as People sends it to its employee.
Map<String, Object?> correctionJson({String id = 'c2', String status = 'with_manager', bool canCancel = true}) => {
  'id': id,
  'kind': 'correction',
  'employee': {'id': 'e1', 'employeeCode': 'TX-001', 'fullNameEn': 'Mohamed Abdelrahman', 'fullNameAr': null, 'department': 'Studio', 'team': null},
  'date': '2026-10-26',
  'correctionKind': 'wrong_time',
  'checkIn': '2026-10-26T06:05:00.000Z',
  'checkOut': null,
  'reason': 'I came in at 9:05; the check-in was pressed late.',
  'dayBefore': {'status': 'worked', 'checkIn': '2026-10-26T06:20:00.000Z', 'checkOut': '2026-10-26T14:15:00.000Z', 'place': 'office', 'source': 'system'},
  'status': status,
  'stage': status == 'with_manager' ? 'manager' : null,
  'waitingForYou': false,
  'standingInFor': null,
  'canCancel': canCancel,
  'confidential': false,
  'manager': {'id': 'm1', 'fullNameEn': 'Sara Ali', 'role': 'team_lead'},
  'rejectedStage': null,
  'rejectReason': null,
  'recordedByHr': false,
  'appliedAt': null,
  'steps': [
    {'id': '1', 'kind': 'submitted', 'decision': null, 'comment': null, 'actor': 'Mohamed Abdelrahman', 'onBehalfOf': null, 'at': '2026-10-27T07:00:00.000Z'},
    if (status == 'rejected')
      {'id': '2', 'kind': 'manager_decision', 'decision': 'reject', 'comment': 'The door log says 9:20.', 'actor': 'Sara Ali', 'onBehalfOf': null, 'at': '2026-10-27T09:00:00.000Z'},
  ],
  'createdAt': '2026-10-27T07:00:00.000Z',
};

void main() {
  group('MyMonth', () {
    test('reads the month, its days, figures, presses and corrections', () {
      final m = MyMonth.fromJson(octoberJson());
      expect(m.month, '2026-10');
      expect(m.hoursADay, 9);
      expect(m.averageHours, 8.87);
      expect(m.checksIn, isTrue);
      expect(m.days, hasLength(27));
      expect(m.figures.daysWorked, 16);
      expect(m.figures.hoursCounted, 141.93);
      expect(m.figures.remoteDays, 1);
      expect(m.wfhDays, ['2026-10-07']);
      expect(m.odDays.single.fromTime, '13:00');
      expect(m.corrections, hasLength(2));
      expect(m.correctable, isTrue);
      expect(m.presses.where((p) => p.date == '2026-10-01'), hasLength(2));

      final twelfth = m.dayOn('2026-10-12')!;
      expect(twelfth.pairs, hasLength(2));
      expect(twelfth.breakMinutes, 50);
      expect(twelfth.checkIn, DateTime.parse('2026-10-12T06:02:00.000Z'));

      final thirteenth = m.dayOn('2026-10-13')!;
      expect(thirteenth.corrected, isTrue);
      expect(thirteenth.correctedFrom!.checkOut, isNull);
      expect(m.dayOn('2026-10-11')!.od!.requestId, 'od1');
      expect(m.openCorrectionOn('2026-10-26')!.id, 'c2');
      expect(m.openCorrectionOn('2026-10-13'), isNull);
    });

    test('reads an older API without corrections, presses or the newer fields as none', () {
      final m = MyMonth.fromJson({
        'month': '2026-09',
        'person': {
          'hoursADay': 8,
          'figures': {'daysWorked': 2, 'hoursCounted': 16},
          'days': [
            {'date': '2026-09-01', 'status': 'worked', 'checkIn': '2026-09-01T06:00:00.000Z', 'checkOut': null, 'place': 'office', 'zohoStatus': 'Present', 'permissionHours': 0, 'hoursCounted': 8},
          ],
        },
      });
      expect(m.corrections, isNull);
      expect(m.correctable, isNull);
      expect(m.presses, isEmpty);
      expect(m.days.single.source, 'zoho');
      expect(m.days.single.zohoStatus, 'Present');
      expect(m.figures.extraHours, 0);
      expect(offerFor(m, '2026-09-01', '2026-10-30'), isA<NoOffer>());
    });
  });

  group('AttendanceCorrection', () {
    test('reads a correction with its day before, manager and steps', () {
      final c = AttendanceCorrection.fromJson(correctionJson(status: 'rejected', canCancel: false));
      expect(c.kind, 'wrong_time');
      expect(c.checkIn, DateTime.parse('2026-10-26T06:05:00.000Z'));
      expect(c.dayBefore!.source, 'system');
      expect(c.managerName, 'Sara Ali');
      expect(c.managerRole, 'team_lead');
      expect(c.steps, hasLength(2));
      expect(c.steps.last.comment, 'The door log says 9:20.');
      expect(c.open, isFalse);
      expect(correctionsOf([correctionJson()]).single.canCancel, isTrue);
    });
  });

  group('TodayDetails', () {
    test('reads the working day, the arrangement, a first day and an exemption', () {
      final t = Today.fromJson({
        'refusal': null,
        'date': '2026-10-30',
        'next': 'in',
        'punches': <Object>[],
        'day': null,
        'exemption': {'startDate': '2026-10-01', 'endDate': null},
        'expected': 'office',
        'expectedText': 'You work at the office: check in there.',
        'officeLocationSet': false,
        'network': {'locked': true},
        'gps': {'locked': false},
        'workingFromHome': false,
        'officialDuty': null,
        'ownPlaces': ['Studio'],
        'location': {'required': false},
        'shift': {'startTime': '09:00', 'endTime': '18:00', 'hoursPerDay': 9},
        'firstDay': true,
      });
      final d = TodayDetails.of(t.raw);
      expect(d.date, '2026-10-30');
      expect(d.expected, 'office');
      expect(d.firstDay, isTrue);
      expect(d.exemption!.endDate, isNull);
      expect(d.ownPlaces, ['Studio']);
      expect(d.officeLocationSet, isFalse);
      expect(d.shiftStart, '09:00');
    });
  });

  group('the rules', () {
    test('a month’s weeks run Sunday to Saturday, and say their days', () {
      final weeks = weeksOf('2026-10');
      expect(weeks, hasLength(5));
      expect(weeks.first.first, '2026-09-27');
      expect(weeks.last, ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
      expect(weekIndexOf('2026-10', '2026-10-27'), 4);
      expect(weekSpanOf('2026-10', weeks.last), '25–31 October');
      expect(weekSpanOf('2026-10', weeks.first), '1–3 October');
      expect(addMonths('2026-01', -1), '2025-12');
      expect(addMonths('2026-12', 1), '2027-01');
    });

    test('the figures are the website’s, in the design’s words, and no attendance rate', () {
      final tiles = figureTiles(MyMonth.fromJson(octoberJson()));
      expect(tiles.map((t) => t.label), [
        'Days worked',
        'Hours counted',
        'Absent days',
        'Short hours',
        'Extra time used',
        'Permission',
        'Leave days',
        'Missing check-outs',
        'Missing check-ins',
        'Flagged days',
      ]);
      final byKey = {for (final t in tiles) t.key: t};
      expect(byKey['worked']!.note, '15 office · 1 remote');
      expect(byKey['hours']!.value, '141:56');
      expect(byKey['hours']!.note, '8:52 daily average');
      expect(byKey['short']!.note, 'Against 9:00 shifts');
      expect(byKey['filled']!.value, '1:34');
      expect(tiles.any((t) => t.label.toLowerCase().contains('rate')), isFalse);
    });

    test('a day offers its correction being decided, else Ask on a day gone by, not leave, in an open month', () {
      final m = MyMonth.fromJson(octoberJson());
      expect(offerFor(m, '2026-10-26', '2026-10-30'), isA<OpenCorrection>());
      expect(offerFor(m, '2026-10-27', '2026-10-30'), isA<CanAsk>());
      expect(offerFor(m, '2026-10-25', '2026-10-30'), isA<NoOffer>());
      expect(offerFor(m, '2026-10-31', '2026-10-30'), isA<NoOffer>());
      final locked = MyMonth.fromJson(octoberJson(correctable: false));
      expect(offerFor(locked, '2026-10-27', '2026-10-30'), isA<NoOffer>());
      expect(monthAsks(locked, '2026-10-30'), isFalse);
      expect(monthAsks(m, '2026-10-30'), isTrue);
    });

    test('the correction’s checks are People’s, and its body has only the times its kind asks for', () {
      final m = MyMonth.fromJson(octoberJson());
      final now = DateTime(2026, 10, 30, 14);
      List<String> problems(String? date, String? kind, {String? checkIn, String? checkOut, String reason = 'I forgot.'}) =>
          correctionProblems((date: date, kind: kind, checkIn: checkIn, checkOut: checkOut, reason: reason), m, today: '2026-10-30', now: now);
      expect(problems(null, null), [AttendanceWords.needDay]);
      expect(problems('2026-10-27', null, reason: ''), [AttendanceWords.needKind, AttendanceWords.needReason]);
      expect(problems('2026-10-25', 'forgot_check_in', checkIn: '09:00'), [AttendanceWords.onLeave('25/10/2026')]);
      expect(problems('2026-10-26', 'wrong_time', checkIn: '09:00'), [AttendanceWords.alreadyAsked('26/10/2026')]);
      expect(problems('2026-10-27', 'forgot_check_out'), [AttendanceWords.needLeft]);
      expect(problems('2026-10-27', 'forgot_check_in', checkIn: '08:30'), [AttendanceWords.checkedInAlready(clockOf(DateTime.parse('2026-10-27T08:57:00.000+03:00')), '27/10/2026')]);
      expect(problems('2026-10-30', 'worked_remotely', checkIn: '09:00', checkOut: '18:00'), [AttendanceWords.notYetCome('18:00')]);
      expect(problems('2026-10-27', 'wrong_time', checkIn: '08:45'), isEmpty);

      expect(correctionBody((date: '2026-10-27', kind: 'forgot_check_out', checkIn: '09:00', checkOut: '18:30', reason: ' Left for a meeting. ')), {
        'date': '2026-10-27',
        'kind': 'forgot_check_out',
        'checkOut': '18:30',
        'reason': 'Left for a meeting.',
      });
    });

    test('a day’s balance, pairs, correction note and where the days came from', () {
      final m = MyMonth.fromJson(octoberJson());
      expect(balanceOf(m.dayOn('2026-10-05')!)!.text, '−0:40 short');
      expect(balanceOf(m.dayOn('2026-10-06')!)!.text, '+0:46 extra');
      expect(balanceOf(m.dayOn('2026-10-27')!), isNull);
      final pairs = pairsOf(m.dayOn('2026-10-12')!)!;
      expect(pairs.breakText, 'Break 50 min');
      expect(pairsOf(m.dayOn('2026-10-01')!), isNull);
      expect(correctedNoteOf(m.dayOn('2026-10-13')!), 'Corrected from ${clockOf(DateTime.parse('2026-10-13T09:00:00.000+03:00'))} – no check-out');
      expect(usualSourceOf(m.days), 'system');
      expect(AttendanceWords.hoursText(141.93), '141:56');
      expect(AttendanceWords.dayLabel('2026-10-01'), (day: 'Thu 01', rest: '/10/2026'));
      expect(AttendanceWords.dayTitle('2026-10-27'), 'Tuesday 27/10/2026');
    });

    test('the lock words name their own check-in places', () {
      expect(AttendanceWords.lockText(network: false, gps: false), isNull);
      expect(AttendanceWords.lockText(network: true, gps: false, ownPlaces: ['Studio']), endsWith('At your own check-in place (Studio) you can check in off it.'));
      expect(AttendanceWords.lockText(network: true, gps: true), AttendanceWords.bothNeeded);
    });
  });
}
