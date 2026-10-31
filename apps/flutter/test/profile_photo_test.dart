import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/profile/account_screens.dart' show ProfilePhotoScreen;
import 'package:people/features/profile/photo_data.dart';
import 'package:people/features/profile/profile_words.dart';
import 'package:people/features/requests/requests_data.dart';
import 'package:people/models/profile.dart';
import 'package:people/providers.dart';
import 'package:people/shell/shell_words.dart';

import 'fakes.dart';
import 'profile_models_test.dart' show ownProfileJson;
import 'requests_fixtures.dart' show FakePhotos;

// A new photo of themself sent to HR from Profile Image (owner, 31 October 2026: "allow them to upload a new photo as a
// request and approved from the HR"): their picture now (their own, from People), a photo taken or chosen and seen
// before it goes, sent with a note as People's form takes it (multipart, "file"); then it waits, theirs to see and to
// cancel; what HR decided on the last one, with HR's note.

final png = base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');

http.Response picture(http.Request req) => http.Response.bytes(png, 200, headers: {'content-type': 'image/png'});

Map<String, Object?> photoRequestJson({String id = 'p1', String status = 'pending', String? note = 'For my badge', String? decisionNote}) => {
  'id': id,
  'employee': {'id': 'e1', 'employeeCode': 'TLX-055-25', 'fullNameEn': 'Mohamed Abdelrahman'},
  'fileName': 'me.jpg',
  'mimeType': 'image/jpeg',
  'sizeBytes': 10,
  'note': note,
  'status': status,
  'requestedBy': {'email': 'm.abdelrahman@trendlix.example'},
  'requestedAt': '2026-10-30T09:30:00.000Z',
  'decidedBy': null,
  'decidedAt': status == 'pending' ? null : '2026-10-31T09:30:00.000Z',
  'decisionNote': decisionNote,
  'photoId': null,
};

Map<String, Object?> profileWith({String? photoId, List<Map<String, Object?>> photos = const []}) => {
  ...ownProfileJson(),
  'photoId': photoId,
  'photoCrop': photoId == null ? null : {'x': 0.1, 'y': 0.1, 'w': 0.5, 'h': 0.5},
  'photoRequests': photos,
};

Future<void> openPhoto(WidgetTester tester, FakePeople people, {FakePhotos? photos}) async {
  phoneScreen(tester);
  await tester.pumpWidget(
    ProviderScope(
      retry: noRetry,
      overrides: [
        ...overridesFor(people, store: MemorySessionStore(token: 'kept')),
        photoSourceProvider.overrideWithValue(photos ?? FakePhotos('me.jpg')),
      ],
      child: const PeopleApp(),
    ),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.text(ShellWords.more));
  await tester.pumpAndSettle();
  await tester.tap(find.text(ShellWords.changePhoto));
  await tester.pumpAndSettle();
}

Finder get page => find.descendant(of: find.byType(ProfilePhotoScreen), matching: find.byType(Scrollable)).first;

