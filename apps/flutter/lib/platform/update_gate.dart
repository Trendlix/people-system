import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/foundation.dart' show TargetPlatform, defaultTargetPlatform;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:in_app_update/in_app_update.dart';
import 'package:url_launcher/url_launcher.dart';

import '../providers.dart';
import '../theme/parts.dart';
import '../theme/tokens.dart';
import '../theme/wide.dart';

/// The gate's words, in one place (ready for Arabic).
abstract final class UpdateWords {
  static const eyebrow = 'Trendlix People';
  static const title = 'Update required';
  static String versions(String latest, String mine) => 'Version $latest is out; this phone has $mine.';
  static const stepDownload = 'Download the new version: it saves trendlix-people.apk to Downloads.';
  static const stepRemove = 'Remove this version: on its App info page, tap Uninstall.';
  static const stepInstallAfterRemoving = 'Open trendlix-people.apk from Downloads, tap Install, then sign in again.';
  static const stepInstall = 'Open trendlix-people.apk from Downloads and tap Install.';
  static const download = 'Download the update';
  static const remove = 'Remove this version';
  static String cantOpen(String url) => 'The browser couldn’t be opened. Go to $url to download the update.';
  // from a store (10 November 2026): Google Play's or the App Store's own update
  static const onPlay = 'A new version is on Google Play. Update to keep using the app.';
  static String onAppStore(String latest, String mine) => 'Version $latest is on the App Store; this iPhone has $mine. Update to keep using the app.';
  static const updatePlay = 'Update from Google Play';
  static const updateAppStore = 'Update from the App Store';
  static String cantOpenStore(String url) => 'The store couldn’t be opened. Go to $url to update.';
}

/// Where a store build's update comes from.
enum UpdateFrom { googlePlay, appStore }

/// A newer version in the store: where, its version when known, and its page there.
typedef StoreUpdate = ({UpdateFrom from, String? version, Uri page});

/// The app's page on Google Play (its closed test's testers have it).
final playPage = Uri.parse('https://play.google.com/store/apps/details?id=com.trendlix.people');

/// The app's newest build, as People tells it (GET /api/app/latest).
typedef LatestApp = ({String version, String downloadUrl, bool removeOldFirst});

/// Whether [mine] is older than [latest]: versions as the app's builds name them (0.6.14), compared part by part.
bool isOlderVersion(String mine, String latest) {
  List<int>? parts(String v) {
    final p = v.trim().split('.').map(int.tryParse).toList();
    return p.isEmpty || p.contains(null) ? null : p.cast<int>();
  }

  final a = parts(mine), b = parts(latest);
  if (a == null || b == null) return false;
  for (var i = 0; i < a.length || i < b.length; i++) {
    final x = i < a.length ? a[i] : 0, y = i < b.length ? b[i] : 0;
    if (x != y) return x < y;
  }
  return false;
}

/// Opens a link outside the app (the phone's browser, which downloads the APK). Replaced in the tests.
final linkOpenerProvider = Provider<Future<bool> Function(Uri)>(
  (ref) =>
      (uri) => launchUrl(uri, mode: LaunchMode.externalApplication),
);

/// A Play build's update (owner, 6 November 2026: "now i have google play console"; asked, "Play only"): Google Play says
/// whether a newer version of the app is live there, and when it is, Play's own full-screen update runs (an "immediate"
/// update: the app restarts on the new version). Since 10 November 2026 (owner: "make the update force to all builds")
/// "Update required" stays in place of the app while Play has one, so backing out of Play's update leaves nothing usable.
/// Never in the way when Play can't tell (a build not installed from Play, no Play services). Replaced in the tests.
abstract interface class PlayUpdates {
  /// Whether Google Play has a newer version for this phone; false when it can't tell.
  Future<bool> available();

  /// Play's full-screen update. True: it ran; false: Play doesn't allow it here, or it failed (the app's Play page then).
  Future<bool> update();
}

class DevicePlayUpdates implements PlayUpdates {
  const DevicePlayUpdates();

  @override
  Future<bool> available() async {
    try {
      final info = await InAppUpdate.checkForUpdate();
      return info.updateAvailability == UpdateAvailability.updateAvailable || info.updateAvailability == UpdateAvailability.developerTriggeredUpdateInProgress;
    } on Exception {
      // not installed from Play, or Play unreachable: the app carries on
      return false;
    }
  }

  @override
  Future<bool> update() async {
    try {
      final info = await InAppUpdate.checkForUpdate();
      if (!info.immediateUpdateAllowed) return false;
      return await InAppUpdate.performImmediateUpdate() == AppUpdateResult.success;
    } on Exception {
      return false;
    }
  }
}

final playUpdateProvider = Provider<PlayUpdates>((ref) => const DevicePlayUpdates());

