import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import '../../api/people_client.dart';
import '../../auth/auth_controller.dart';
import '../../models/account.dart';
import '../../models/interview_hours.dart';
import '../../models/payslip.dart';
import '../../providers.dart';

// What the Profile tab and the account's screens read from People, one provider a card, so each loads, fails and
// refreshes on its own. Only the person's own, as the API answers them. The profile itself is the Dashboard's
// `ownProfileProvider`.

/// One's months paid (GET /api/me/payslips), for the Profile's Payroll.
final myPayslipsProvider = FutureProvider.autoDispose<List<MyPayslip>>((ref) async => payslipsOf(await ref.read(peopleClientProvider).get('/api/me/payslips')));

/// One's sessions still open (GET /api/auth/sessions).
final mySessionsProvider = FutureProvider.autoDispose<List<OpenSession>>(
  (ref) async => sessionsOf(await ref.read(peopleClientProvider).get('/api/auth/sessions')),
);

/// The phones that sign in as them with a fingerprint (GET /api/auth/devices).
final myDevicesProvider = FutureProvider.autoDispose<List<FingerprintDevice>>(
  (ref) async => devicesOf(await ref.read(peopleClientProvider).get('/api/auth/devices')),
);

/// The credential this phone keeps for fingerprint sign-in (its id only), and whether the phone has a fingerprint set
/// up: what "This phone" and "Turn on for this phone" go by.
final thisPhoneProvider = FutureProvider.autoDispose<({String? credentialId, bool canUseFingerprint})>((ref) async {
  final device = await ref.read(sessionStoreProvider).readDevice();
  final can = await ref.read(biometricsProvider).available();
  return (credentialId: device?.id, canUseFingerprint: can);
});

/// One's interview hours (GET /api/me/interview-hours).
final myInterviewHoursProvider = FutureProvider.autoDispose<MyInterviewHours>(
  (ref) async => MyInterviewHours.fromJson(await ref.read(peopleClientProvider).get('/api/me/interview-hours')),
);

/// What reads one's calendar's busy times (GET /api/calendars/mine).
final myCalendarsProvider = FutureProvider.autoDispose<MyCalendars>(
  (ref) async => MyCalendars.fromJson(await ref.read(peopleClientProvider).get('/api/calendars/mine')),
);

/// PUT, which People's client doesn't have yet (it has GET and POST): sent the same way (the app's user agent, the
/// session as a bearer, JSON), its refusals in People's words, a refused session signing the app out.
extension PeoplePut on PeopleClient {
  Future<Object?> put(String path, Object body) async {
    final t = token == null ? null : await token!();
    final sentSession = t != null && t.isNotEmpty;
    final request = http.Request('PUT', Uri.parse('$baseUrl$path'))
      ..headers.addAll({
        'accept': 'application/json',
        'user-agent': userAgent,
        'content-type': 'application/json',
        if (sentSession) 'authorization': 'Bearer $t',
      })
      ..body = jsonEncode(body);
    http.Response res;
    try {
      res = await http.Response.fromStream(await httpClient.send(request).timeout(timeout));
    } on TimeoutException {
      throw ApiException(0, const [PeopleClient.unreachableText]);
    } on Exception {
      throw ApiException(0, const [PeopleClient.unreachableText]);
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      if (res.statusCode == 401 && sentSession) onSessionEnded?.call();
      throw ApiException(res.statusCode, PeopleClient.messagesOf(res.statusCode, res.body));
    }
    if (res.body.isEmpty) return null;
    try {
      return jsonDecode(res.body);
    } on FormatException {
      throw ApiException(res.statusCode, const ['People sent an answer the app couldn’t read.']);
    }
  }
}
