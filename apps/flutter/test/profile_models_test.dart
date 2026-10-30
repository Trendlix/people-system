import 'package:flutter_test/flutter_test.dart';
import 'package:people/models/account.dart';
import 'package:people/models/employee_details.dart';
import 'package:people/models/interview_hours.dart';
import 'package:people/models/payslip.dart';
import 'package:people/models/profile.dart';

// The Profile's and the account screens' answers from People read by hand (README §2): one's own employee profile as
// People sends it to the employee (no national ID, bank or salary), the payslips, the sessions and phones, the
// interview hours and the calendar. The fixtures are the other Profile tests' too.

/// GET /api/employees/e1 as People answers the employee themself (apps/api employees.service.ts `get`).
Map<String, Object?> ownProfileJson({List<Map<String, Object?>> requests = const [], int percent = 92, List<Map<String, Object?>>? missing}) => {
  'id': 'e1',
  'employeeCode': 'TLX-055-25',
  'insuranceNo': '12345678',
  'fullNameEn': 'Mohamed Abdelrahman',
  'fullNameAr': 'محمد عبد الرحمن',
  'displayName': 'Mohamed',
  'dateOfBirth': '1993-04-18',
  'gender': 'male',
  'nationality': 'Egyptian',
  'maritalStatus': 'married',
  'militaryStatus': 'completed',
  'workEmail': 'm.abdelrahman@trendlix.example',
  'personalEmail': 'mohamed@example.test',
  'mobile': '+201012345678',
  'mobile2': null,
  'addressAr': '١٢ شارع التحرير',
  'city': 'الدقي',
  'governorate': 'Giza',
  'buildingNo': '12',
  'emergencyName': 'Sara Ali',
  'emergencyRelation': 'Wife',
  'emergencyMobile': '+201112223334',
  'university': 'Cairo University',
  'faculty': 'Fine Arts',
  'degree': 'bachelor',
  'major': 'Graphic Design',
  'graduationYear': 2015,
  'educationGrade': 'very_good',
  'qualificationAr': null,
  'stillStudying': false,
  'photoId': null,
  'photoCrop': null,
  'priorServiceMonths': null,
  'disability': false,
  'createdAt': '2024-02-01T09:00:00.000Z',
  'updatedAt': '2026-10-01T09:00:00.000Z',
  'employment': {
    'id': 'm1',
    'employeeId': 'e1',
    'employmentType': 'full_time',
    'status': 'active',
    'departmentId': 'd2',
    'jobTitleId': 'j1',
    'managerId': 'e9',
    'joinDate': '2024-02-14',
    'probationEnd': '2024-05-14',
    'workArrangement': 'hybrid',
    'officeDays': [2, 0],
    'shiftId': 's1',
    'jdAcknowledgedAt': null,
    'endDate': null,
    'endReason': null,
    'endNote': null,
    'department': {
      'id': 'd2',
      'nameEn': 'Design',
      'nameAr': 'التصميم',
      'parent': {'id': 'd1', 'nameEn': 'Product', 'nameAr': 'المنتج'},
    },
    'jobTitle': {'id': 'j1', 'titleEn': 'Senior Product Designer', 'titleAr': 'مصمم منتجات أول', 'jdVersion': 2},
    'gradeId': 'g5',
    'grade': {'id': 'g5', 'code': 'G5', 'rank': 5, 'levelEn': 'Senior', 'levelAr': 'أول'},
    'manager': {'id': 'e9', 'employeeCode': 'TLX-010-22', 'fullNameEn': 'Yasmine Fahmy'},
    'shift': {'id': 's1', 'code': 'A', 'startTime': '09:00', 'endTime': '18:00', 'hoursPerDay': 8},
    'contract': {
      'id': 'c1',
      'number': 'TLX-C-0042',
      'version': 1,
      'form': 'fixed',
      'startDate': '2024-02-14',
      'endDate': '2027-02-13',
      'signedOn': '2024-02-12',
      'status': 'active',
      'grossSalary': null,
      'netSalary': null,
      'allowances': null,
    },
    'ending': null,
    'leads': {'team': null, 'department': null},
  },
  'employments': <Object>[],
  'reports': <Object>[],
  'completeness': {
    'percent': percent,
    'missing':
        missing ??
        [
          {'key': 'military_certificate', 'label': 'Military status certificate', 'tab': 'documents'},
        ],
  },
  'access': {'edit': false, 'delete': false, 'identity': false, 'bank': false},
  'confirmation': {'confirmedAt': '2026-10-01T09:00:00.000Z', 'confirmedBy': null, 'upToDate': true, 'changedFields': <String>[], 'disclaimerVersion': 1},
  'changeRequests': requests,
  'isSelf': true,
  'confidential': false,
  'restricted': false,
};

