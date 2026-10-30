// One's own employee profile (GET /api/employees/:id, apps/web lib/types.ts `EmployeeProfile`): what the Dashboard and
// the Profile tab show, read by hand; the rest kept as People sent it (`raw`) for the screens that need more.

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
      // the website's banner (apps/web employees/confirmation.ts bannerMessage): not up to date
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

  /// Their details wait for them to confirm (the website's banner).
  final bool needsConfirming;
  final String? jobTitle;
  final String? department;
  final String? manager;
  final String? joinDate;
  final String? employmentType;

  /// The shift's working days, 0 = Sunday … 6 = Saturday.
  final List<int> workingDays;
  final Map raw;

  /// The papers HR still needs from them (the Documents part's gaps).
  List<String> get papersMissing => [
    for (final g in missing)
      if (g.tab == 'documents') g.label,
  ];
}
