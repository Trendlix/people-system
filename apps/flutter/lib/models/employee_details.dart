// One's own employee file as the Profile tab shows it (GET /api/employees/:id, apps/web lib/types.ts `EmployeeProfile`,
// packages/shared profile-confirmation.ts): the personal, contact, emergency and education details, the current
// employment with its signed contract, and one's requests to change the details. Read by hand from the profile's JSON
// (OwnProfile.raw). Only what People sends the employee themself: no national ID, bank or salary (HR's, Finance's and
// the CEO's), no employee file (HR's and the CEO's).

import 'profile.dart';

String? _str(Object? v) => v is String && v.trim().isNotEmpty ? v.trim() : null;
Map _map(Object? v) => v is Map ? v : const {};

// ---------- the words People's codes are shown in (packages/shared index.ts LABELS) ----------

abstract final class EmployeeLabels {
  static const gender = {'male': 'Male', 'female': 'Female'};
  static const maritalStatus = {'single': 'Single', 'married': 'Married', 'divorced': 'Divorced', 'widowed': 'Widowed'};
  static const militaryStatus = {'completed': 'Completed', 'exempt': 'Exempt', 'postponed': 'Postponed', 'not_applicable': 'Not applicable'};
  static const degree = {'high_school': 'High school', 'diploma': 'Diploma', 'bachelor': 'Bachelor’s', 'master': 'Master’s', 'doctorate': 'Doctorate'};
  static const educationGrade = {'excellent': 'Excellent', 'very_good': 'Very good', 'good': 'Good', 'pass': 'Pass'};
  static const employmentType = {
    'full_time': 'Full-time',
    'part_time': 'Part-time',
    'intern': 'Unpaid internship',
    'freelance': 'Freelance (outside the labour law)',
  };
  static const status = {
    'active': 'Active',
    'probation': 'Probation',
    'on_leave': 'On leave',
    'notice_period': 'Notice period',
    'resigned': 'Resigned',
    'terminated': 'Terminated',
  };
  static const workArrangement = {
    'office': 'Indoor (office)',
    'outdoor': 'Outdoor (field work)',
    'indoor_outdoor': 'Indoor and outdoor',
    'hybrid': 'Hybrid (office and home)',
    'wfh': 'Work from home',
  };
  static const contractForm = {'fixed': 'Fixed-term', 'open_ended': 'Open-ended', 'specific_job': 'For a specific job'};
  static const changeStatus = {'pending': 'Waiting for HR', 'approved': 'Approved', 'rejected': 'Rejected', 'cancelled': 'Cancelled'};

  /// The governorates People takes (packages/shared GOVERNORATES), each its own words.
  static const governorates = {
    'Alexandria': 'Alexandria',
    'Aswan': 'Aswan',
    'Asyut': 'Asyut',
    'Beheira': 'Beheira',
    'Beni Suef': 'Beni Suef',
    'Cairo': 'Cairo',
    'Dakahlia': 'Dakahlia',
    'Damietta': 'Damietta',
    'Faiyum': 'Faiyum',
    'Gharbia': 'Gharbia',
    'Giza': 'Giza',
    'Ismailia': 'Ismailia',
    'Kafr El Sheikh': 'Kafr El Sheikh',
    'Luxor': 'Luxor',
    'Matrouh': 'Matrouh',
    'Minya': 'Minya',
    'Monufia': 'Monufia',
    'New Valley': 'New Valley',
    'North Sinai': 'North Sinai',
    'Port Said': 'Port Said',
    'Qalyubia': 'Qalyubia',
    'Qena': 'Qena',
    'Red Sea': 'Red Sea',
    'Sharqia': 'Sharqia',
    'Sohag': 'Sohag',
    'South Sinai': 'South Sinai',
    'Suez': 'Suez',
  };

  /// A code in words; the code itself when People has a newer one the app doesn't know.
  static String? of(Map<String, String> labels, String? code) => code == null ? null : labels[code] ?? code;
}

// ---------- the fields one may ask HR to change (packages/shared CONFIRM_FIELDS, less the work email) ----------

/// How a field is typed: free text, a date, a whole number, or one of People's codes.
enum FieldKind { text, date, number, choice }

/// A field of one's details: its key in People, its words, how it is typed (its choices, for a choice).
class DetailField {
  const DetailField(this.key, this.label, {this.kind = FieldKind.text, this.choices = const {}, this.arabic = false});