Map<String, Object?> pendingRequestJson() => {
  'id': 'r1',
  'employee': {'id': 'e1', 'employeeCode': 'TLX-055-25', 'fullNameEn': 'Mohamed Abdelrahman'},
  'changes': [
    {'field': 'mobile', 'label': 'Mobile', 'from': '+201012345678', 'to': '+201099999999'},
    {'field': 'maritalStatus', 'label': 'Marital status', 'from': 'single', 'to': 'married'},
  ],
  'note': 'New number',
  'status': 'pending',
  'requestedBy': {'email': 'm.abdelrahman@trendlix.example'},
  'requestedAt': '2026-10-28T09:30:00.000Z',
  'decidedBy': null,
  'decidedAt': null,
  'decisionNote': null,
};

/// GET /api/me/payslips.
List<Map<String, Object?>> payslipsJson() => [
  {
    'lineId': 'l2',
    'runId': 'p2',
    'month': '2026-09',
    'paidOn': '2026-09-28',
    'net': 18250,
    'transfer': 18250,
    'onHold': false,
    'issued': {'en': '2026-09-28T10:00:00.000Z', 'ar': null},
  },
  {
    'lineId': 'l1',
    'runId': 'p1',
    'month': '2026-08',
    'paidOn': null,
    'net': 0,
    'transfer': 0,
    'onHold': true,
    'issued': {'en': null, 'ar': null},
  },
];

/// GET /api/auth/sessions: this phone's app session and a website one.
List<Map<String, Object?>> sessionsJson() => [
  {
    'id': 's1',
    'kind': 'app',
    'createdAt': '2026-10-30T06:00:00.000Z',
    'lastActiveAt': '2026-10-30T07:10:00.000Z',
    'expiresAt': '2026-10-30T14:00:00.000Z',
    'userAgent': 'Trendlix People/0.4.0 (android) TrendLIXPeople',
    'client': null,
    'current': true,
  },
  {
    'id': 's2',
    'kind': 'web',
    'createdAt': '2026-10-27T08:26:00.000Z',
    'lastActiveAt': '2026-10-27T09:08:00.000Z',
    'expiresAt': '2026-10-27T16:26:00.000Z',
    'userAgent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    'client': null,
    'current': false,
  },
];

/// GET /api/auth/devices.
List<Map<String, Object?>> devicesJson() => [
  {'id': 'd1', 'deviceName': 'Google Pixel 8', 'platform': 'android', 'createdAt': '2026-10-20T08:00:00.000Z', 'lastUsedAt': '2026-10-30T06:00:00.000Z'},
];

/// GET /api/me/interview-hours.
Map<String, Object?> interviewHoursJson({bool none = false}) => {
  'employeeId': 'e1',
  'name': 'Mohamed Abdelrahman',
  'hours': none
      ? null
      : {
          'windows': [
            {'day': 0, 'from': '10:00', 'to': '12:00'},
            {'day': 1, 'from': '13:00', 'to': '15:00'},
          ],
          'changes': [
            {'date': '2026-11-12', 'kind': 'off', 'from': null, 'to': null},
          ],
          'effectiveFrom': '2026-10-27',
          'noticeHours': 48,
          'bufferMinutes': null,
        },
  'defaults': {'noticeHours': 24, 'bufferMinutes': 15},
  'updatedAt': none ? null : '2026-10-27T08:00:00.000Z',
  'updatedBy': none ? null : {'id': 'u1', 'name': 'Mohamed Abdelrahman'},
  'upcoming': [
    {
      'id': 'i1',
      'startsAt': '2026-11-03T09:00:00.000Z',
      'minutes': 45,
      'kind': 'online',
      'applicationId': 'a1',
      'candidate': 'Laila Hassan',
      'job': 'UI Designer',
    },
  ],
  'needsHours': none,
};

/// GET /api/calendars/mine: read through the company's Zoho.
Map<String, Object?> calendarsJson() => {
  'providers': [
    {'provider': 'zoho', 'available': true, 'connection': null},
    {'provider': 'google', 'available': false, 'connection': null},
  ],
  'companyZoho': true,
  'companyMicrosoft': false,
  'workEmail': 'm.abdelrahman@trendlix.example',
  'meetings': <Object>[],
};

