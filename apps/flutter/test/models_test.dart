import 'package:flutter_test/flutter_test.dart';
import 'package:people/auth/session_store.dart';
import 'package:people/format.dart';
import 'package:people/models/me.dart';
import 'package:people/models/today.dart';
import 'package:people/platform/device_name.dart';

// The API's answers read by hand (README §2), and how times read.

void main() {
  test('reads who is signed in, greeting by the first name, else the email', () {
    final me = Me.fromJson({'id': 'u1', 'email': 'h.magdy@example.test', 'roles': ['employee', 'hr'], 'name': '  Hazem   Soliman ', 'hold': true});
    expect((me.firstName, me.hold), ('Hazem', true));
    expect(me.roles, ['employee', 'hr']);
    expect(Me.fromJson({'id': 'u1', 'email': 'h.magdy@example.test', 'name': null}).firstName, 'H.magdy');
    expect(() => Me.fromJson({'email': 'x'}), throwsFormatException);
  });

  test('reads today and a press’s answer, leaving out what it doesn’t know', () {
    final r = punchResultOf({
      'next': 'out',
      'punches': [
        {'kind': 'in', 'at': '2026-10-30T06:58:00.000Z', 'place': 'remote', 'locationName': 'Studio', 'flags': ['fake_gps']},
      ],
      'day': {'hoursCounted': 7.25, 'openAt': '2026-10-30T06:58:00.000Z'},
      'shift': {'startTime': '09:00', 'endTime': '18:00'},
      'officialDuty': {'now': true},
      'exemption': {'from': '2026-10-01'},
      'messages': ['Checked in.'],
      'kept': false,
    });
    expect(r.today.next, PunchKind.checkOut);
    expect(r.today.last?.locationName, 'Studio');
    expect(r.today.last?.flags, ['fake_gps']);
    expect(r.today.hoursCounted, 7.25);
    expect(r.today.openSince, DateTime.utc(2026, 10, 30, 6, 58));
    expect((r.today.officialDutyNow, r.today.exempt, r.today.networkLocked), (true, true, false));
    expect(r.messages, ['Checked in.']);
    expect(r.kept, isFalse);
    expect(Today.fromJson({}).punches, isEmpty);
  });

  test('reads the kept credential only whole', () {
    expect(deviceCredentialOf('{"id":"d1","secret":"s","userId":"u1"}'), (id: 'd1', secret: 's', userId: 'u1'));
    expect(deviceCredentialOf('{"id":"d1","secret":"s"}'), isNull);
    expect(deviceCredentialOf('not json'), isNull);
  });

  test('names the phone and the times', () {
    expect(phoneName('samsung', 'SM-S918B'), 'Samsung SM-S918B');
    expect(phoneName('Google', 'Pixel 8'), 'Google Pixel 8');
    expect(phoneName('OnePlus', 'OnePlus 12'), 'OnePlus 12');
    expect(clockOf(DateTime(2026, 10, 30, 9, 5)), '09:05');
    expect(dayLineOf(DateTime(2026, 10, 30)), 'Friday, 30 October');
    expect(greetingAt(DateTime(2026, 10, 30, 16, 59)), 'Good afternoon');
    expect((hoursOf(7.25), hoursOf(8)), ('7.3 h', '8 h'));
  });
}
