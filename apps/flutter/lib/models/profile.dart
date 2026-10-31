// One's own employee profile (GET /api/employees/:id, apps/web lib/types.ts `EmployeeProfile`): what the Dashboard and
// the Profile tab show, read by hand; the rest kept as People sent it (`raw`) for the screens that need more.

import 'photo_request.dart';
import 'review.dart';

/// Something missing from the profile (the completeness' gaps): its words, and the part of the profile it is in.
typedef ProfileGap = ({String key, String label, String tab});

class OwnProfile {
  const OwnProfile({
    required this.id,
    required this.fullNameEn,
    required this.fullNameAr,
    required this.displayName,
    required this.employeeCode,
    required this.percent,
    required this.missing,
    required this.needsConfirming,
    required this.jobTitle,
    required this.department,
    required this.manager,
    required this.joinDate,
    required this.employmentType,
    required this.workingDays,
    required this.raw,
  });

  factory OwnProfile.fromJson(Object? json) {
    if (json is! Map) throw const FormatException('OwnProfile: not an object');
    final id = json['id'];
    if (id is! String) throw const FormatException('OwnProfile: no id');
    final c = json['completeness'] is Map ? json['completeness'] as Map : const {};
    final missing = c['missing'] is List ? c['missing'] as List : const [];
    final e = json['employment'] is Map ? json['employment'] as Map : null;
    final shift = e?['shift'] is Map ? e!['shift'] as Map : null;
    final days = shift?['workingDays'];
    final confirmation = json['confirmation'];
    String? str(Object? v) => v is String && v.trim().isNotEmpty ? v.trim() : null;
    String? nested(Object? m, String key) => m is Map ? str(m[key]) : null;
    return OwnProfile(
      id: id,
      fullNameEn: str(json['fullNameEn']) ?? '',
      fullNameAr: str(json['fullNameAr']),
      displayName: str(json['displayName']),
      employeeCode: str(json['employeeCode']),
      percent: c['percent'] is num ? (c['percent'] as num).round() : 100,
      missing: [
        for (final m in missing)
          if (m is Map) (key: '${m['key'] ?? ''}', label: '${m['label'] ?? ''}', tab: '${m['tab'] ?? ''}'),
      ],
      // not up to date (apps/web employees/confirmation.ts bannerMessage)
      needsConfirming: confirmation is Map && confirmation['upToDate'] == false,
      jobTitle: nested(e?['jobTitle'], 'titleEn'),
      department: nested(e?['department'], 'nameEn'),
      manager: nested(e?['manager'], 'fullNameEn'),
      joinDate: e == null ? null : str(e['joinDate']),
      employmentType: e == null ? null : str(e['employmentType']),
      workingDays: days is List ? days.whereType<num>().map((d) => d.toInt()).toList() : const [0, 1, 2, 3, 4],
      raw: json,
    );
  }

  final String id;
  final String fullNameEn;
  final String? fullNameAr;
  final String? displayName;
  final String? employeeCode;

  /// How complete the profile is, 0–100, and what is missing from it.
  final int percent;
  final List<ProfileGap> missing;

  /// Their details wait for them to confirm: never confirmed, or changed since.
  final bool needsConfirming;
  final String? jobTitle;
  final String? department;
  final String? manager;
  final String? joinDate;
  final String? employmentType;

  /// The shift's working days, 0 = Sunday … 6 = Saturday.
  final List<int> workingDays;
  final Map raw;

  /// Every paper the employee file needs and whether HR has it on file (owner, 31 October 2026: "allow the employee to
  /// see the files with a red or green icon if submitted or missing"); empty from an API from before it.
  List<({String label, bool onFile})> get papers {
    final c = raw['completeness'];
    final list = c is Map ? c['papers'] : null;
    return [
      if (list is List)
        for (final x in list)
          if (x is Map && x['label'] is String) (label: x['label'] as String, onFile: x['onFile'] == true),
    ];
  }

  /// Where their confirmation stands; none from an API from before confirmations.
  Confirmation? get confirmation => Confirmation.fromJson(raw['confirmation']);

  /// A change they asked HR for still waits.
  bool get changeWaiting {
    final list = raw['changeRequests'];
    return list is List && list.any((r) => r is Map && r['status'] == 'pending');
  }

  /// The review comes first (owner, 31 October 2026: "make the data review obligatory upon the signin for employees"):
  /// their details aren't confirmed as they are now, and no change they asked for waits for HR. Asking for a change is
  /// their part done, so it lets them through while HR decides; once HR decides, the review comes back unless their
  /// details are as they confirmed them. The website's rule (apps/web employees/confirmation.ts mustReview).
  bool get mustReview {
    final c = confirmation;
    return c != null && !c.upToDate && !changeWaiting;
  }

  /// Their picture beside their name: the personal photo's id in their employee file, and the square of it HR chose
  /// (fractions of the photo: x, y, w, h); none without one, or from an API that doesn't send it to them.
  String? get photoId => raw['photoId'] is String ? raw['photoId'] as String : null;

  ({double x, double y, double w, double h})? get photoCrop {
    final c = raw['photoCrop'];
    if (c is! Map) return null;
    final [x, y, w, h] = [for (final k in ['x', 'y', 'w', 'h']) c[k] is num ? (c[k] as num).toDouble() : -1.0];
    return [x, y, w, h].every((v) => v >= 0 && v <= 1) && w > 0 && h > 0 ? (x: x, y: y, w: w, h: h) : null;
  }

  /// The new photos they sent HR (owner, 31 October 2026): the one waiting first, then the latest ones.
  List<PhotoRequest> get photoRequests => photoRequestsOf(raw['photoRequests']);

  /// The papers HR still needs from them (the Documents part's gaps).
  List<String> get papersMissing => [
    for (final g in missing)
      if (g.tab == 'documents') g.label,
  ];
}
