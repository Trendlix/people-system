// The employee's own check of their details (owner's decision, 15 October 2026), asked for right after signing in (owner,
// 31 October 2026: "make the data review obligatory upon the signin for employees"): the fields they confirm, in the
// website's parts and order (packages/shared profile-confirmation.ts CONFIRM_FIELDS), the statement they accept
// (PROFILE_DISCLAIMER), and where their confirmation stands, as People sends it on their profile
// (GET /api/employees/:id `confirmation`). Values shown as the website shows them (apps/web employees/confirmation.ts).

import '../format.dart';
import 'employee_details.dart' show EmployeeLabels;

/// The parts the details are shown in, in order.
enum ConfirmSection { personal, contact, emergency, education }

const confirmSectionLabels = {
  ConfirmSection.personal: 'Personal',
  ConfirmSection.contact: 'Contact & Address',
  ConfirmSection.emergency: 'Emergency Contact',
  ConfirmSection.education: 'Education',
};

/// How a value is shown: as kept, a date, one of People's codes, Yes or No, a study year, a month.
enum ConfirmKind { text, date, choice, yesNo, studyYear, month }

/// A detail the employee confirms: its key in People, its words and its part.
class ConfirmField {
  const ConfirmField(this.key, this.label, this.section, {this.kind = ConfirmKind.text, this.choices = const {}, this.arabic = false});

  final String key;
  final String label;
  final ConfirmSection section;
  final ConfirmKind kind;

  /// A choice's codes and their words.
  final Map<String, String> choices;

  /// Kept in Arabic (right to left).
  final bool arabic;
}

/// A student's year (packages/shared student-education.ts STUDY_YEAR_LABELS).
const studyYearLabels = {
  'year_1': 'First year',
  'year_2': 'Second year',
  'year_3': 'Third year',
  'year_4': 'Fourth year',
  'year_5': 'Fifth year',
  'year_6': 'Sixth year',
  'year_7': 'Seventh year',
  'postgraduate_diploma': 'Postgraduate diploma',
  'masters': 'Master’s',
  'phd': 'PhD',
};

abstract final class ConfirmFields {
  static const all = [
    ConfirmField('fullNameEn', 'Full name (English)', ConfirmSection.personal),
    ConfirmField('fullNameAr', 'Full name (Arabic)', ConfirmSection.personal, arabic: true),
    ConfirmField('displayName', 'Display name', ConfirmSection.personal),
    ConfirmField('dateOfBirth', 'Date of birth', ConfirmSection.personal, kind: ConfirmKind.date),
    ConfirmField('gender', 'Gender', ConfirmSection.personal, kind: ConfirmKind.choice, choices: EmployeeLabels.gender),
    ConfirmField('nationality', 'Nationality', ConfirmSection.personal),
    ConfirmField('maritalStatus', 'Marital status', ConfirmSection.personal, kind: ConfirmKind.choice, choices: EmployeeLabels.maritalStatus),
    ConfirmField('militaryStatus', 'Military status', ConfirmSection.personal, kind: ConfirmKind.choice, choices: EmployeeLabels.militaryStatus),
    ConfirmField('insuranceNo', 'Social insurance number', ConfirmSection.personal),
    ConfirmField('workEmail', 'Work email', ConfirmSection.contact),
    ConfirmField('personalEmail', 'Personal email', ConfirmSection.contact),
    ConfirmField('mobile', 'Mobile', ConfirmSection.contact),
    ConfirmField('mobile2', 'Second mobile', ConfirmSection.contact),
    ConfirmField('governorate', 'Governorate', ConfirmSection.contact),
    ConfirmField('city', 'City', ConfirmSection.contact, arabic: true),
    ConfirmField('addressAr', 'Address (Arabic)', ConfirmSection.contact, arabic: true),
    ConfirmField('buildingNo', 'Building number', ConfirmSection.contact),
    ConfirmField('emergencyName', 'Name', ConfirmSection.emergency),
    ConfirmField('emergencyRelation', 'Relation', ConfirmSection.emergency),
    ConfirmField('emergencyMobile', 'Mobile', ConfirmSection.emergency),
    ConfirmField('stillStudying', 'Still studying', ConfirmSection.education, kind: ConfirmKind.yesNo),
    ConfirmField('studyYear', 'Study year', ConfirmSection.education, kind: ConfirmKind.studyYear),
    ConfirmField('expectedGraduation', 'Expected graduation', ConfirmSection.education, kind: ConfirmKind.month),
    ConfirmField('university', 'University', ConfirmSection.education),
    ConfirmField('faculty', 'Faculty', ConfirmSection.education),
    ConfirmField('degree', 'Degree', ConfirmSection.education, kind: ConfirmKind.choice, choices: EmployeeLabels.degree),
    ConfirmField('major', 'Major', ConfirmSection.education),
    ConfirmField('graduationYear', 'Graduation year', ConfirmSection.education),
    ConfirmField('educationGrade', 'Education grade', ConfirmSection.education, kind: ConfirmKind.choice, choices: EmployeeLabels.educationGrade),
    ConfirmField('qualificationAr', 'Qualification (Arabic)', ConfirmSection.education, arabic: true),
  ];

