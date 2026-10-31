// About this app (owner, 31 October 2026: "display the running app version in the more menu. displaying the details that
// might help in any problem diognostic"): what is known about the app, People, the phone and the account, as sections of
// label and value, and the same as plain text to paste into a message. Pure code, tested.

/// The page's words, in one place (ready for Arabic).
abstract final class AboutWords {
  static const eyebrow = 'More';
  static const title = 'About this app';
  static const intro = 'The details that help when something isn’t working. Copy them into your message when you report a problem.';
  static const menu = 'About this app';
  static const copy = 'Copy details';
  static const copied = 'Copied. Paste them into your message.';
  static const checking = 'Checking…';
  static const notKnown = 'Not known';

  static const app = 'App';
  static const version = 'Version';
  static const build = 'Build';
  static const commit = 'Commit';
  static const built = 'Built';
  static const newest = 'Newest';
  static const upToDate = 'Up to date';
  static String newer(String v) => '$v is out: update';

  static const server = 'People';
  static const address = 'Address';
  static const reached = 'Reached';
  static const serverVersion = 'Server version';
  static const clock = 'Phone clock';

  static const phone = 'This phone';
  static const model = 'Model';
  static const system = 'System';
  static const screen = 'Screen';
  static const look = 'Look';
  static const location = 'Location';
  static const lastPosition = 'Last position';
  static const fingerprint = 'Fingerprint sign-in';

  static const account = 'Signed in';
  static const email = 'Email';
  static const userId = 'User ID';
  static const roles = 'Roles';

  static const locationOn = 'On, allowed';
  static const locationOff = 'Off on this phone';
  static const locationDenied = 'Not allowed for the app';
  static const locationDeniedForever = 'Refused: allow it in the app’s settings';
  static const locationUnread = 'Couldn’t be read';
  static const noPosition = 'None read yet';
  static const fingerprintOn = 'On';
  static const fingerprintOff = 'Off';
  static const fingerprintNone = 'No fingerprint or face set up on this phone';
  static const unreachable = 'Couldn’t reach People';
}

/// The More menu's foot (owner, 31 October 2026: "display the running app version in the more menu"): "Trendlix People
/// 0.6.19 · build 1019"; the version alone for a build without its code.
String versionLineOf(String version, String build) => 'Trendlix People $version${build.isEmpty ? '' : ' · build $build'}';

/// One part of the page: its title and its lines.
typedef DiagnosticSection = ({String title, List<(String, String)> rows});

/// What was gathered (AboutScreen). A null value: not known (People unreachable, or not read yet).
class Diagnostics {
  const Diagnostics({
    required this.appVersion,
    this.appBuild = '',
    this.appCommit = '',
    this.appBuilt = '',
    this.newest,
    required this.serverAddress,
    this.reachedIn,
    this.serverCommit,
    this.serverCommitted,
    this.clockAhead,
    this.phoneModel = '',
    this.phoneSystem = '',
    this.screen = '',
    this.look = '',
    this.location,
    this.lastPosition,
    this.fingerprint,
    this.email,
    this.userId,
    this.roles = const [],
    required this.at,
  });

  final String appVersion, appBuild, appCommit, appBuilt;

  /// The newest build People knows of; null: not known.
  final String? newest;

  final String serverAddress;

  /// How long People took to answer; null: it didn't.
  final Duration? reachedIn;
  final String? serverCommit, serverCommitted;

  /// How far the phone's clock is ahead of People's (behind when negative); null: not known.
  final Duration? clockAhead;

  final String phoneModel, phoneSystem, screen, look;
  final String? location, lastPosition, fingerprint;
  final String? email, userId;
  final List<String> roles;

  /// When these were gathered (the phone's clock).
  final DateTime at;
}

/// "In step with People", "2 min 5 s ahead of People", "40 s behind People": within 5 seconds counts as in step.
String clockText(Duration ahead) {
  if (ahead.abs() < const Duration(seconds: 5)) return 'In step with People';
  return '${spanText(ahead.abs())} ${ahead.isNegative ? 'behind' : 'ahead of'} People';
}

/// "3 h 4 min", "2 min 5 s", "40 s".
String spanText(Duration d) {
  final h = d.inHours, m = d.inMinutes % 60, s = d.inSeconds % 60;
  if (h > 0) return m > 0 ? '$h h $m min' : '$h h';
  if (m > 0) return s > 0 ? '$m min $s s' : '$m min';
  return '$s s';
}

/// A position as About shows it: "±12 m, 3 min ago", with "(fake GPS)" when the phone said it is a mock one.
String positionText({required double accuracy, required bool mock, required Duration age}) {
  final ago = age < const Duration(seconds: 5) ? 'just now' : '${spanText(age)} ago';
  return '±${accuracy.round()} m, $ago${mock ? ' (fake GPS)' : ''}';
}

/// The page's sections, in order; lines not known say so.
List<DiagnosticSection> diagnosticSections(Diagnostics d) {
  String known(String? v) => v == null || v.trim().isEmpty ? AboutWords.notKnown : v;
  final newest = d.newest;
  return [
    (
      title: AboutWords.app,
      rows: [
        (AboutWords.version, d.appVersion),
        if (d.appBuild.isNotEmpty) (AboutWords.build, d.appBuild),
        if (d.appCommit.isNotEmpty) (AboutWords.commit, d.appCommit),
        if (d.appBuilt.isNotEmpty) (AboutWords.built, d.appBuilt),
        (AboutWords.newest, newest == null ? AboutWords.notKnown : (newest == d.appVersion ? AboutWords.upToDate : AboutWords.newer(newest))),
      ],
    ),
    (
      title: AboutWords.server,
      rows: [
        (AboutWords.address, d.serverAddress),
        (AboutWords.reached, d.reachedIn == null ? AboutWords.unreachable : 'Yes, in ${d.reachedIn!.inMilliseconds} ms'),
        if (d.reachedIn != null) (AboutWords.serverVersion, [d.serverCommit, d.serverCommitted].whereType<String>().join(' · ').ifEmpty(AboutWords.notKnown)),
        (AboutWords.clock, d.clockAhead == null ? AboutWords.notKnown : clockText(d.clockAhead!)),
      ],
    ),
    (
      title: AboutWords.phone,
      rows: [
        (AboutWords.model, known(d.phoneModel)),
        (AboutWords.system, known(d.phoneSystem)),
        if (d.screen.isNotEmpty) (AboutWords.screen, d.screen),
        if (d.look.isNotEmpty) (AboutWords.look, d.look),
        (AboutWords.location, known(d.location)),
        (AboutWords.lastPosition, d.lastPosition ?? AboutWords.noPosition),
        (AboutWords.fingerprint, known(d.fingerprint)),
      ],
    ),
    if (d.email != null)
      (
        title: AboutWords.account,
        rows: [
          (AboutWords.email, d.email!),
          if (d.userId != null) (AboutWords.userId, d.userId!),
          if (d.roles.isNotEmpty) (AboutWords.roles, d.roles.join(', ')),
        ],
      ),
  ];
}

/// The sections as plain text, to paste into a message: a title line, then "label: value" lines, a blank line between.
String diagnosticsText(Diagnostics d) {
  final out = StringBuffer('Trendlix People: about this app (${d.at.toUtc().toIso8601String().substring(0, 19)}Z)\n');
  for (final s in diagnosticSections(d)) {
    out.write('\n${s.title}\n');
    for (final (label, value) in s.rows) {
      out.write('$label: $value\n');
    }
  }
  return out.toString();
}

extension on String {
  String ifEmpty(String other) => isEmpty ? other : this;
}
