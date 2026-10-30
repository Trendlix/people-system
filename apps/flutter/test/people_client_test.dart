import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:people/api/people_client.dart';

// The client every screen talks to People with (README §2): an app session's user agent, the session as a bearer,
// People's refusals in its own words.

PeopleClient clientOf(Future<http.Response> Function(http.Request) handler, {String? token}) => PeopleClient(
  baseUrl: 'https://people.example.test:8443',
  httpClient: MockClient(handler),
  userAgent: userAgentOf('0.2.1', 'android'),
  token: () async => token,
);

void main() {
  test('says it is the app (the mark last), sends the session as a bearer and JSON both ways', () async {
    late http.Request sent;
    final client = clientOf((req) async {
      sent = req;
      return http.Response('{"ok":true}', 200);
    }, token: 'session-token');
    final answer = await client.post('/api/attendance/check-in', {'lat': 30.05});
    expect(answer, {'ok': true});
    expect(sent.method, 'POST');
    expect(sent.url.toString(), 'https://people.example.test:8443/api/attendance/check-in');
    expect(sent.headers['user-agent'], 'Trendlix People/0.2.1 (android) TrendLIXPeople');
    expect(sent.headers['user-agent']!.endsWith(appUserAgentMark), isTrue);
    expect(sent.headers['authorization'], 'Bearer session-token');
    expect(sent.headers['content-type'], startsWith('application/json'));
    expect(jsonDecode(sent.body), {'lat': 30.05});
  });

  test('sends no bearer without a session, and reads an empty answer as nothing', () async {
    late http.Request sent;
    final answer = await clientOf((req) async {
      sent = req;
      return http.Response('', 204);
    }).get('/api/health');
    expect(answer, isNull);
    expect(sent.headers.containsKey('authorization'), isFalse);
  });

  test('says People’s refusal in its own words: one message or a list', () async {
    await expectLater(
      clientOf((_) async => http.Response('{"statusCode":409,"message":"You checked in already."}', 409)).get('/x'),
      throwsA(isA<ApiException>().having((e) => e.status, 'status', 409).having((e) => e.message, 'message', 'You checked in already.')),
    );
    await expectLater(
      clientOf((_) async => http.Response('{"message":["Choose the leave type.","Choose the days."]}', 400)).post('/x', {}),
      throwsA(isA<ApiException>().having((e) => e.messages, 'messages', ['Choose the leave type.', 'Choose the days.'])),
    );
  });

  test('says a plain reason when People gives none, and “can’t reach” for a network failure', () async {
    await expectLater(
      clientOf((_) async => http.Response('<html>Bad gateway</html>', 502)).get('/x'),
      throwsA(isA<ApiException>().having((e) => e.message, 'message', 'Something went wrong on People’s side. Please try again.')),
    );
    await expectLater(
      clientOf((_) async => http.Response('', 401)).get('/x'),
      throwsA(isA<ApiException>().having((e) => e.message, 'message', 'Please sign in again.')),
    );
    await expectLater(
      clientOf((_) async => throw const SocketException('no network')).get('/x'),
      throwsA(isA<ApiException>().having((e) => e.unreachable, 'unreachable', isTrue).having((e) => e.message, 'message', PeopleClient.unreachableText)),
    );
  });

  test('reads the session from the sign-in’s cookie, even among others, and refuses a sign-in without one', () async {
    expect(PeopleClient.sessionTokenOf('ps_session=abc.def; Max-Age=28800; Path=/; Expires=Thu, 30 Oct 2026 18:00:00 GMT; HttpOnly'), 'abc.def');
    expect(PeopleClient.sessionTokenOf('other=1; Path=/, ps_session=a%2Bb; Path=/'), 'a+b');
    expect(PeopleClient.sessionTokenOf('xps_session=nope; Path=/'), isNull);
    expect(PeopleClient.sessionTokenOf(null), isNull);
    late http.Request sent;
    final answer = await clientOf((req) async {
      sent = req;
      return http.Response('{"id":"u1"}', 200, headers: {'set-cookie': 'ps_session=tok; Path=/'});
    }, token: 'old-session').signIn('/api/auth/login', {'email': 'a@b.test'});
    expect(answer.token, 'tok');
    expect(answer.body, {'id': 'u1'});
    expect(sent.headers.containsKey('authorization'), isFalse);
    await expectLater(
      clientOf((_) async => http.Response('{"id":"u1"}', 200)).signIn('/api/auth/login', {}),
      throwsA(isA<ApiException>()),
    );
  });

  test('says a session ended only when a request that carried one is refused', () async {
    var ended = 0;
    PeopleClient client(String? token) => PeopleClient(
      baseUrl: 'https://people.example.test:8443',
      httpClient: MockClient((_) async => http.Response('', 401)),
      userAgent: userAgentOf('0.2.1', 'android'),
      token: () async => token,
      onSessionEnded: () => ended++,
    );
    await expectLater(client('session').get('/api/me/attendance/today'), throwsA(isA<ApiException>()));
    expect(ended, 1);
    await expectLater(client(null).get('/api/me/attendance/today'), throwsA(isA<ApiException>()));
    await expectLater(client('session').signIn('/api/auth/login', {}), throwsA(isA<ApiException>()));
    expect(ended, 1);
  });
}