/// Always the newest build (owner, 31 October 2026: "in the next build i would prefare to apply the force update rule";
/// asked, "Always the latest build" and "A fixed People link"): on opening and coming back, the app asks People for the
/// newest build (GitHub's latest release, flutter-android.yml); when this one is older, only "Update required" shows,
/// signed in or not, and the download opens by itself once ("redirect the user to install the new version"). Until the
/// app is in the stores, the steps say to remove this version before installing the new one ("remind him to remove the
/// old version till posted to the app store or google playstore"; People's removeOldFirst), with a button to the app's
/// App info page, where Uninstall is. Never in the way when it can't tell: a build without a version (a developer's,
/// 0.0.0), or People unreachable. Once known old, it stays held until the new build is installed. A Play build asks Play
/// instead (playUpdateProvider), held while Play has a newer version; an iPhone or iPad asks People for the App Store's
/// version (GET /api/app/ios-latest; owner, 10 November 2026: "make the update force to all builds"), held while it is
/// newer, with the way to the App Store.
class UpdateGate extends ConsumerStatefulWidget {
  const UpdateGate({super.key, required this.child, this.askEvery = const Duration(minutes: 2)});

  final Widget child;

  /// Coming back sooner than this after the last ask doesn't ask again (the fingerprint's prompt comes and goes).
  final Duration askEvery;

  @override
  ConsumerState<UpdateGate> createState() => _UpdateGateState();
}

class _UpdateGateState extends ConsumerState<UpdateGate> with WidgetsBindingObserver {
  /// The newer build to install; null: none, or not known.
  LatestApp? _newer;

  /// A newer version in Google Play or the App Store; null: none, or not known.
  StoreUpdate? _store;
  DateTime? _askedAt;
  bool _asking = false;

