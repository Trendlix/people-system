/// Who is signed in (GET /api/auth/me, apps/api session-user.ts `Me`): only what the app uses, read by hand.
class Me {
  const Me({required this.id, required this.email, required this.name, required this.employeeId, required this.roles, required this.hold, this.leads = false});

  factory Me.fromJson(Object? json) {
    if (json is! Map) throw const FormatException('Me: not an object');
    final id = json['id'];
    final email = json['email'];
    if (id is! String || email is! String) throw const FormatException('Me: no id or email');
    final name = json['name'];
    final employeeId = json['employeeId'];
    final roles = json['roles'];
    return Me(
      id: id,
      email: email,
      name: name is String && name.trim().isNotEmpty ? name.trim() : null,
      employeeId: employeeId is String ? employeeId : null,
      roles: roles is List ? roles.whereType<String>().toList() : const [],
      hold: json['hold'] == true,
      leads: json['leads'] == true,
    );
  }

  final String id;
  final String email;

  /// Their name on their employee profile; null for an account that isn't an employee's.
  final String? name;
  final String? employeeId;
  final List<String> roles;

  /// The account is on Hold: check-in and check-out only (owner, 23 October 2026).
  final bool hold;

  /// Their profile is in charge of a department or team, or stands in for one who is (session-user.ts `leads`).
  final bool leads;

  /// Whether they score a team's KPI scorecards, as the website's Team KPIs is offered (nav.ts decidesForTeam, and the
  /// CEO, who scores the C-level people's).
  bool get scoresTeam => roles.contains('manager') || roles.contains('ceo') || leads;

  /// What Home greets them by: the first word of their name, else their email's.
  String get firstName {
    final n = name;
    if (n != null) return n.split(RegExp(r'\s+')).first;
    final local = email.split('@').first;
    return local.isEmpty ? email : local[0].toUpperCase() + local.substring(1);
  }
}