Future<void> tapShown(WidgetTester tester, Finder finder) async {
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pumpAndSettle();
  await tester.scrollUntilVisible(finder, 200, scrollable: page);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  late FakePeople people;
  late Map<String, Object?> profile;

  setUp(() {
    profile = profileWith(photoId: 'ph1');
    people = FakePeople()
      ..on('GET /api/auth/me', (req) => json(meJson(name: 'Mohamed Abdelrahman')))
      ..on('GET /api/employees/e1', (req) => json(profile))
      ..on('GET /api/paperwork/ph1/photo', picture)
      ..on('GET /api/photo-requests/p1/photo', picture);
  });

  test('reads their picture, HR’s square of it and the photos they sent', () {
    final p = OwnProfile.fromJson(profileWith(photoId: 'ph1', photos: [photoRequestJson(), photoRequestJson(id: 'p0', status: 'rejected', decisionNote: 'Blurry')]));
    expect(p.photoId, 'ph1');
    expect(p.photoCrop, (x: 0.1, y: 0.1, w: 0.5, h: 0.5));
    expect(p.photoRequests.map((r) => (r.id, r.pending, r.decisionNote)), [('p1', true, null), ('p0', false, 'Blurry')]);
    expect(OwnProfile.fromJson(ownProfileJson()).photoRequests, isEmpty);
    expect(ownPhotoPath('ph1'), '/api/paperwork/ph1/photo');
    expect(sentPhotoPath('p1'), '/api/photo-requests/p1/photo');
  });

  testWidgets('shows their own picture, and sends a photo taken or chosen to HR, seen first, with a note', (tester) async {
    final photos = FakePhotos('me.jpg');
    people.on('POST /api/employees/e1/photo-requests', (req) {
      profile = profileWith(photoId: 'ph1', photos: [photoRequestJson()]);
      return json(photoRequestJson(), 201);
    });
    await openPhoto(tester, people, photos: photos);

    // their picture now, read from People with their session
    expect(people.calls, contains('GET /api/paperwork/ph1/photo'));
    expect(find.text(AccountWords.photoFromFile), findsOneWidget);
    expect(find.descendant(of: find.byType(RoundPicture).first, matching: find.byType(Image)), findsOneWidget);

    await tapShown(tester, find.text(AccountWords.choosePhoto));
    expect(photos.picked, 1);
    expect(find.byWidgetPredicate((w) => w is Semantics && w.properties.label == AccountWords.chosenPhoto), findsOneWidget);
    // another, then send it
    await tapShown(tester, find.text(AccountWords.chooseAnother));
    expect(find.text(AccountWords.takePhoto), findsOneWidget);
    await tapShown(tester, find.text(AccountWords.takePhoto));
    expect(photos.picked, 2);
    await tester.enterText(find.byType(TextField), '  For my badge  ');
    await tapShown(tester, find.text(AccountWords.sendPhoto));

    final sent = people.sent.lastWhere((r) => '${r.method} ${r.url.path}' == 'POST /api/employees/e1/photo-requests');
    final body = utf8.decode(sent.bodyBytes, allowMalformed: true);
    expect(sent.headers['content-type'], startsWith('multipart/form-data'));
    expect(body, contains('name="file"; filename="me.jpg"'));
    expect(body, contains('name="note"'));
    expect(body, contains('For my badge'));
    expect(find.text(AccountWords.photoSent), findsOneWidget);

    // waiting now: the photo sent, theirs to see; no second one meanwhile
    await tester.scrollUntilVisible(find.text(AccountWords.photoWaitingSince('30 Oct 2026')), 200, scrollable: page);
    expect(people.calls, contains('GET /api/photo-requests/p1/photo'));
    expect(find.text('${AccountWords.yourNote}: For my badge'), findsOneWidget);
    expect(find.text(AccountWords.takePhoto), findsNothing);
  });

  testWidgets('cancels the photo waiting, after asking', (tester) async {
    profile = profileWith(photoId: 'ph1', photos: [photoRequestJson()]);
    people.on('POST /api/photo-requests/p1/cancel', (req) {
      profile = profileWith(photoId: 'ph1', photos: [photoRequestJson(status: 'cancelled')]);
      return json(photoRequestJson(status: 'cancelled'));
    });
    await openPhoto(tester, people);
    await tapShown(tester, find.text(AccountWords.cancelPhoto));
    expect(find.text(AccountWords.cancelPhotoAsk), findsOneWidget);
    await tester.tap(find.text(AccountWords.keepPhoto));
    await tester.pumpAndSettle();
    expect(people.calls, isNot(contains('POST /api/photo-requests/p1/cancel')));

    await tapShown(tester, find.text(AccountWords.cancelPhoto));
    await tester.tap(find.widgetWithText(FilledButton, AccountWords.cancelPhoto));
    await tester.pumpAndSettle();
    expect(people.calls, contains('POST /api/photo-requests/p1/cancel'));
    expect(find.text(AccountWords.photoCancelled), findsOneWidget);
    await tester.scrollUntilVisible(find.text(AccountWords.photoOutcome('cancelled', '30 Oct 2026')), 200, scrollable: page);
    expect(find.text(AccountWords.takePhoto), findsOneWidget);
  });

  testWidgets('says what HR decided on the last one, with HR’s note, and People’s refusal in its words', (tester) async {
    profile = profileWith(photos: [photoRequestJson(status: 'rejected', decisionNote: 'Please use one without sunglasses.')]);
    people.on('POST /api/employees/e1/photo-requests', (req) => json({'message': 'The photo must be a JPEG, PNG or WebP image.'}, 400));
    await openPhoto(tester, people);
    expect(find.text(AccountWords.noPhotoYet), findsOneWidget);
    await tester.scrollUntilVisible(find.text(AccountWords.photoOutcome('rejected', '30 Oct 2026')), 200, scrollable: page);
    expect(find.text('${AccountWords.hrNote}: Please use one without sunglasses.'), findsOneWidget);

    await tapShown(tester, find.text(AccountWords.choosePhoto));
    await tapShown(tester, find.text(AccountWords.sendPhoto));
    expect(find.text('The photo must be a JPEG, PNG or WebP image.'), findsOneWidget);
    expect(find.text(AccountWords.photoSent), findsNothing);
  });

  testWidgets('shows the camera’s refusal in words', (tester) async {
    await openPhoto(tester, people, photos: _Refusing());
    await tapShown(tester, find.text(AccountWords.takePhoto));
    expect(find.text('The photo couldn’t be read. Please try again.'), findsOneWidget);
  });
}

/// A camera that won't open (no permission).
class _Refusing extends FakePhotos {
  @override
  Future<PickedPhoto?> pick({required bool camera}) async => throw Exception('camera_access_denied');
}