  /// The download was opened by itself already (once while the app runs, not on every return to it).
  bool _openedOnce = false;
  String? _problem;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _ask());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final at = _askedAt;
    if (state == AppLifecycleState.resumed && (at == null || DateTime.now().difference(at) >= widget.askEvery)) _ask();
  }

  Future<void> _ask() async {
    final config = ref.read(configProvider);
    final mine = config.version;
    final ios = defaultTargetPlatform == TargetPlatform.iOS;
    if (_asking || mine == '0.0.0' || (defaultTargetPlatform != TargetPlatform.android && !ios)) return;
    _asking = true;
    _askedAt = DateTime.now();
    if (ios) {
      try {
        await _askAppStore(mine);
      } finally {
        _asking = false;
      }
      return;
    }
    if (config.playStore) {
      try {
        await _askPlay();
      } finally {
        _asking = false;
      }
      return;
    }
    try {
      final body = await ref.read(peopleClientProvider).get('/api/app/latest');
      if (!mounted || body is! Map) return;
      final latest = body['version'], url = body['downloadUrl'];
      if (latest is String && url is String && isOlderVersion(mine, latest)) {
        final newer = (version: latest, downloadUrl: url, removeOldFirst: body['removeOldFirst'] != false);
        setState(() => _newer = newer);
        if (!_openedOnce) {
          _openedOnce = true;
          await _download(newer);
        }
      }
    } on Exception {
      // People unreachable or an older People without the endpoint: never a reason to hold the app
    } finally {
      _asking = false;
    }
  }

  /// Google Play: held while it has a newer version, its update run by itself once.
  Future<void> _askPlay() async {
    final has = await ref.read(playUpdateProvider).available();
    if (!mounted) return;
    setState(() => _store = has ? (from: UpdateFrom.googlePlay, version: null, page: playPage) : null);
    if (has && !_openedOnce) {
      _openedOnce = true;
      await _updateFromStore();
    }
  }

  /// The App Store's version, as People reads it: held while it is newer than this build (a TestFlight build newer than
  /// the store's isn't).
  Future<void> _askAppStore(String mine) async {
    try {
      final body = await ref.read(peopleClientProvider).get('/api/app/ios-latest');
      if (!mounted || body is! Map) return;
      final latest = body['version'], url = body['storeUrl'];
      final page = url is String ? Uri.tryParse(url) : null;
      setState(() => _store = latest is String && page != null && isOlderVersion(mine, latest) ? (from: UpdateFrom.appStore, version: latest, page: page) : null);
    } on Exception {
      // People unreachable or an older People without the endpoint: never a reason to hold the app
    }
  }

  /// The store's update: Play's own, else (not allowed, failed) its page; the App Store's page.
  Future<void> _updateFromStore() async {
    final store = _store;
    if (store == null) return;
    setState(() => _problem = null);
    if (store.from == UpdateFrom.googlePlay && await ref.read(playUpdateProvider).update()) return;
    var opened = false;
    try {
      opened = await ref.read(linkOpenerProvider)(store.page);
    } on Exception {
      opened = false;
    }
    if (!opened && mounted) setState(() => _problem = UpdateWords.cantOpenStore(store.page.toString()));
  }

  Future<void> _download(LatestApp newer) async {
    setState(() => _problem = null);
    var opened = false;
    try {
      opened = await ref.read(linkOpenerProvider)(Uri.parse(newer.downloadUrl));
    } on Exception {
      opened = false;
    }
    if (!opened && mounted) setState(() => _problem = UpdateWords.cantOpen(newer.downloadUrl));
  }

  @override
  Widget build(BuildContext context) {
    final store = _store;
    if (store != null) return _storeGate(context, store);
    final newer = _newer;
    if (newer == null) return widget.child;
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final mine = ref.watch(configProvider).version;
    final problem = _problem;
    final steps = [
      UpdateWords.stepDownload,
      if (newer.removeOldFirst) UpdateWords.stepRemove,
      newer.removeOldFirst ? UpdateWords.stepInstallAfterRemoving : UpdateWords.stepInstall,
    ];
    return Stack(
      children: [
        Offstage(child: widget.child),
        Positioned.fill(
          child: Scaffold(
            backgroundColor: p.canvas,
            body: SafeArea(
              child: SingleChildScrollView(
                padding: centredPadding(context, const EdgeInsets.fromLTRB(24, 24, 24, 32), max: Tokens.noticeMaxWidth),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: Wordmark(height: 28, forDark: p.isDark),
                    ),
                    const SizedBox(height: 36),
                    Center(child: Icon(CupertinoIcons.arrow_down_circle, size: 56, color: p.ink)),
                    const SizedBox(height: 20),
                    const Center(child: Eyebrow(UpdateWords.eyebrow)),
                    const SizedBox(height: 8),
                    Text(UpdateWords.title, textAlign: TextAlign.center, style: text.displaySmall),
                    const SizedBox(height: 10),
                    Text(
                      UpdateWords.versions(newer.version, mine),
                      textAlign: TextAlign.center,
                      style: text.bodyMedium?.copyWith(color: p.muted),
                    ),
                    const SizedBox(height: 22),
                    for (final (i, step) in steps.indexed) _Step(number: i + 1, text: step),
                    if (problem != null) ...[const SizedBox(height: 12), Notice(text: problem, ok: false)],
                    const SizedBox(height: 24),
                    SizedBox(
                      height: Tokens.buttonHeight,
                      child: FilledButton.icon(
                        onPressed: () => _download(newer),
                        icon: const Icon(CupertinoIcons.arrow_down_to_line, size: 20),
                        label: const Text(UpdateWords.download),
                      ),
                    ),
                    if (newer.removeOldFirst) ...[
                      const SizedBox(height: 10),
                      SizedBox(
                        height: Tokens.buttonHeight,
                        // the app's App info page (Settings → Apps → Trendlix People), where Uninstall is
                        child: OutlinedButton.icon(
                          onPressed: () => ref.read(locatorProvider).openAppSettings(),
                          icon: const Icon(CupertinoIcons.trash, size: 20),
                          label: const Text(UpdateWords.remove),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// "Update required" from a store: what is newer and where, and the way to update (Play's own, the App Store's page).
  Widget _storeGate(BuildContext context, StoreUpdate store) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final mine = ref.watch(configProvider).version;
    final play = store.from == UpdateFrom.googlePlay;
    final problem = _problem;
    return Stack(
      children: [
        Offstage(child: widget.child),
        Positioned.fill(
          child: Scaffold(
            backgroundColor: p.canvas,
            body: SafeArea(
              child: SingleChildScrollView(
                padding: centredPadding(context, const EdgeInsets.fromLTRB(24, 24, 24, 32), max: Tokens.noticeMaxWidth),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Align(alignment: AlignmentDirectional.centerStart, child: Wordmark(height: 28, forDark: p.isDark)),
                    const SizedBox(height: 36),
                    Center(child: Icon(CupertinoIcons.arrow_down_circle, size: 56, color: p.ink)),
                    const SizedBox(height: 20),
                    const Center(child: Eyebrow(UpdateWords.eyebrow)),
                    const SizedBox(height: 8),
                    Text(UpdateWords.title, textAlign: TextAlign.center, style: text.displaySmall),
                    const SizedBox(height: 10),
                    Text(
                      play ? UpdateWords.onPlay : UpdateWords.onAppStore(store.version ?? '', mine),
                      textAlign: TextAlign.center,
                      style: text.bodyMedium?.copyWith(color: p.muted),
                    ),
                    if (problem != null) ...[const SizedBox(height: 12), Notice(text: problem, ok: false)],
                    const SizedBox(height: 24),
                    SizedBox(
                      height: Tokens.buttonHeight,
                      child: FilledButton.icon(
                        onPressed: _updateFromStore,
                        icon: const Icon(CupertinoIcons.arrow_down_to_line, size: 20),
                        label: Text(play ? UpdateWords.updatePlay : UpdateWords.updateAppStore),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// One numbered step of installing the update.
class _Step extends StatelessWidget {
  const _Step({required this.number, required this.text});

  final int number;
  final String text;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final style = Theme.of(context).textTheme.bodyMedium;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 26,
            height: 26,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: p.ink, shape: BoxShape.circle),
            child: Text(
              '$number',
              style: style?.copyWith(color: p.canvas, fontWeight: FontWeight.w600),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(child: Text(text, style: style)),
        ],
      ),
    );
  }
}
