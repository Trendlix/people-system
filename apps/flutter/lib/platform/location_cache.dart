import 'locator.dart';

/// The phone's last position, sent with each request to People for its activity log (owner, 31 October 2026: "with
/// location and ip capture"; asked, "Yes, with each sign-in and action"): read at most once a minute, only while the app
/// is in use (on a request, never in the background), and sent as `x-people-location: lat,lng,accuracy[,mock]`. Only the
/// Super Admin and the CEO see the log.
class LocationCache {
  LocationCache(this._locator, {DateTime Function()? now}) : _now = now ?? DateTime.now;

  final Locator _locator;
  final DateTime Function() _now;

  /// How often it is read again, and how long a reading is sent.
  static const refreshAfter = Duration(minutes: 1);
  static const keptFor = Duration(minutes: 30);

  Spot? _spot;
  DateTime? _at;
  bool _reading = false;

  /// The last reading and when it was taken, whatever its age (About this app); null: none yet.
  ({Spot spot, DateTime at})? get last {
    final spot = _spot, at = _at;
    return spot == null || at == null ? null : (spot: spot, at: at);
  }

  /// The header's value from the last reading, if recent enough; null: none to send.
  String? header() {
    final spot = _spot;
    final at = _at;
    if (spot == null || at == null || _now().difference(at) > keptFor) return null;
    return headerOf(spot);
  }

  /// Reads the position again when the last reading is a minute old or more (in the background of a request, never
  /// holding it up); a reading that fails keeps the last one.
  void refreshIfStale() {
    final at = _at;
    if (_reading || (at != null && _now().difference(at) < refreshAfter)) return;
    _reading = true;
    _locator.read().then((r) {
      if (r.spot != null) remember(r.spot!);
    }).whenComplete(() => _reading = false);
  }

  /// A position read elsewhere (a check-in's press): kept as the latest.
  void remember(Spot spot) {
    _spot = spot;
    _at = _now();
  }

  /// "30.059600,31.346200,12" (",mock" when the phone says the location is a mock one).
  static String headerOf(Spot s) => '${s.latitude.toStringAsFixed(6)},${s.longitude.toStringAsFixed(6)},${s.accuracy.round()}${s.mock ? ',mock' : ''}';
}
