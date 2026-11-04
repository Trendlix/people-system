import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../api/people_client.dart';
import '../../../models/requests.dart';
import '../../../platform/locator.dart';
import '../../../providers.dart';
import '../../../theme/tokens.dart';
import '../request_page.dart';
import '../request_text.dart';
import '../requests_data.dart';
import '../requests_words.dart';
import '../sheet_parts.dart';

// A check-in location (owner, 20 October 2026: "allow other users to request to add their home locations when working
// from home"; 24 October 2026: "Home Location - Remote Site - Client Location"): the type, the point (read on the phone
// while there, or a map link pasted), its name, the radius, until when, and why; HR approves it, then the CEO
// (POST /api/me/home-locations). The app has no map: the website's map pin is a pasted link or coordinates here. Its
// page: the place, where it stands, how long it lasts, every step, Withdraw while it is being decided and Remove once
// approved. Words from apps/web home-locations (home-locations.ts, forms.tsx, home-location.tsx).

/// The check-in location's words, in one place (ready for Arabic).
abstract final class HomeWords {
  static const title = 'Check-in location';

  // the types
  static const types = ['home', 'remote_site', 'client'];
  static const typeLines = {'home': 'Home location', 'remote_site': 'Remote site', 'client': 'Client location'};
  static const type = 'Type';
  static const openAlready = 'being decided already';
  static const allOpen = 'A request of each type is being decided already.';
  static const notAvailable = 'Not available yet: the server does not have check-in locations yet.';

  // the point
  static const point = 'The point';
  static const useCurrent = 'Use my current location';
  static const reading = 'Getting your location…';
  static String readWithin(int metres) => 'Your current location, read within ±$metres m.';
  static String notPrecise(bool home) => 'That isn’t precise: paste a map link of ${place(home)} instead, or try again there.';
  static String place(bool home) => home ? 'your home' : 'the place';
  static String problem(LocationProblem p, bool home) {
    final what = switch (p) {
      LocationProblem.serviceOff => 'Location is turned off on the phone',
      LocationProblem.denied || LocationProblem.deniedForever => 'You didn’t allow the location',
      LocationProblem.timeout => 'The location took too long to read',
      LocationProblem.unavailable => 'The location isn’t available on this device now',
    };
    return '$what: paste a map link of ${place(home)} instead.';
  }

  static const paste = 'Or paste a map link or coordinates';
  static const pasteHint = 'A Google Maps link or 30.0457, 31.1923';
  static const shortLink = 'Short links (maps.app.goo.gl) can’t be read: open the link and copy the long one, or the coordinates.';
  static const unreadable = 'That isn’t a point the app can read: paste coordinates like 30.0457, 31.1923, or a Google Maps link.';
  static String pointLine(double lat, double lng, double? accuracy) =>
      'The point: ${lat.toStringAsFixed(6)}, ${lng.toStringAsFixed(6)}${accuracy == null ? '' : ' · within ±${accuracy.round()} m'}';
  static String noPoint(bool home) => 'No point yet.';

  // the name, the radius, until when, why
  static const label = 'Label';
  static const name = 'Name';
  static const placeholders = {'home': 'Home, Nasr City', 'client': 'Acme Cairo office', 'remote_site': 'Studio in Zamalek'};
  static const radius = 'Radius';
  static const radii = [50, 100, 200, 300, 500];
  static const until = 'Needed until';
  static const reason = 'Reason';

  /// The consent a home or remote site is sent with; a client location's has none.
  static String? consent(String type) =>
      type == 'client' ? null : '${type == 'home' ? 'Your home is personal' : 'Your remote site is yours'}: only you, HR and the CEO see it. Sending it is your consent.';
  static const send = 'Send to HR';

  // the checks (packages/shared home-locations.ts homeRequestProblems)
  static String putPoint(bool home) => home ? 'Use your current location while at home, or paste a map link of it.' : 'Use your current location while there, or paste a map link of the place.';
  static String nameIt(String type) => type == 'client' ? 'Name the place: the client’s name, e.g. Acme Cairo office.' : 'Name the place, e.g. Studio in Zamalek.';
  static const writeReason = 'Write the reason: why you need this place to check in from.';
  static const endToday = 'Choose an end date of today or later.';

  // once sent
  static String sent(bool toCeo) => toCeo ? 'Sent to the CEO.' : 'Sent to HR.';

