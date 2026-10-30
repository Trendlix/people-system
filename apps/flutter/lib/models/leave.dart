// The employee's leave balance (GET /api/me/leave/balances?year=, apps/web lib/types.ts `LeaveBalances`): the annual
// leave's figures, read by hand; the other types for the screens that show them.

class AnnualBalance {
  const AnnualBalance({
    required this.entitlement,
    required this.carriedIn,
    required this.adjustments,
    required this.taken,
    required this.booked,
    required this.pending,
    required this.available,
    required this.usableFrom,
  });

  factory AnnualBalance.fromJson(Object? json) {
    final m = json is Map ? json : const {};
    double n(String k) => m[k] is num ? (m[k] as num).toDouble() : 0;
    return AnnualBalance(
      entitlement: n('entitlement'),
      carriedIn: n('carriedIn'),
      adjustments: n('adjustments'),
      taken: n('taken'),
      booked: n('booked'),
      pending: n('pending'),
      available: n('available'),
      usableFrom: m['usableFrom'] is String ? m['usableFrom'] as String : null,
    );
  }

  final double entitlement;
  final double carriedIn;
  final double adjustments;
  final double taken;
  final double booked;
  final double pending;
  final double available;
  final String? usableFrom;

  /// The year's days in all: the entitlement, what was carried in and HR's adjustments.
  double get year => entitlement + carriedIn + adjustments;
}

/// Another leave type's balance: what was used, and what is left (null: no limit).
class TypeBalance {
  const TypeBalance({
    required this.typeId,
    required this.nameEn,
    required this.nameAr,
    required this.used,
    required this.left,
    required this.timesInService,
    required this.daysPerYear,
  });

  factory TypeBalance.fromJson(Object? json) {
    final m = json is Map ? json : const {};
    return TypeBalance(
      typeId: '${m['typeId'] ?? ''}',
      nameEn: '${m['nameEn'] ?? ''}',
      nameAr: m['nameAr'] is String ? m['nameAr'] as String : null,
      used: m['used'] is num ? (m['used'] as num).toDouble() : 0,
      left: m['left'] is num ? (m['left'] as num).toDouble() : null,
      timesInService: m['timesInService'] is num ? (m['timesInService'] as num).toInt() : 0,
      daysPerYear: m['daysPerYear'] is num ? (m['daysPerYear'] as num).toDouble() : null,
    );
  }

  final String typeId;
  final String nameEn;
  final String? nameAr;
  final double used;
  final double? left;
  final int timesInService;
  final double? daysPerYear;
}

class LeaveBalances {
  const LeaveBalances({required this.year, required this.annual, required this.types});

  factory LeaveBalances.fromJson(Object? json) {
    if (json is! Map) throw const FormatException('LeaveBalances: not an object');
    final types = json['types'];
    return LeaveBalances(
      year: json['year'] is num ? (json['year'] as num).toInt() : 0,
      annual: AnnualBalance.fromJson(json['annual']),
      types: types is List ? types.map(TypeBalance.fromJson).toList() : const [],
    );
  }

  final int year;
  final AnnualBalance annual;
  final List<TypeBalance> types;
}

/// 19, 1.5: days as People counts them, without a needless ".0".
String daysFigure(double days) => days == days.roundToDouble() ? days.toInt().toString() : days.toString();
