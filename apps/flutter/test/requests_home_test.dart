import 'package:flutter_test/flutter_test.dart';
import 'package:people/features/requests/kinds/home.dart';
import 'package:people/features/requests/requests_words.dart';
import 'package:people/models/requests.dart';

import 'fakes.dart';
import 'requests_fixtures.dart';

// A check-in location from the phone (README Phase 2): the point read on the phone (or a map link pasted, the app having
// no map), the name, the radius and the reason sent to People as JSON; a type already being decided can't be asked for
// again; People's refusals in its words; the request's page with Withdraw or Remove.

void main() {
  test('reads a point from pasted coordinates or a map link', () {
    expect(pointFromText('30.0457, 31.1923'), (lat: 30.0457, lng: 31.1923));
    expect(pointFromText('30.0457 31.1923'), (lat: 30.0457, lng: 31.1923));
    expect(pointFromText('https://www.google.com/maps/place/Studio/@30.0457,31.1923,17z/data=x'), (lat: 30.0457, lng: 31.1923));
    expect(pointFromText('https://maps.google.com/?q=30.0457,31.1923'), (lat: 30.0457, lng: 31.1923));
    expect(pointFromText('https://www.google.com/maps/search/?api=1&query=30.0457%2C31.1923'), (lat: 30.0457, lng: 31.1923));
    expect(pointFromText('https://maps.app.goo.gl/abc'), isNull);
    expect(pointFromText('120, 31'), isNull);
    expect(pointFromText('my house'), isNull);
  });

  testWidgets('asks for the home where the phone is, as People takes it', (tester) async {
    final people = requestsPeople()..on('POST /api/me/home-locations', (req) => json(homeJson(), 201));
    await openSheet(tester, people, showHomeSheet);
    expect(find.text(HomeWords.title), findsOneWidget);
    expect(find.text(HomeWords.noPoint(true)), findsOneWidget);

    await scrollAndTap(tester, find.text(HomeWords.useCurrent));
    expect(find.text('The point: 30.059600, 31.346200 · within ±12 m'), findsOneWidget);
    expect(find.text(HomeWords.readWithin(12)), findsOneWidget);
    await typeInto(tester, HomeWords.reason, 'I work from home on Thursdays.');
    await scrollAndTap(tester, find.text(HomeWords.send));

    expect(people.bodyOf('POST /api/me/home-locations'), {
      'type': 'home',
      'latitude': 30.0596,
      'longitude': 31.3462,
      'accuracy': 12,
      'reason': 'I work from home on Thursdays.',
      'radiusMetres': 100,
    });
    expect(find.text('Home location'), findsWidgets);
    expect(find.text(HomeWords.sent(false)), findsOneWidget);
  });

  testWidgets('asks for a remote site from a pasted link, and says People’s refusal in its words', (tester) async {
    const refusal = 'Your remote site request is being decided already: withdraw it first, or wait for its decision, to ask for another.';
    final people = requestsPeople()..on('POST /api/me/home-locations', (req) => json({'message': refusal}, 409));
    await openSheet(tester, people, showHomeSheet);
    await scrollAndTap(tester, find.text('Remote site'));
    await typeInto(tester, HomeWords.paste, 'https://www.google.com/maps/place/Studio/@30.0457,31.1923,17z');
    expect(find.text('The point: 30.045700, 31.192300'), findsOneWidget);
    expect(find.text(HomeWords.nameIt('remote_site')), findsOneWidget);
    await typeInto(tester, HomeWords.name, 'Studio in Zamalek');
    await scrollAndTap(tester, find.text('200 m'));
    await typeInto(tester, HomeWords.reason, 'We shoot there every week.');
    await scrollAndTap(tester, find.text(HomeWords.send));

    expect(people.bodyOf('POST /api/me/home-locations'), {
      'type': 'remote_site',
      'latitude': 30.0457,
      'longitude': 31.1923,
      'label': 'Studio in Zamalek',
      'reason': 'We shoot there every week.',
      'radiusMetres': 200,
    });
    expect(find.text(refusal), findsOneWidget);
    expect(find.text(HomeWords.title), findsOneWidget);
  });

  testWidgets('says what the phone couldn’t do, and never sends without a point', (tester) async {
    final people = requestsPeople();
    await openSheet(tester, people, showHomeSheet);
    await typeInto(tester, HomeWords.paste, 'https://maps.app.goo.gl/abc');
    expect(find.text(HomeWords.shortLink), findsOneWidget);
    await typeInto(tester, HomeWords.reason, 'Thursdays at home.');
    expect(find.text(HomeWords.putPoint(true)), findsOneWidget);
    await scrollAndTap(tester, find.text(HomeWords.send));
    expect(people.calls, isNot(contains('POST /api/me/home-locations')));
  });

  testWidgets('a type being decided already can’t be asked for again', (tester) async {
    final people = requestsPeople()..on('GET /api/me/home-locations', (req) => json([homeJson(status: 'with_hr')]));
    await openSheet(tester, people, showHomeSheet);
    expect(find.text('Home location: ${HomeWords.openAlready}'), findsOneWidget);
    // the first type free is chosen: a remote site needs a name
    expect(find.text(HomeWords.typeTexts['remote_site']!), findsOneWidget);
    expect(find.text(HomeWords.name), findsWidgets);
  });

  test('a check-in location’s page: the place, its point, where it stands, its steps, Withdraw or Remove', () {
    final d = homeDetail(HomeLocationRequest.fromJson(homeJson()));
    expect(d.title, 'Home location');
    expect(d.status, 'With HR');
    String? fact(String label) => d.facts.where((f) => f.label == label).firstOrNull?.value;
    expect(fact(HomeWords.label), 'Home, Nasr City');
    expect(fact(HomeWords.radius), '100 m');
    expect(fact(HomeWords.point), '30.059600, 31.346200');
    expect(d.facts.firstWhere((f) => f.label == HomeWords.point).note, HomeWords.readOnDevice(12));
    expect(fact(RequestsWords.whereItStands), HomeWords.withHr(false));
    expect(fact(HomeWords.howLong), HomeWords.setByHr);
    expect(d.steps.map((s) => s.text), ['Asked for by the employee, 100 m to start with']);
    expect(d.actions.single.path, '/api/me/home-locations/h1/withdraw');

    final approved = homeDetail(HomeLocationRequest.fromJson({...homeJson(status: 'approved'), 'inForce': true, 'approvedAt': '$y-10-25T10:00:00.000Z', 'validity': 'contract'}));
    expect(approved.facts.firstWhere((f) => f.label == RequestsWords.whereItStands).value, 'Approved 25/10/$y: a check-in within 100 m of it shows as Home');
    expect(approved.facts.firstWhere((f) => f.label == HomeWords.howLong).value, 'Until the contract ends');
    expect(approved.actions.single.path, '/api/me/home-locations/h1/remove');
    expect(approved.actions.single.button, 'Remove the home location');
  });
}