  // its page
  static const deletedWithPoint = 'Deleted with the point';
  static const noneGiven = 'None given';
  static const pointDeleted = 'Its point is deleted: it is no longer kept.';
  static const putOnMap = 'Put on the map by the employee';
  static String readOnDevice(int metres) => 'Read on the employee’s device, within ±$metres m';
  static const howLong = 'How long it lasts';
  static const setByHr = 'Set when approved';
  static String askedUntil(String date) => 'Asked until $date';
  static const noLongerCounts = 'It no longer counts for check-ins';
  static const onSetup = 'On Check-in Setup';
  static String onSetupText(String name, String? ended) => '$name${ended == null ? '' : ', ended $ended'}';
  static const removedFromSetup = 'Removed from Check-in Setup: it no longer counts.';
  static String untilDate(String d) => 'Until $d';
  static String untilContract(String? d) => d == null ? 'Until the contract ends' : 'Until the contract ends ($d)';
  static const noEnd = 'No end';

  // where it stands (apps/web home-locations.ts homeProgressText)
  static String withHr(bool ceo) => ceo ? 'With the CEO' : 'With HR';
  static String withCeo(bool ceo) => ceo ? 'Approved at HR’s step: with the CEO' : 'HR approved it: with the CEO now';
  static const endedOnSetup = 'Ended on Check-in Setup';
  static String endedOn(String? date) => 'Ended${date == null ? ' with the employment' : ' $date'}';
  static String approvedOn(String date) => 'Approved $date';
  static String rejectedBy(String who) => 'Rejected by $who';
  static const withdrawnText = 'Withdrawn while it was being decided: its point is deleted';
  static const replacedText = 'Replaced by a newer home location: its point is deleted';
  static const removedText = 'Removed: its point is deleted';

  // each step (homeStepText)
  static String stepAsked(int radius) => 'Asked for by the employee, $radius m to start with';
  static String stepHrApproved(bool ceo, int? radius) => '${ceo ? 'Approved at HR’s step' : 'HR approved it'}${radius == null ? '' : ', within $radius m'}';
  static String stepHrRejected(bool ceo) => ceo ? 'Rejected at HR’s step' : 'HR rejected it';
  static const stepCeoApproved = 'The CEO approved it: in force';
  static const stepCeoRejected = 'The CEO rejected it';
  static const stepWithdrawn = 'Withdrawn by the employee: its point deleted';
  static const stepReplaced = 'Replaced by a newer home location: its point deleted';
  static const stepRemoved = 'Removed: its point deleted';
  static const stepValidity = 'How long it lasts changed';

  // withdrawing and removing it
  static const withdrawTitle = 'Withdraw the request';
  static const withdrawConfirm = 'Withdraw your request?';
  static const withdrawButton = 'Withdraw the request';
  static const withdrawn = 'Withdrawn.';
  static String removeTitle(bool home) => home ? 'Remove the home location' : 'Remove the remote site';
  static String removeConfirm(bool home) => 'Remove your ${home ? 'home location' : 'remote site'}?';
  static const removed = 'Removed.';
}

/// 100, 1,000: metres as the website writes them.
String _metres(int n) => n.toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');

/// A point in pasted text: "30.0457, 31.1923", a Google Maps link's "@30.0457,31.1923" or "q=30.0457,31.1923"; null
/// when there is none or it is off the map.
({double lat, double lng})? pointFromText(String text) {
  final t = Uri.decodeFull(text.trim());
  const n = r'(-?\d{1,3}(?:\.\d+)?)';
  final patterns = [
    RegExp('@$n,\\s*$n'),
    RegExp('[?&](?:q|query|ll|destination|center)=(?:loc:)?$n,\\s*$n'),
    RegExp('!3d$n!4d$n'),
    RegExp('^$n\\s*[,\\s]\\s*$n\$'),
  ];
  for (final p in patterns) {
    final m = p.firstMatch(t);
    if (m == null) continue;
    final lat = double.parse(m[1]!);
    final lng = double.parse(m[2]!);
    if (lat.abs() <= 90 && lng.abs() <= 180) return (lat: lat, lng: lng);
  }
  return null;
}

double _round6(double n) => (n * 1e6).round() / 1e6;

