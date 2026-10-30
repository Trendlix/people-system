// One's own months paid (GET /api/me/payslips; apps/api payroll payslips.service.ts `EmployeePayslip`): newest first,
// each with its net and when it was paid; a month on hold has no payslip. Only the caller's own (the API sends nobody
// else's). Read by hand.

class MyPayslip {
  const MyPayslip({required this.lineId, required this.month, required this.paidOn, required this.net, required this.onHold});

  static MyPayslip? fromJson(Object? json) {
    if (json is! Map) return null;
    final lineId = json['lineId'], month = json['month'];
    if (lineId is! String || month is! String) return null;
    final net = json['net'];
    final paidOn = json['paidOn'];
    return MyPayslip(
      lineId: lineId,
      month: month.length >= 7 ? month.substring(0, 7) : month,
      paidOn: paidOn is String && paidOn.length >= 10 ? paidOn.substring(0, 10) : null,
      net: net is num ? net.toDouble() : null,
      onHold: json['onHold'] == true,
    );
  }

  final String lineId;

  /// "2026-09".
  final String month;

  /// YYYY-MM-DD; null when not said.
  final String? paidOn;
  final double? net;
  final bool onHold;
}

List<MyPayslip> payslipsOf(Object? json) => json is List ? [for (final p in json) ?MyPayslip.fromJson(p)] : const [];

/// EGP 12,345.50 (always two decimals), as the website writes money.
String egpOf(double amount) {
  final cents = (amount * 100).round();
  final whole = (cents.abs() ~/ 100).toString();
  final grouped = whole.replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
  return 'EGP ${cents < 0 ? '-' : ''}$grouped.${(cents.abs() % 100).toString().padLeft(2, '0')}';
}