  static List<ConfirmField> of(ConfirmSection section) => [
    for (final f in all)
      if (f.section == section) f,
  ];

  static final _byKey = {for (final f in all) f.key: f};

  /// "Mobile, City": the emergency contact's fields say whose they are (the website's fieldNames).
  static String namesOf(List<String> keys) => keys
      .map((k) {
        final f = _byKey[k];
        if (f == null) return k;
        return f.section == ConfirmSection.emergency ? 'Emergency contact ${f.label.toLowerCase()}' : f.label;
      })
      .join(', ');
}

/// A detail's value as the review shows it, from the profile People sent; null for nothing on file. A woman's military
/// status is always Not applicable, as the website shows it.
String? confirmValueOf(ConfirmField f, Map json) {
  if (f.key == 'militaryStatus' && json['gender'] == 'female') return EmployeeLabels.militaryStatus['not_applicable'];
  final v = json[f.key];
  if (f.kind == ConfirmKind.yesNo) return v == true ? 'Yes' : (v == false ? 'No' : null);
  if (v == null || (v is String && v.trim().isEmpty)) return null;
  final s = v is String ? v.trim() : '$v';
  return switch (f.kind) {
    ConfirmKind.date => RegExp(r'^\d{4}-\d{2}-\d{2}').hasMatch(s) ? shortDateOf(s.substring(0, 10)) : s,
    ConfirmKind.choice => f.choices[s] ?? s,
    ConfirmKind.studyYear => studyYearLabels[s] ?? s,
    ConfirmKind.month => RegExp(r'^\d{4}-\d{2}').hasMatch(s) ? monthNameOf(s.substring(0, 7)) : s,
    _ => s,
  };
}

/// What the employee accepts when confirming (packages/shared PROFILE_DISCLAIMER), sent back with its version: People
/// refuses a confirmation of another version than the one in force, so a new wording needs this updated too.
abstract final class ProfileDisclaimer {
  static const version = 1;
  static const en = 'I confirm that the information above is correct and complete, and I accept responsibility for it. I will tell HR of any change.';
  static const ar = 'أقر بأن البيانات الواردة أعلاه صحيحة وكاملة، وأتحمل المسؤولية الكاملة عنها، وأتعهد بإخطار إدارة الموارد البشرية بأي تغيير يطرأ عليها.';
}

/// Where the employee's confirmation stands: when they last confirmed, whether nothing changed since, and what did.
class Confirmation {
  const Confirmation({required this.confirmedAt, required this.upToDate, required this.changedFields});

  static Confirmation? fromJson(Object? json) {
    if (json is! Map) return null;
    final changed = json['changedFields'];
    return Confirmation(
      confirmedAt: DateTime.tryParse('${json['confirmedAt']}'),
      upToDate: json['upToDate'] == true,
      changedFields: changed is List ? changed.whereType<String>().toList() : const [],
    );
  }

  final DateTime? confirmedAt;
  final bool upToDate;
  final List<String> changedFields;
}