/// Opens the sheet to ask for a check-in location, from the tab's [context].
Future<void> showHomeSheet(BuildContext context) => openRequestSheet(
  context,
  title: HomeWords.title,
  icon: kindIcons[RequestKind.home]!,
  builder: (sheetContext, sent) => _HomeForm(sent: sent),
);

class _HomeForm extends ConsumerStatefulWidget {
  const _HomeForm({required this.sent});

  final SentHandler sent;

  @override
  ConsumerState<_HomeForm> createState() => _HomeFormState();
}

class _HomeFormState extends ConsumerState<_HomeForm> {
  String? _type;
  ({double lat, double lng, double? accuracy})? _point;
  bool _reading = false;
  String? _pointNote;
  bool _pointProblem = false;
  final _paste = TextEditingController();
  final _label = TextEditingController();
  final _reason = TextEditingController();
  int _radius = 100;
  String? _until;
  bool _busy = false;
  List<String> _refusal = const [];

  @override
  void dispose() {
    _paste.dispose();
    _label.dispose();
    _reason.dispose();
    super.dispose();
  }

  bool get _home => _type == 'home';

  Future<void> _readHere() async {
    setState(() {
      _reading = true;
      _pointNote = null;
    });
    final read = await ref.read(locatorProvider).read();
    if (!mounted) return;
    setState(() {
      _reading = false;
      final spot = read.spot;
      if (spot == null) {
        _pointNote = HomeWords.problem(read.problem ?? LocationProblem.unavailable, _home);
        _pointProblem = true;
        return;
      }
      _point = (lat: spot.latitude, lng: spot.longitude, accuracy: spot.accuracy);
      _paste.clear();
      _pointProblem = spot.accuracy > 100;
      _pointNote = _pointProblem ? HomeWords.notPrecise(_home) : HomeWords.readWithin(spot.accuracy.round());
    });
  }

  void _pasted(String text) {
    setState(() {
      if (text.trim().isEmpty) {
        _pointNote = null;
        _pointProblem = false;
        return;
      }
      final p = pointFromText(text);
      if (p == null) {
        _pointNote = text.contains('goo.gl') ? HomeWords.shortLink : HomeWords.unreadable;
        _pointProblem = true;
        return;
      }
      _point = (lat: p.lat, lng: p.lng, accuracy: null);
      _pointNote = null;
      _pointProblem = false;
    });
  }

  List<String> _problems() => [
    if (_point == null) HomeWords.putPoint(_home),
    if (!_home && _label.text.trim().isEmpty) HomeWords.nameIt(_type!),
    if (_reason.text.trim().isEmpty) HomeWords.writeReason,
    if (!_home && _until != null && _until!.compareTo(todayIso()) < 0) HomeWords.endToday,
  ];

