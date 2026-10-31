import 'dart:convert';

/// Where the app finds People, given at build time (README §2): `--dart-define=PEOPLE_API_URL=…` and
/// `--dart-define=PEOPLE_API_CA=…` (the private authority's root, base64 as deploy/ca-cert.sh prints it; CI takes it
/// from the GitHub Actions variable `API_CA_CERT`). A build without them talks to the live server and trusts only the
/// phone's own authorities (which don't know People's): enough for the tests, never for a phone.
class AppConfig {
  const AppConfig({required this.apiUrl, required this.caPem, required this.version, this.build = '', this.commit = '', this.builtAt = ''});

  /// People's API, without a trailing slash: `https://srv2055591.hstgr.cloud:8443`.
  final String apiUrl;

  /// The private authority's root certificate (PEM), or null when none was given.
  final String? caPem;

  /// The app's version, as the build named it (`0.2.12`), for the user agent and the About line.
  final String version;

  /// The build's stamp, for About this app (CI: `PEOPLE_APP_BUILD`, `PEOPLE_APP_COMMIT`, `PEOPLE_APP_BUILT`): the version
  /// code (1019), the commit it was built from (5dbf028) and when (2026-10-31T17:02:11Z); empty for a build without them.
  final String build;
  final String commit;
  final String builtAt;

  static const _defaultApi = 'https://srv2055591.hstgr.cloud:8443';

  /// The settings this build was given.
  factory AppConfig.fromEnvironment() => AppConfig.parse(
    apiUrl: const String.fromEnvironment('PEOPLE_API_URL'),
    caBase64: const String.fromEnvironment('PEOPLE_API_CA'),
    version: const String.fromEnvironment('PEOPLE_APP_VERSION'),
    build: const String.fromEnvironment('PEOPLE_APP_BUILD'),
    commit: const String.fromEnvironment('PEOPLE_APP_COMMIT'),
    builtAt: const String.fromEnvironment('PEOPLE_APP_BUILT'),
  );

  /// The settings from their raw values: an empty address the live server's, a base64 root decoded (null when it
  /// isn't one), an empty version `0.0.0`.
  factory AppConfig.parse({
    required String apiUrl,
    required String caBase64,
    required String version,
    String build = '',
    String commit = '',
    String builtAt = '',
  }) {
    final url = apiUrl.trim().isEmpty ? _defaultApi : apiUrl.trim().replaceAll(RegExp(r'/+$'), '');
    return AppConfig(
      apiUrl: url,
      caPem: pemOf(caBase64),
      version: version.trim().isEmpty ? '0.0.0' : version.trim(),
      build: build.trim(),
      commit: commit.trim(),
      builtAt: builtAt.trim(),
    );
  }

  /// A root certificate from its base64 (the whole PEM file, as ca-cert.sh prints it) or its PEM itself; null otherwise.
  static String? pemOf(String value) {
    final v = value.trim();
    if (v.isEmpty) return null;
    if (v.contains('-----BEGIN CERTIFICATE-----')) return v;
    try {
      final pem = utf8.decode(base64.decode(v.replaceAll(RegExp(r'\s'), '')));
      return pem.contains('-----BEGIN CERTIFICATE-----') ? pem : null;
    } on FormatException {
      return null;
    }
  }
}
