import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:people/app.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/features/assets/assets_words.dart';
import 'package:people/features/assets/my_assets_screen.dart';
import 'package:people/features/profile/profile_words.dart';
import 'package:people/models/custody.dart';
import 'package:people/providers.dart';
import 'package:people/shell/shell_words.dart';
import 'package:people/theme/tokens.dart';

import 'fakes.dart';

// My Assets (owner, 31 October 2026: "show the employee assets, the ones he received from the company"; "every employee
// sees his assets"): GET /api/me/custody read by hand, its words as the website's My Custody says them, and the screen
// opened from the More menu: what they hold (overdue in red), their records with their signed forms, nothing held, a
// load that failed.

/// GET /api/me/custody as People answers it (packages/shared custody.ts MyCustodyView): a laptop held long term, a
/// camera from a shoot three days past its return date, and three records (one closed). Never a value.
Map<String, Object?> custodyJson() => {
  'employeeId': 'e1',
  'current': [
    {
      'itemId': 'i1',
      'asset': {
        'id': 'a1',
        'code': 'TLX-LAP-0012',
        'name': 'MacBook Pro 14',
        'group': 'it',
        'type': 'LAP',
        'status': 'in_custody',
        'brand': 'Apple',
        'model': 'M3 Pro',
        'serial': 'C02XK1',
      },
      'custody': {'code': 'CUS-0031', 'kind': 'assignment', 'dueDate': null},
      'since': '2026-09-01T07:30:00.000Z',
      'overdue': false,
      'daysOverdue': 0,
      'conditionOut': 'excellent',
      'accessories': null,
      'accessoriesOut': [
        {'name': 'Charger', 'quantity': 1, 'serial': null},
        {'name': 'Sleeve', 'quantity': 1, 'serial': null},
      ],
    },
    {
      'itemId': 'i2',
      'asset': {
        'id': 'a2',
        'code': 'PK-CAM-0003',
        'name': 'Sony FX6',
        'group': 'kit',
        'type': 'CAM',
        'status': 'in_custody',
        'brand': 'Sony',
        'model': 'ILME-FX6',
        'serial': '5012345',
      },
      'custody': {'code': 'CUS-0042', 'kind': 'shoot', 'dueDate': '2026-10-28'},
      'since': '2026-10-25T06:00:00.000Z',
      'overdue': true,
      'daysOverdue': 3,
      'conditionOut': 'good',
      'accessories': null,
      'accessoriesOut': [
        {'name': 'Battery', 'quantity': 2, 'serial': null},
      ],
    },
  ],
  'records': [
    {
      'id': 'c42',
      'code': 'CUS-0042',
      'kind': 'shoot',
      'status': 'partial',
      'employee': {'id': 'e1', 'employeeCode': 'TLX-055-25', 'fullNameEn': 'Mohamed Abdelrahman'},
      'purpose': 'Nile Bank shoot',
      'dueDate': '2026-10-28',
      'outAt': '2026-10-25T06:00:00.000Z',
      'closedAt': null,
      'items': 2,
      'out': 1,
      'signed': true,
      'overdue': true,
      'daysOverdue': 3,
      'files': [
        {'id': 'f1', 'fileName': 'CUS-0042 signed.pdf', 'mimeType': 'application/pdf', 'sizeBytes': 245760, 'uploadedAt': '2026-10-25T06:30:00.000Z', 'uploadedBy': null},
      ],
    },
    {
      'id': 'c31',
      'code': 'CUS-0031',
      'kind': 'assignment',
      'status': 'open',
      'employee': {'id': 'e1', 'employeeCode': 'TLX-055-25', 'fullNameEn': 'Mohamed Abdelrahman'},
      'purpose': null,
      'dueDate': null,
      'outAt': '2026-09-01T07:30:00.000Z',
      'closedAt': null,
      'items': 1,
      'out': 1,
      'signed': false,
      'overdue': false,
      'daysOverdue': 0,
      'files': <Object>[],
    },
    {
      'id': 'c19',
      'code': 'CUS-0019',
      'kind': 'shoot',
      'status': 'closed',
      'employee': {'id': 'e1', 'employeeCode': 'TLX-055-25', 'fullNameEn': 'Mohamed Abdelrahman'},
      'purpose': null,
      'dueDate': '2026-08-12',
      'outAt': '2026-08-10T06:00:00.000Z',
      'closedAt': '2026-08-12T15:00:00.000Z',
      'items': 3,
      'out': 0,
      'signed': true,
      'overdue': false,
      'daysOverdue': 0,
      'files': <Object>[],
    },
  ],
  'overdue': 1,
};