  Future<void> _send() async {
    final p = _point!;
    final label = _label.text.trim();
    setState(() {
      _busy = true;
      _refusal = const [];
    });
    try {
      final json = await sendJson(ref, RequestPaths.create(RequestKind.home), {
        'type': _type,
        'latitude': _round6(p.lat),
        'longitude': _round6(p.lng),
        if (p.accuracy != null) 'accuracy': p.accuracy!.round(),
        if (label.isNotEmpty) 'label': label,
        'reason': _reason.text.trim(),
        'radiusMetres': _radius,
        if (!_home && _until != null) 'wishedEndDate': _until,
      });
      if (!mounted) return;
      requestsChanged(ref);
      final made = requestOf(RequestKind.home, json);
      widget.sent(made, HomeWords.sent(made.confidential));
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _refusal = refusalOf(e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final mine = ref.watch(myRequestsProvider(RequestKind.home));
    if (!mine.hasValue) {
      if (mine.hasError) {
        if (isUnavailable(mine.error)) return const SheetState.refused(HomeWords.notAvailable);
        return SheetState.failed(onRetry: () => ref.invalidate(myRequestsProvider(RequestKind.home)));
      }
      return const SheetState.loading();
    }
    final open = {
      for (final r in mine.value!.whereType<HomeLocationRequest>())
        if (r.status == 'with_hr' || r.status == 'with_ceo') r.type,
    };
    final free = HomeWords.types.where((t) => !open.contains(t)).toList();
    if (free.isEmpty) return const SheetState.refused(HomeWords.allOpen);
    if (_type == null || open.contains(_type)) _type = free.first;
    final type = _type!;
    final consent = HomeWords.consent(type);
    final problems = _problems();
    final point = _point;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SheetField(
          label: HomeWords.type,
          child: ChoicePills<String>(
            values: HomeWords.types,
            labelOf: (t) => HomeWords.typeLines[t]!,
            selected: type,
            enabled: (t) => !open.contains(t),
            onChanged: (t) => setState(() => _type = t),
          ),
        ),
        if (open.isNotEmpty) RulesNote(lines: [for (final t in open) '${HomeWords.typeLines[t]}: ${HomeWords.openAlready}']),
        SheetField(
          label: HomeWords.point,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              OutlinedButton.icon(
                onPressed: _reading ? null : _readHere,
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(Tokens.tapTarget), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
                icon: Icon(CupertinoIcons.location, size: 17, color: p.ink),
                label: Text(_reading ? HomeWords.reading : HomeWords.useCurrent),
              ),
              const SizedBox(height: 10),
              SheetTextBox(controller: _paste, label: HomeWords.paste, hint: HomeWords.pasteHint, keyboard: TextInputType.url, onChanged: _pasted),
              const SizedBox(height: 8),
              Semantics(
                liveRegion: true,
                child: Text(
                  point == null ? HomeWords.noPoint(_home) : HomeWords.pointLine(point.lat, point.lng, point.accuracy),
                  style: text.bodyMedium?.copyWith(color: point == null ? p.muted : p.ink),
                ),
              ),
              if (_pointNote != null) Text(_pointNote!, style: text.bodySmall?.copyWith(color: _pointProblem ? p.danger : p.muted)),
            ],
          ),
        ),
        SheetField(
          label: _home ? HomeWords.label : HomeWords.name,
          optional: _home,
          child: SheetTextBox(
            controller: _label,
            label: _home ? HomeWords.label : HomeWords.name,
            hint: HomeWords.placeholders[type],
            max: 200,
            onChanged: (_) => setState(() {}),
          ),
        ),
        SheetField(
          label: HomeWords.radius,
          child: ChoicePills<int>(values: HomeWords.radii, labelOf: (m) => '${_metres(m)} m', selected: _radius, onChanged: (m) => setState(() => _radius = m)),
        ),
        if (!_home)
          SheetField(
            label: HomeWords.until,
            optional: true,
            child: PickDayField(
              label: HomeWords.until,
              value: _until,
              first: todayIso(),
              last: addDays(todayIso(), 3 * 366),
              onChanged: (d) => setState(() => _until = d),
              onClear: () => setState(() => _until = null),
            ),
          ),
        SheetField(
          label: HomeWords.reason,
          child: SheetTextBox(controller: _reason, label: HomeWords.reason, lines: 3, max: 1000, onChanged: (_) => setState(() {})),
        ),
        if (consent != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Text(consent, style: text.bodySmall),
          ),
        SendChecks(problems: problems),
        PeopleRefusal(messages: _refusal),
        SheetButtons(busy: _busy, sendLabel: HomeWords.send, onSend: problems.isEmpty ? _send : null),
      ],
    );
  }
}

// ---------- its page ----------

/// Where a check-in location stands, and the reason given for a rejection.
({String text, String? reason}) homeProgressText(HomeLocationRequest r) {
  final ceo = r.confidential;
  switch (r.status) {
    case 'with_hr':
      return (text: HomeWords.withHr(ceo), reason: null);
    case 'with_ceo':
      return (text: HomeWords.withCeo(ceo), reason: null);
    case 'approved':
      if (r.inForce == false) {
        if (r.type == 'client' && r.locationEndedAt != null) return (text: HomeWords.endedOnSetup, reason: null);
        return (text: HomeWords.endedOn(r.endsOn == null ? null : dmy(r.endsOn!)), reason: null);
      }
      return (text: HomeWords.approvedOn(r.approvedAt == null ? '' : dmyOfMoment(r.approvedAt!)), reason: null);
    case 'rejected':
      final who = r.rejectedStage == 'ceo' || ceo ? 'the CEO' : 'HR';
      return (text: HomeWords.rejectedBy(who), reason: r.rejectReason);
    case 'withdrawn':
      return (text: HomeWords.withdrawnText, reason: null);
    case 'replaced':
      return (text: HomeWords.replacedText, reason: null);
    case 'removed':
      return (text: HomeWords.removedText, reason: null);
    default:
      return (text: statusLabelOf(r), reason: null);
  }
}