  final String key;
  final String label;
  final FieldKind kind;

  /// A choice's codes and their words.
  final Map<String, String> choices;

  /// Typed in Arabic (right to left).
  final bool arabic;
}

/// The parts of one's details, each with its fields in People's order: what the Profile shows and what a change request
/// may ask for (the work email is the company's, set with the sign-in account: shown, never asked for).
abstract final class DetailFields {
  static const personal = [
    DetailField('fullNameEn', 'Legal name'),
    DetailField('fullNameAr', 'Name in Arabic', arabic: true),
    DetailField('displayName', 'Preferred name'),
    DetailField('dateOfBirth', 'Date of birth', kind: FieldKind.date),
    DetailField('gender', 'Gender', kind: FieldKind.choice, choices: EmployeeLabels.gender),
    DetailField('nationality', 'Nationality'),
    DetailField('maritalStatus', 'Marital status', kind: FieldKind.choice, choices: EmployeeLabels.maritalStatus),
    DetailField('militaryStatus', 'Military status', kind: FieldKind.choice, choices: EmployeeLabels.militaryStatus),
    DetailField('insuranceNo', 'Social insurance number'),
  ];

  static const education = [
    DetailField('university', 'University'),
    DetailField('faculty', 'Faculty'),
    DetailField('degree', 'Degree', kind: FieldKind.choice, choices: EmployeeLabels.degree),
    DetailField('major', 'Major'),
    DetailField('graduationYear', 'Graduation year', kind: FieldKind.number),
    DetailField('educationGrade', 'Grade', kind: FieldKind.choice, choices: EmployeeLabels.educationGrade),
    DetailField('qualificationAr', 'Qualification (Arabic)', arabic: true),
  ];

  static const contact = [
    DetailField('personalEmail', 'Personal email'),
    DetailField('mobile', 'Mobile'),
    DetailField('mobile2', 'Second mobile'),
    DetailField('governorate', 'Governorate', kind: FieldKind.choice, choices: EmployeeLabels.governorates),
    DetailField('city', 'City', arabic: true),
    DetailField('addressAr', 'Address (Arabic)', arabic: true),
    DetailField('buildingNo', 'Building number'),
  ];

  static const emergency = [DetailField('emergencyName', 'Name'), DetailField('emergencyRelation', 'Relation'), DetailField('emergencyMobile', 'Mobile')];

  /// Every field a change request may name, by its key.
  static final byKey = {
    for (final f in [...personal, ...education, ...contact, ...emergency]) f.key: f,
  };
}

// ---------- change requests ----------

/// One field of a change request: what it was when asked, and what was asked for.
typedef DetailChange = ({String field, String label, Object? from, Object? to});

/// A request to change one's details: HR approves it (the change is made) or rejects it with a note; the employee may
/// cancel it while it waits.
class ChangeRequest {
  const ChangeRequest({
    required this.id,
    required this.status,
    required this.changes,
    required this.note,
    required this.requestedAt,
    required this.decidedAt,
    required this.decisionNote,
  });

  static ChangeRequest? fromJson(Object? json) {
    if (json is! Map) return null;
    final id = _str(json['id']);
    if (id == null) return null;
    final changes = json['changes'] is List ? json['changes'] as List : const [];
    return ChangeRequest(
      id: id,
      status: _str(json['status']) ?? 'pending',
      changes: [
        for (final c in changes)
          if (c is Map && _str(c['field']) != null) (field: _str(c['field'])!, label: _str(c['label']) ?? _str(c['field'])!, from: c['from'], to: c['to']),
      ],
      note: _str(json['note']),
      requestedAt: DateTime.tryParse('${json['requestedAt']}'),
      decidedAt: DateTime.tryParse('${json['decidedAt']}'),
      decisionNote: _str(json['decisionNote']),
    );
  }

  final String id;

  /// pending, approved, rejected or cancelled.
  final String status;
  final List<DetailChange> changes;
  final String? note;
  final DateTime? requestedAt;
  final DateTime? decidedAt;
  final String? decisionNote;

  bool get pending => status == 'pending';
}

// ---------- the job ----------

/// The signed contract in force (salary left out: People sends it only to HR, Finance and the CEO).
typedef SignedContract = ({String? form, String? signedOn, String? startDate, String? endDate});