Map<String, Object?> nothingHeldJson() => {'employeeId': 'e1', 'current': <Object>[], 'records': <Object>[], 'overdue': 0};

Future<void> openMyAssets(WidgetTester tester, FakePeople people) async {
  phoneScreen(tester);
  await tester.pumpWidget(
    ProviderScope(
      retry: noRetry,
      overrides: overridesFor(people, store: MemorySessionStore(token: 'kept')),
      child: const PeopleApp(),
    ),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.text(ShellWords.more));
  await tester.pumpAndSettle();
  await tester.tap(find.text(ShellWords.assets));
  await tester.pumpAndSettle();
}

Finder get assetsList => find.descendant(of: find.byType(MyAssetsScreen), matching: find.byType(Scrollable)).first;

Future<void> scrollToAsset(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(finder, 200, scrollable: assetsList);
  await tester.pumpAndSettle();
}

void main() {
  group('reading GET /api/me/custody', () {
    test('reads what they hold, with what each is and what went with it', () {
      final c = MyCustody.fromJson(custodyJson());
      expect(c.overdue, 1);
      final laptop = c.current.first;
      expect((laptop.code, laptop.name, laptop.typeLabel, laptop.groupLabel), ('TLX-LAP-0012', 'MacBook Pro 14', 'Laptop', 'IT and devices'));
      expect((laptop.makeAndModel, laptop.serial, laptop.conditionLabel, laptop.withIt), ('Apple · M3 Pro', 'C02XK1', 'Excellent', 'Charger, Sleeve'));
      expect((laptop.custodyCode, laptop.kind, laptop.dueDate, laptop.overdue), ('CUS-0031', 'assignment', null, false));
      expect(laptop.since, DateTime.utc(2026, 9, 1, 7, 30));
      final camera = c.current.last;
      expect((camera.withIt, camera.overdue, camera.daysOverdue, camera.dueDate), ('Battery × 2', true, 3, '2026-10-28'));
    });

    test('reads the records and their signed forms', () {
      final records = MyCustody.fromJson(custodyJson()).records;
      expect(records.map((r) => (r.code, r.kindLabel, r.statusLabel, r.items, r.out, r.signed)), [
        ('CUS-0042', 'Shoot', 'Partly returned', 2, 1, true),
        ('CUS-0031', 'Long-term assignment', 'Out', 1, 1, false),
        ('CUS-0019', 'Shoot', 'Closed', 3, 0, true),
      ]);
      expect(records.first.files.single.fileName, 'CUS-0042 signed.pdf');
      expect(records.first.purpose, 'Nile Bank shoot');
    });

    test('reads an answer it can’t use as nothing held, and skips an item without a code', () {
      final c = MyCustody.fromJson({'not': 'custody'});
      expect(c.current, isEmpty);
      expect(c.records, isEmpty);
      expect(c.overdue, 0);
      expect(MyCustody.fromJson({'current': [{'asset': {'name': 'No code'}}], 'records': [{}]}).current, isEmpty);
      // older items list what went with them as written; a type People adds later is shown as its code
      final older = HeldAsset.fromJson({'asset': {'code': 'X-1', 'name': 'Thing', 'type': 'NEW'}, 'custody': {}, 'accessories': 'Case and strap'});
      expect((older!.withIt, older.typeLabel, older.makeAndModel, older.kind), ('Case and strap', 'NEW', null, 'assignment'));
      expect(const AccessoryOut(name: 'Battery', quantity: 1, serial: 'B-12').text, 'Battery (S/N B-12)');
    });
  });

  group('words, as the website says them', () {
    test('a return date', () {
      expect(dueTextOf(kind: 'assignment', overdue: false, daysOverdue: 0), 'Long term: back at clearance');
      expect(dueTextOf(kind: 'shoot', dueDate: '2026-10-28', overdue: true, daysOverdue: 3), 'Overdue 3 days (due 28 Oct 2026)');
      expect(dueTextOf(kind: 'shoot', dueDate: '2026-10-28', overdue: true, daysOverdue: 1), 'Overdue 1 day (due 28 Oct 2026)');
      expect(dueTextOf(kind: 'shoot', status: 'closed', dueDate: '2026-08-12', overdue: false, daysOverdue: 0), 'Was due 12 Aug 2026');
      expect(dueTextOf(kind: 'shoot', dueDate: '2026-11-02', overdue: false, daysOverdue: 0), 'Return by 2 Nov 2026');
    });

    test('how many are out, and a file’s size', () {
      expect([outTextOf(2, 1), outTextOf(3, 0), outTextOf(1, 0), outTextOf(1, 1)], ['1 of 2 out', 'All 3 back', 'Back', '1 out']);
      expect([sizeTextOf(245760), sizeTextOf(100), sizeTextOf(1572864)], ['240 KB', '1 KB', '1.5 MB']);
      expect([AssetsWords.withYou(0), AssetsWords.withYou(1), AssetsWords.withYou(3)], ['Nothing with you now', '1 item with you', '3 items with you']);
    });
  });

  group('the screen', () {
    late FakePeople people;

    setUp(() {
      people = FakePeople()
        ..on('GET /api/auth/me', (req) => json(meJson(name: 'Mohamed Abdelrahman')))
        ..on('GET /api/me/custody', (req) => json(custodyJson()));
    });

    testWidgets('opens from the More menu: what they hold, the one past its date in red, and their records', (tester) async {
      await openMyAssets(tester, people);
      expect(find.text(AssetsWords.title), findsOneWidget);
      expect(find.text(AssetsWords.overdue(1)), findsOneWidget);
      expect(find.text(AssetsWords.countOf(2)), findsOneWidget);
      expect(find.text('MacBook Pro 14'), findsOneWidget);
      expect(find.text('TLX-LAP-0012 · Laptop'), findsOneWidget);
      expect(find.text('Apple · M3 Pro'), findsOneWidget);
      expect(find.text(AssetsWords.serial('C02XK1')), findsOneWidget);
      expect(find.text(AssetsWords.condition('Excellent')), findsOneWidget);
      expect(find.text(AssetsWords.withIt('Charger, Sleeve')), findsOneWidget);
      expect(find.text(AssetsWords.since('1 Sep 2026', 'CUS-0031')), findsOneWidget);
      expect(find.text('Long term: back at clearance'), findsWidgets);

      await scrollToAsset(tester, find.text('Sony FX6'));
      await scrollToAsset(tester, find.text(AssetsWords.withIt('Battery × 2')));
      final overdue = find.text('Overdue 3 days (due 28 Oct 2026)');
      expect(overdue, findsWidgets);
      // in the look's red, the held item's and its record's alike
      final red = tester.element(overdue.first).palette.danger;
      for (final t in tester.widgetList<Text>(overdue)) {
        expect(t.style?.color, red);
      }

      await scrollToAsset(tester, find.text('CUS-0019'));
      expect(find.text('Partly returned'), findsOneWidget);
      expect(find.text(AssetsWords.notSigned), findsOneWidget);
      expect(find.text('Shoot · Nile Bank shoot · Out 25 Oct 2026 · 2 items, 1 of 2 out'), findsOneWidget);
      expect(find.text('Was due 12 Aug 2026'), findsOneWidget);
      expect(find.text(AssetsWords.signedForm('CUS-0042 signed.pdf', '240 KB')), findsOneWidget);
      await scrollToAsset(tester, find.text(AssetsWords.openOnWebsite));
      // never a value
      expect(find.textContaining('EGP'), findsNothing);
    });

    testWidgets('says when they hold nothing and have no records', (tester) async {
      people.on('GET /api/me/custody', (req) => json(nothingHeldJson()));
      await openMyAssets(tester, people);
      expect(find.text(AssetsWords.holdNothing), findsOneWidget);
      expect(find.text(AssetsWords.noRecords), findsOneWidget);
      expect(find.text(AssetsWords.overdue(1)), findsNothing);
      expect(find.text(AssetsWords.openOnWebsite), findsNothing);
    });

    testWidgets('says what failed to load, with Try again', (tester) async {
      var fail = true;
      people.on('GET /api/me/custody', (req) => fail ? json({'message': 'Something went wrong.'}, 500) : json(custodyJson()));
      await openMyAssets(tester, people);
      expect(find.textContaining(AssetsWords.notLoaded), findsOneWidget);
      fail = false;
      await tester.tap(find.text(ProfileWords.tryAgain));
      await tester.pumpAndSettle();
      expect(find.text('MacBook Pro 14'), findsOneWidget);
    });
  });
}
