import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:people/features/requests/kinds/claim.dart';
import 'package:people/features/requests/request_page.dart';
import 'package:people/features/requests/request_text.dart';
import 'package:people/features/requests/requests_words.dart';
import 'package:people/models/requests.dart';

import 'fakes.dart';
import 'requests_fixtures.dart';

// A reimbursement claim from the phone (README Phase 2, "faster requests"): the type's caps and what is left shown, the
// amount, what it was for and a receipt photo sent as People's form takes them (multipart, "receipts"); People's
// refusals in its words; the claim's page with its receipts, every step and Cancel.

/// A multipart body read as text even with a photo's bytes in it (the fixtures' parsers read `body`).
http.Request readable(http.Request r) => http.Request(r.method, r.url)..body = utf8.decode(r.bodyBytes, allowMalformed: true);

void main() {
  test('reads an amount as typed: commas, Arabic digits, at most 2 decimals, more than 0', () {
    expect(amountOf('250'), 250);
    expect(amountOf('1,250.50'), 1250.5);
    expect(amountOf('٢٥٠٫٥'), 250.5);
    expect(amountOf(' 99.9 '), 99.9);
    expect(amountOf('0'), isNull);
    expect(amountOf('12.345'), isNull);
    expect(amountOf('abc'), isNull);
  });

  testWidgets('claims an expense with a receipt photo, the type’s caps shown, and opens the claim', (tester) async {
    final people = requestsPeople()..on('POST /api/me/reimbursements', (req) => json(claimJson(status: 'with_manager'), 201));
    await openSheet(tester, people, showClaimSheet);
    expect(find.text(ClaimWords.title), findsOneWidget);
    // the only type is chosen, with its rules and what is left
    expect(find.text('Receipt needed · Up to EGP 500.00 a claim, 1,000.00 a month · Within 30 days of the expense'), findsOneWidget);
    expect(find.text(ClaimWords.canClaimUpTo('EGP 500.00')), findsOneWidget);
    expect(find.text(ClaimWords.attachReceipt), findsOneWidget);

    await typeInto(tester, ClaimWords.amount, '250.50');
    await typeInto(tester, ClaimWords.what, 'Taxi to the client’s office');
    await scrollAndTap(tester, find.text(RequestsWords.takePhoto));
    expect(find.text(ClaimWords.ready('EGP 250.50', 'Transport', 1, false)), findsOneWidget);
    await scrollAndTap(tester, find.text(RequestsWords.send));

    final sent = readable(lastSent(people, 'POST /api/me/reimbursements'));
    expect(formFields(sent), {'typeId': 'rt1', 'expenseDate': todayIso(), 'amount': '250.50', 'description': 'Taxi to the client’s office'});
    expect(formFiles(sent), [('receipts', 'photo.jpg')]);
    // the claim's page, saying where it goes
    expect(find.text('Transport claim'), findsOneWidget);
    expect(find.text(ClaimWords.sent('with_manager', null, false)), findsOneWidget);
  });

  testWidgets('holds back an amount over the type’s cap, and says People’s refusal in its words', (tester) async {
    const refusal = 'Transport isn’t for your department, grade or employment type. Choose another type.';
    final people = requestsPeople()..on('POST /api/me/reimbursements', (req) => json({'message': [refusal]}, 400));
    await openSheet(tester, people, showClaimSheet);
    await typeInto(tester, ClaimWords.amount, '600');
    await typeInto(tester, ClaimWords.what, 'Taxi');
    await scrollAndTap(tester, find.text(RequestsWords.takePhoto));
    expect(find.text(ClaimWords.atMostAtOnce(500)), findsOneWidget);
    await scrollAndTap(tester, find.text(RequestsWords.send));
    expect(people.calls, isNot(contains('POST /api/me/reimbursements')));

    await typeInto(tester, ClaimWords.amount, '120');
    await scrollAndTap(tester, find.text(RequestsWords.send));
    expect(people.calls, contains('POST /api/me/reimbursements'));
    expect(find.text(refusal), findsOneWidget);
    expect(find.text(ClaimWords.title), findsOneWidget);
  });

  testWidgets('says so when there is no type to claim', (tester) async {
    final people = requestsPeople()..on('GET /api/me/reimbursement-types', (req) => json(<Object>[]));
    await openSheet(tester, people, showClaimSheet);
    expect(find.text(ClaimWords.noTypes), findsOneWidget);
    expect(find.text(RequestsWords.send), findsNothing);
  });

  test('a claim’s page: the amounts, where it stands, its receipts, each step with its amount, and Cancel', () {
    final d = claimDetail(ReimbursementClaim.fromJson(claimJson()));
    expect(d.title, 'Transport claim');
    expect(d.status, 'With Finance');
    String? fact(String label) => d.facts.where((f) => f.label == label).firstOrNull?.value;
    expect(fact(ClaimWords.amountClaimed), 'EGP 250.50');
    expect(fact(ClaimWords.approvedSoFar), 'EGP 250.50');
    expect(fact(RequestsWords.whereItStands), 'Waiting for Finance');
    expect(fact('Direct manager'), 'Sara Ali');
    expect(d.files, ['receipt.jpg · Photo · 240 KB']);
    expect(d.steps.map((s) => s.text), ['Claimed by the employee · EGP 250.50', 'The direct manager approved it · EGP 250.50', 'HR approved it · EGP 250.50']);
    expect(d.actions.single.path, '/api/me/reimbursements/r1/cancel');

    final paid = claimDetail(ReimbursementClaim.fromJson({...claimJson(status: 'approved'), 'canCancel': false, 'payroll': {'status': 'applied', 'runMonth': '$y-11-01'}}));
    expect(paid.facts.firstWhere((f) => f.label == RequestsWords.whereItStands).value, 'Approved: paid with the November $y payroll');
    expect(paid.facts.firstWhere((f) => f.label == ClaimWords.paidWith).value, 'The November $y payroll, untaxed');
    expect(paid.actions, isEmpty);
  });

  testWidgets('cancels a claim from its page, after asking', (tester) async {
    final people = requestsPeople()
      ..on('POST /api/me/reimbursements/r1/cancel', (req) => json({...claimJson(status: 'cancelled'), 'canCancel': false}));
    final claim = ReimbursementClaim.fromJson(claimJson());
    await openSheet(
      tester,
      people,
      (context) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => RequestPage(kind: RequestKind.claim, id: 'r1', initial: claim))),
    );
    // the page's list builds as it scrolls: down to the claim's Cancel
    final page = find.descendant(of: find.byType(RequestPage), matching: find.byType(Scrollable)).first;
    await tester.scrollUntilVisible(find.widgetWithText(OutlinedButton, ClaimWords.cancelButton), 300, scrollable: page);
    await tester.ensureVisible(find.widgetWithText(OutlinedButton, ClaimWords.cancelButton));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(OutlinedButton, ClaimWords.cancelButton));
    await tester.pumpAndSettle();
    expect(find.text(ClaimWords.cancelConfirm('Transport', 'EGP 250.50')), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, ClaimWords.cancelButton));
    await tester.pumpAndSettle();
    expect(people.calls, contains('POST /api/me/reimbursements/r1/cancel'));
    await tester.scrollUntilVisible(find.text(ClaimWords.cancelled), -300, scrollable: page);
    expect(find.text(ClaimWords.cancelled), findsOneWidget);
    expect(find.text(ClaimWords.cancelButton), findsNothing);
  });
}
