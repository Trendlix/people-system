import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/foundation.dart' show TargetPlatform, defaultTargetPlatform;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../providers.dart';
import '../theme/parts.dart';
import '../theme/tokens.dart';

/// The gate's words, in one place (ready for Arabic).
abstract final class UpdateWords {
  static const eyebrow = 'Trendlix People';
  static const title = 'Update required';
  static String intro(String latest, String mine) =>
      'A newer version of Trendlix People is out ($latest). Install it to keep using the app; this phone has $mine.';
  static const steps = 'Download it, then open the downloaded file and tap Install. It installs over this one.';
  static const download = 'Download the update';
  static String cantOpen(String url) => 'The browser couldn’t be opened. Go to $url to download the update.';
}

/// The app's newest build, as People tells it (GET /api/app/latest).
typedef LatestApp = ({String version, String downloadUrl});

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
final linkOpenerProvider = Provider<Future<bool> Function(Uri)>((ref) => (uri) => launchUrl(uri, mode: LaunchMode.externalApplication));

/// Always the newest build (owner, 31 October 2026: "in the next build i would prefare to apply the force update rule";
/// asked, "Always the latest build" and "A fixed People link"): on opening and coming back, the app asks People for the
/// newest build (GitHub's latest release, flutter-android.yml); when this one is older, only "Update required" shows,
/// signed in or not, with the link that downloads the newest APK. Never in the way when it can't tell: a build without a
/// version (a developer's, 0.0.0), not on Android (only an APK is built), or People unreachable. Once known old, it
/// stays held until the new build is installed.
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
  DateTime? _askedAt;
  bool _asking = false;
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
    final mine = ref.read(configProvider).version;
    if (_asking || mine == '0.0.0' || defaultTargetPlatform != TargetPlatform.android) return;
    _asking = true;
    _askedAt = DateTime.now();
    try {
      final body = await ref.read(peopleClientProvider).get('/api/app/latest');
      if (!mounted || body is! Map) return;
      final latest = body['version'], url = body['downloadUrl'];
      if (latest is String && url is String && isOlderVersion(mine, latest)) {
        setState(() => _newer = (version: latest, downloadUrl: url));
      }
    } on Exception {
      // People unreachable or an older People without the endpoint: never a reason to hold the app
    } finally {
      _asking = false;
    }
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
    final newer = _newer;
    if (newer == null) return widget.child;
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final mine = ref.watch(configProvider).version;
    final problem = _problem;
    return Stack(
      children: [
        Offstage(child: widget.child),
        Positioned.fill(
          child: Scaffold(
            backgroundColor: p.canvas,
            body: SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Align(alignment: AlignmentDirectional.centerStart, child: Wordmark(height: 28, forDark: p.isDark)),
                    const Spacer(),
                    Center(child: Icon(CupertinoIcons.arrow_down_circle, size: 56, color: p.ink)),
                    const SizedBox(height: 20),
                    const Center(child: Eyebrow(UpdateWords.eyebrow)),
                    const SizedBox(height: 8),
                    Text(UpdateWords.title, textAlign: TextAlign.center, style: text.displaySmall),
                    const SizedBox(height: 10),
                    Text(UpdateWords.intro(newer.version, mine), textAlign: TextAlign.center, style: text.bodyMedium?.copyWith(color: p.muted)),
                    const SizedBox(height: 18),
                    Text(UpdateWords.steps, textAlign: TextAlign.center, style: text.bodyMedium),
                    if (problem != null) ...[const SizedBox(height: 18), Notice(text: problem, ok: false)],
                    const Spacer(),
                    SizedBox(
                      height: Tokens.buttonHeight,
                      child: FilledButton.icon(
                        onPressed: () => _download(newer),
                        icon: const Icon(CupertinoIcons.arrow_down_to_line, size: 20),
                        label: const Text(UpdateWords.download),
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
