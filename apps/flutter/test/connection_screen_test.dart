import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:people/api/people_client.dart';
import 'package:people/features/connection/connection_screen.dart';
import 'package:people/providers.dart';
import 'package:people/theme/app_theme.dart';

// Phase 0's screen: whether the app reaches People.

Widget screenWith(Future<http.Response> Function(http.Request) handler) => ProviderScope(
  retry: noRetry,
  overrides: [
    peopleClientProvider.overrideWithValue(
      PeopleClient(baseUrl: 'https://people.example.test', httpClient: MockClient(handler), userAgent: userAgentOf('0.0.0', 'android')),
    ),
  ],
  child: MaterialApp(theme: appTheme(), home: const ConnectionScreen()),
);

void main() {
  testWidgets('says it is connected when People’s health answers ok', (tester) async {
    await tester.pumpWidget(screenWith((req) async => http.Response('{"status":"ok","database":"ok"}', 200)));
    expect(find.text('Connecting to People…'), findsOneWidget);
    await tester.pumpAndSettle();
    expect(find.text('Connected to People'), findsOneWidget);
  });

  testWidgets('says why not, and tries again on a tap', (tester) async {
    var calls = 0;
    await tester.pumpWidget(
      screenWith((req) async {
        calls++;
        return calls == 1 ? http.Response('', 502) : http.Response('{"status":"ok"}', 200);
      }),
    );
    await tester.pumpAndSettle();
    expect(find.text('Something went wrong on People’s side. Please try again.'), findsOneWidget);
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('Connected to People'), findsOneWidget);
    expect(calls, 2);
  });
}