/// A check-in location's step in words.
String homeStepText(RequestStep s, bool confidential) => switch (s.kind) {
  'submitted' => HomeWords.stepAsked(s.radiusMetres ?? 100),
  'hr_decision' => s.decision == 'reject' ? HomeWords.stepHrRejected(confidential) : HomeWords.stepHrApproved(confidential, s.radiusMetres),
  'ceo_decision' => s.decision == 'reject' ? HomeWords.stepCeoRejected : HomeWords.stepCeoApproved,
  'withdrawn' => HomeWords.stepWithdrawn,
  'replaced' => HomeWords.stepReplaced,
  'removed' => HomeWords.stepRemoved,
  'validity_changed' => HomeWords.stepValidity,
  _ => s.kind,
};

/// How long it lasts, once HR set it; null before.
String? homeValidityText(HomeLocationRequest r) {
  final validity = r.validity;
  if (validity == null) return null;
  final end = r.endsOn ?? r.validUntil;
  if (validity == 'until_date' && end != null) return HomeWords.untilDate(dmy(end));
  if (validity == 'contract') return HomeWords.untilContract(end == null ? null : dmy(end));
  return HomeWords.noEnd;
}

/// What a check-in location's page shows.
RequestDetail homeDetail(HomeLocationRequest r) {
  final home = r.type == 'home';
  final client = r.type == 'client';
  final progress = homeProgressText(r);
  final lat = r.latitude;
  final lng = r.longitude;
  return RequestDetail(
    title: HomeWords.typeLines[r.type] ?? HomeWords.title,
    status: statusLabelOf(r),
    state: stateOf(r),
    subline: RequestsWords.sentOn(dateTimeWords(r.createdAt)),
    facts: [
      (label: HomeWords.type, value: HomeWords.typeLines[r.type] ?? r.type, note: null),
      (label: home ? HomeWords.label : HomeWords.name, value: r.label ?? (lat == null ? HomeWords.deletedWithPoint : HomeWords.noneGiven), note: null),
      (label: HomeWords.radius, value: '${_metres(r.radiusMetres)} m', note: null),
      (
        label: HomeWords.point,
        value: lat == null || lng == null ? HomeWords.pointDeleted : '${lat.toStringAsFixed(6)}, ${lng.toStringAsFixed(6)}',
        note: lat == null ? null : (r.accuracyMetres == null ? HomeWords.putOnMap : HomeWords.readOnDevice(r.accuracyMetres!.round())),
      ),
      (label: RequestsWords.whereItStands, value: progress.text, note: progress.reason == null ? null : '“${progress.reason}”'),
      (
        label: HomeWords.howLong,
        value: homeValidityText(r) ?? HomeWords.setByHr,
        note: [if (r.wishedEndDate != null) HomeWords.askedUntil(dmy(r.wishedEndDate!)), if (r.ended) HomeWords.noLongerCounts].join(' · ').nullIfEmpty,
      ),
      if (r.reason != null) (label: HomeWords.reason, value: r.reason!, note: null),
      if (client && r.status == 'approved')
        (
          label: HomeWords.onSetup,
          value: r.locationName == null ? HomeWords.removedFromSetup : HomeWords.onSetupText(r.locationName!, r.locationEndedAt == null ? null : dmyOfMoment(r.locationEndedAt!)),
          note: null,
        ),
    ],
    steps: stepLinesOf(r, (s) => homeStepText(s, r.confidential)),
    actions: [
      if (r.canWithdraw)
        (
          title: HomeWords.withdrawTitle,
          button: HomeWords.withdrawButton,
          confirm: HomeWords.withdrawConfirm,
          path: RequestPaths.action(RequestKind.home, r.id, 'withdraw'),
          done: HomeWords.withdrawn,
        ),
      if (r.canRemove)
        (
          title: HomeWords.removeTitle(home),
          button: HomeWords.removeTitle(home),
          confirm: HomeWords.removeConfirm(home),
          path: RequestPaths.action(RequestKind.home, r.id, 'remove'),
          done: HomeWords.removed,
        ),
    ],
  );
}

extension on String {
  String? get nullIfEmpty => isEmpty ? null : this;
}