/// The current employment as the Profile shows it.
class CurrentJob {
  const CurrentJob({
    required this.jobTitle,
    required this.place,
    required this.placeIsTeam,
    required this.grade,
    required this.manager,
    required this.status,
    required this.employmentType,
    required this.joinDate,
    required this.probationEnd,
    required this.workArrangement,
    required this.officeDays,
    required this.shift,
    required this.contract,
  });

  static CurrentJob? fromJson(Object? json) {
    if (json is! Map) return null;
    final department = json['department'] is Map ? json['department'] as Map : null;
    final parent = department?['parent'] is Map ? department!['parent'] as Map : null;
    final name = _str(department?['nameEn']);
    final grade = _map(json['grade']);
    final shift = json['shift'] is Map ? json['shift'] as Map : null;
    final contract = json['contract'] is Map ? json['contract'] as Map : null;
    final office = json['officeDays'];
    String? shiftText;
    if (shift != null) {
      final from = _str(shift['startTime']), to = _str(shift['endTime']);
      shiftText = [?_str(shift['code']), if (from != null && to != null) '$from – $to'].join(' · ');
      if (shiftText.isEmpty) shiftText = null;
    }
    final gradeCode = _str(grade['code']), gradeLevel = _str(grade['levelEn']);
    return CurrentJob(
      jobTitle: _str(_map(json['jobTitle'])['titleEn']),
      place: name == null ? null : (parent != null && _str(parent['nameEn']) != null ? '${_str(parent['nameEn'])} › $name' : name),
      placeIsTeam: parent != null,
      grade: gradeCode == null ? null : (gradeLevel == null ? gradeCode : '$gradeCode · $gradeLevel'),
      manager: _str(_map(json['manager'])['fullNameEn']),
      status: _str(json['status']),
      employmentType: _str(json['employmentType']),
      joinDate: _str(json['joinDate']),
      probationEnd: _str(json['probationEnd']),
      workArrangement: _str(json['workArrangement']),
      officeDays: office is List ? (office.whereType<num>().map((d) => d.toInt()).toList()..sort()) : const [],
      shift: shiftText,
      contract: contract == null
          ? null
          : (form: _str(contract['form']), signedOn: _str(contract['signedOn']), startDate: _str(contract['startDate']), endDate: _str(contract['endDate'])),
    );
  }

  final String? jobTitle;

  /// "Marketing › Content Team", or a department of its own.
  final String? place;
  final bool placeIsTeam;
  final String? grade;
  final String? manager;
  final String? status;
  final String? employmentType;
  final String? joinDate;
  final String? probationEnd;
  final String? workArrangement;

  /// A hybrid arrangement's days in the office, 0 = Sunday.
  final List<int> officeDays;

  /// "A · 09:00 – 18:00".
  final String? shift;
  final SignedContract? contract;
}

// ---------- the whole ----------

/// One's details from the profile People sent: each field's value as kept, the work email, the job, the requests.
class EmployeeDetails {
  const EmployeeDetails({required this.values, required this.workEmail, required this.job, required this.requests});

  factory EmployeeDetails.of(OwnProfile profile) => EmployeeDetails.fromJson(profile.raw);

  factory EmployeeDetails.fromJson(Map json) {
    final requests = json['changeRequests'] is List ? json['changeRequests'] as List : const [];
    return EmployeeDetails(
      values: {
        for (final key in DetailFields.byKey.keys)
          if (json[key] is String && (json[key] as String).trim().isNotEmpty)
            key: (json[key] as String).trim()
          else if (json[key] is num)
            key: json[key] as num,
      },
      workEmail: _str(json['workEmail']),
      job: CurrentJob.fromJson(json['employment']),
      requests: [for (final r in requests) ?ChangeRequest.fromJson(r)],
    );
  }

  /// Each field's value as People keeps it (text, a date YYYY-MM-DD, a code, a year); missing when not on file.
  final Map<String, Object> values;
  final String? workEmail;
  final CurrentJob? job;

  /// Pending first, then the recent ones (People's order).
  final List<ChangeRequest> requests;

  ChangeRequest? get pendingRequest {
    for (final r in requests) {
      if (r.pending) return r;
    }
    return null;
  }

  /// The latest request HR decided or that was cancelled.
  ChangeRequest? get lastDecided {
    for (final r in requests) {
      if (!r.pending) return r;
    }
    return null;
  }

  /// A field's value as kept, as text ("2026-10-30", "male", "2015"); null when not on file.
  String? raw(String key) {
    final v = values[key];
    return v == null ? null : '$v';
  }
}
