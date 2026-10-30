// One's sign-ins (Your Sessions; apps/api auth sessions.service.ts `SessionView`, device-credentials.service.ts
// `DeviceView`): the sessions still open, on the website, in the app or a Claude connector, and the phones that sign in
// with a fingerprint. Read by hand.

String? _str(Object? v) => v is String && v.trim().isNotEmpty ? v.trim() : null;

/// A session still open: where it was signed in, since when, its last activity; `current` is the one asking.
class OpenSession {
  const OpenSession({
    required this.id,
    required this.kind,
    required this.createdAt,
    required this.lastActiveAt,
    required this.userAgent,
    required this.client,
    required this.current,
  });

  static OpenSession? fromJson(Object? json) {
    if (json is! Map) return null;
    final id = _str(json['id']);
    if (id == null) return null;
    return OpenSession(
      id: id,
      kind: _str(json['kind']) ?? 'web',
      createdAt: DateTime.tryParse('${json['createdAt']}'),
      lastActiveAt: DateTime.tryParse('${json['lastActiveAt']}'),
      userAgent: _str(json['userAgent']),
      client: _str(json['client']),
      current: json['current'] == true,
    );
  }

  final String id;

  /// web, app or connector (packages/shared sessions.ts).
  final String kind;
  final DateTime? createdAt;
  final DateTime? lastActiveAt;
  final String? userAgent;

  /// A Claude connector's client ("Claude"); null for the others.
  final String? client;
  final bool current;

  /// Where it is, in words: "Chrome on Windows", "Trendlix People app on Android", the connector's client.
  String get device => kind == 'connector' ? (client ?? 'Claude') : deviceOf(userAgent);
}

/// The sessions People listed, newest first.
List<OpenSession> sessionsOf(Object? json) => json is List ? [for (final s in json) ?OpenSession.fromJson(s)] : const [];

/// The words for a session's kind (packages/shared SESSION_KIND_LABELS).
const sessionKindLabels = {'web': 'Website', 'app': 'App', 'connector': 'Claude connector'};

/// A phone that signs in to the app with a fingerprint.
class FingerprintDevice {
  const FingerprintDevice({required this.id, required this.deviceName, required this.platform, required this.createdAt, required this.lastUsedAt});

  static FingerprintDevice? fromJson(Object? json) {
    if (json is! Map) return null;
    final id = _str(json['id']);
    if (id == null) return null;
    return FingerprintDevice(
      id: id,
      deviceName: _str(json['deviceName']) ?? 'Phone',
      platform: _str(json['platform']) ?? '',
      createdAt: DateTime.tryParse('${json['createdAt']}'),
      lastUsedAt: DateTime.tryParse('${json['lastUsedAt']}'),
    );
  }

  final String id;
  final String deviceName;

  /// android or ios.
  final String platform;
  final DateTime? createdAt;

  /// Its last fingerprint sign-in; null until the first.
  final DateTime? lastUsedAt;

  /// "Android", "iPhone" (packages/shared DEVICE_PLATFORM_LABELS).
  String get platformLabel => switch (platform) {
    'android' => 'Android',
    'ios' => 'iPhone',
    _ => platform,
  };
}

List<FingerprintDevice> devicesOf(Object? json) => json is List ? [for (final d in json) ?FingerprintDevice.fromJson(d)] : const [];

/// How many days without use stop a phone's fingerprint sign-in (packages/shared DEVICE_UNUSED_DAYS).
const deviceUnusedDays = 90;

/// The browser and system a user agent names, or the app (apps/web lib/devices.ts `deviceOf`); "Unknown device" when
/// it says neither. Only a hint: it is what the browser says of itself. The app's own ("… (android) TrendLIXPeople")
/// names its platform in small letters.
String deviceOf(String? userAgent) {
  final ua = userAgent?.trim() ?? '';
  String? system;
  if (ua.contains('iPhone') || ua.contains('(ios)')) {
    system = 'iPhone';
  } else if (ua.contains('iPad')) {
    system = 'iPad';
  } else if (ua.contains('Android') || ua.contains('(android)')) {
    system = 'Android';
  } else if (ua.contains('CrOS')) {
    system = 'ChromeOS';
  } else if (ua.contains('Windows')) {
    system = 'Windows';
  } else if (ua.contains('Mac OS X') || ua.contains('Macintosh')) {
    system = 'macOS';
  } else if (ua.contains('Linux')) {
    system = 'Linux';
  }
  if (ua.endsWith('TrendLIXPeople')) return system == null ? 'Trendlix People app' : 'Trendlix People app on $system';
  String? browser;
  if (RegExp(r'Edg(e|A|iOS)?/').hasMatch(ua)) {
    browser = 'Edge';
  } else if (RegExp(r'OPR/|Opera').hasMatch(ua)) {
    browser = 'Opera';
  } else if (ua.contains('SamsungBrowser/')) {
    browser = 'Samsung Internet';
  } else if (RegExp(r'Firefox/|FxiOS/').hasMatch(ua)) {
    browser = 'Firefox';
  } else if (RegExp(r'Chrome/|CriOS/').hasMatch(ua)) {
    browser = 'Chrome';
  } else if (ua.contains('Safari/') && ua.contains('Version/')) {
    browser = 'Safari';
  }
  if (browser != null && system != null) return '$browser on $system';
  return browser ?? system ?? 'Unknown device';
}