void main() {
  test('reads one’s own details as People sends them to the employee', () {
    final p = OwnProfile.fromJson(ownProfileJson(requests: [pendingRequestJson()]));
    final d = EmployeeDetails.of(p);
    expect(d.raw('fullNameEn'), 'Mohamed Abdelrahman');
    expect(d.raw('dateOfBirth'), '1993-04-18');
    expect(d.raw('graduationYear'), '2015');
    expect(d.raw('mobile2'), isNull);
    expect(d.raw('qualificationAr'), isNull);
    expect(d.workEmail, 'm.abdelrahman@trendlix.example');
    // never anything People keeps from the employee
    expect(d.values.keys, isNot(contains('nationalId')));

    final job = d.job!;
    expect(
      (job.jobTitle, job.place, job.placeIsTeam, job.grade, job.manager),
      ('Senior Product Designer', 'Product › Design', true, 'G5 · Senior', 'Yasmine Fahmy'),
    );
    expect((job.employmentType, job.joinDate, job.workArrangement, job.shift), ('full_time', '2024-02-14', 'hybrid', 'A · 09:00 – 18:00'));
    expect(job.officeDays, [0, 2]);
    expect(job.contract, (form: 'fixed', signedOn: '2024-02-12', startDate: '2024-02-14', endDate: '2027-02-13'));

    final r = d.pendingRequest!;
    expect((r.id, r.pending, r.note), ('r1', true, 'New number'));
    expect(r.changes.first, (field: 'mobile', label: 'Mobile', from: '+201012345678', to: '+201099999999'));
    expect(r.requestedAt, DateTime.utc(2026, 10, 28, 9, 30));
    expect(d.lastDecided, isNull);
  });

  test('reads a profile with no employment and no requests', () {
    final d = EmployeeDetails.fromJson({'id': 'e1', 'fullNameEn': 'New Hire', 'employment': null, 'changeRequests': null});
    expect(d.job, isNull);
    expect(d.requests, isEmpty);
    expect(d.pendingRequest, isNull);
    expect(EmployeeLabels.of(EmployeeLabels.employmentType, 'apprentice'), 'apprentice');
    expect(EmployeeLabels.of(EmployeeLabels.workArrangement, 'wfh'), 'Work from home');
  });

  test('reads the payslips, a month on hold without a payslip, and writes money as the website does', () {
    final slips = payslipsOf(payslipsJson());
    expect(slips.map((s) => (s.month, s.paidOn, s.net, s.onHold)), [('2026-09', '2026-09-28', 18250.0, false), ('2026-08', null, 0.0, true)]);
    expect(payslipsOf({'not': 'a list'}), isEmpty);
    expect(egpOf(18250), 'EGP 18,250.00');
    expect(egpOf(1234567.5), 'EGP 1,234,567.50');
  });

  test('reads the sessions and phones, and says where each was signed in', () {
    final s = sessionsOf(sessionsJson());
    expect(s.map((x) => (x.kind, x.current, x.device)), [('app', true, 'Trendlix People app on Android'), ('web', false, 'Chrome on Windows')]);
    expect(
      deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'),
      'Safari on iPhone',
    );
    expect(deviceOf(null), 'Unknown device');
    expect(OpenSession.fromJson({'id': 'c', 'kind': 'connector', 'client': 'Claude'})!.device, 'Claude');
    final d = devicesOf(devicesJson()).single;
    expect((d.id, d.deviceName, d.platformLabel, d.lastUsedAt), ('d1', 'Google Pixel 8', 'Android', DateTime.utc(2026, 10, 30, 6)));
  });

  test('reads the interview hours, sends them back as People takes them, and words the rules', () {
    final v = MyInterviewHours.fromJson(interviewHoursJson());
    final h = v.hours!;
    expect(h.windows, [(day: 0, from: '10:00', to: '12:00'), (day: 1, from: '13:00', to: '15:00')]);
    expect(h.changes.single, (date: '2026-11-12', kind: 'off', from: null, to: null));
    expect((h.effectiveFrom, h.noticeHours, h.bufferMinutes), ('2026-10-27', 48, null));
    expect(h.toJson()['windows'], [
      {'day': 0, 'from': '10:00', 'to': '12:00'},
      {'day': 1, 'from': '13:00', 'to': '15:00'},
    ]);
    expect(v.upcoming.single.candidate, 'Laila Hassan');
    expect(v.defaults, (noticeHours: 24, bufferMinutes: 15));
    expect(MyInterviewHours.fromJson(interviewHoursJson(none: true)).hours, isNull);

    expect(rulesText(48, null, v.defaults), '2 days’ notice · 15 minutes between interviews');
    expect(rulesText(null, null, (noticeHours: 0, bufferMinutes: 0)), 'No minimum notice · no buffer between interviews');
    expect(noticeOptions(v.defaults, 30).map((o) => o.label).take(3), ['The company’s (24 hours)', '30 hours', '2 days']);
    expect(bufferOptions(v.defaults, null).first, (value: null, label: 'The company’s (15 minutes)'));
    expect((clock12('00:15'), clock12('12:00'), clock12('13:30')), ('12:15 AM', '12:00 PM', '1:30 PM'));
    expect(quarterHours.length, 96);
  });

  test('reads what reads one’s calendar', () {
    final c = MyCalendars.fromJson(calendarsJson());
    expect((c.companyZoho, c.companyMicrosoft, c.workEmail), (true, false, 'm.abdelrahman@trendlix.example'));
    expect(c.connected, isEmpty);
    final mine = MyCalendars.fromJson({
      'providers': [
        {
          'provider': 'google',
          'available': true,
          'connection': {'id': 'k', 'provider': 'google', 'accountEmail': 'me@example.test', 'status': 'needs_reconnecting'},
        },
      ],
    });
    expect(mine.connected.single, (provider: 'google', account: 'me@example.test', working: false));
  });
}
