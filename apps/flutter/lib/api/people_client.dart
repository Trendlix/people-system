import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// The mark People reads at the end of the user agent: a sign-in from the app is an `app` session, not a website one
/// (packages/shared sessions.ts `APP_USER_AGENT_MARK`).
const appUserAgentMark = 'TrendLIXPeople';

/// The app's user agent: its name, version and platform, the mark last.
String userAgentOf(String version, String platform) => 'Trendlix People/$version ($platform) $appUserAgentMark';

/// The cookie People's sign-in sets the session in (apps/api session-user.ts `SESSION_COOKIE`): the app reads the
/// token from it once and sends it as a bearer from then on.
const sessionCookie = 'ps_session';

/// A sign-in's answer: the session token (from its cookie) and the body.
typedef SignInAnswer = ({String token, Object? body});

/// What People (or the way to it) refused, in words to show: its `message` (one, or a list), else a plain reason.
class ApiException implements Exception {
  ApiException(this.status, this.messages);

  /// The HTTP status; 0 when People couldn't be reached.
  final int status;
  final List<String> messages;

  String get message => messages.join(' ');

  bool get unreachable => status == 0;

  @override
  String toString() => 'ApiException($status): $message';
}

/// Talks to People's API: JSON in and out, the app's user agent, the session as a bearer when there is one.
class PeopleClient {
  PeopleClient({
    required this.baseUrl,
    required this.httpClient,
    required this.userAgent,
    this.token,
    this.onSessionEnded,
    this.location,
    this.onRequest,
    this.timeout = const Duration(seconds: 20),
  });

  /// The phone's last position for People's activity log (LocationCache.header), sent as `x-people-location`; none: not
  /// sent.
  final String? Function()? location;

  /// Told of each request (LocationCache.refreshIfStale: the position read again at most once a minute).
  final void Function()? onRequest;

  /// `https://host:port`, no trailing slash.
  final String baseUrl;
  final http.Client httpClient;
  final String userAgent;

  /// The session token to send (secure storage), or none.
  final Future<String?> Function()? token;

  /// Called when People refuses a request that carried a session (401): it ended, or was signed out elsewhere.
  final void Function()? onSessionEnded;
  final Duration timeout;

  static const unreachableText = 'Can’t reach People. Check your connection and try again.';

  /// The header the phone's position goes in (People's activity log).
  static const locationHeader = 'x-people-location';

  Future<Object?> get(String path) async => _bodyOf(await _send('GET', path));

  Future<Object?> post(String path, [Object? body]) async => _bodyOf(await _send('POST', path, body: body));

  /// Signing in (a password, or the phone's credential): the session People sets in its cookie, and the answer. Sent
  /// without any session the app still holds.
  Future<SignInAnswer> signIn(String path, Object body) async {
    final res = await _send('POST', path, body: body, withSession: false);
    final token = sessionTokenOf(res.headers['set-cookie']);
    if (token == null) throw ApiException(res.statusCode, const ['People signed you in but sent no session. Please try again.']);
    return (token: token, body: _bodyOf(res));
  }

  /// The session token in a Set-Cookie header (several cookies may come joined by commas).
  static String? sessionTokenOf(String? setCookie) {
    if (setCookie == null) return null;
    final m = RegExp('(?:^|[;,]\\s*)$sessionCookie=([^;,\\s]+)').firstMatch(setCookie);
    if (m == null) return null;
    final value = Uri.decodeComponent(m.group(1)!);
    return value.isEmpty ? null : value;
  }

  Future<http.Response> _send(String method, String path, {Object? body, bool withSession = true}) async {
    final headers = <String, String>{'accept': 'application/json', 'user-agent': userAgent};
    // where the phone is, for People's activity log (owner, 31 October 2026: "with location and ip capture")
    final where = location?.call();
    if (where != null) headers[locationHeader] = where;
    onRequest?.call();
    final t = !withSession || token == null ? null : await token!();
    final sentSession = t != null && t.isNotEmpty;
    if (sentSession) headers['authorization'] = 'Bearer $t';
    final request = http.Request(method, Uri.parse('$baseUrl$path'))..headers.addAll(headers);
    if (body != null) {
      request.headers['content-type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    http.Response res;
    try {
      res = await http.Response.fromStream(await httpClient.send(request).timeout(timeout));
    } on TimeoutException {
      throw ApiException(0, const [unreachableText]);
    } on Exception {
      // no network, a refused certificate, a closed connection: nothing the person can fix but trying again
      throw ApiException(0, const [unreachableText]);
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return res;
    if (res.statusCode == 401 && sentSession) onSessionEnded?.call();
    throw ApiException(res.statusCode, messagesOf(res.statusCode, res.body));
  }

  Object? _bodyOf(http.Response res) {
    if (res.body.isEmpty) return null;
    try {
      return jsonDecode(res.body);
    } on FormatException {
      throw ApiException(res.statusCode, const ['People sent an answer the app couldn’t read.']);
    }
  }

  /// People's words for a refusal (`{"message": "…"}` or `{"message": ["…", "…"]}`), else a plain one by status.
  static List<String> messagesOf(int status, String body) {
    try {
      final decoded = jsonDecode(body);
      if (decoded is Map) {
        final m = decoded['message'];
        if (m is String && m.trim().isNotEmpty) return [m.trim()];
        if (m is List) {
          final said = m.whereType<String>().map((s) => s.trim()).where((s) => s.isNotEmpty).toList();
          if (said.isNotEmpty) return said;
        }
      }
    } on FormatException {
      // not JSON: said by status below
    }
    if (status == 401) return const ['Please sign in again.'];
    if (status == 403) return const ['You don’t have access to this.'];
    if (status == 404) return const ['Not found.'];
    if (status == 429) return const ['Too many tries. Please wait a minute and try again.'];
    return const ['Something went wrong on People’s side. Please try again.'];
  }
}
