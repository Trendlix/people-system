import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/auth_controller.dart';
import '../../platform/locator.dart';
import '../../providers.dart';
import '../../theme/look.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import '../profile/account_screens.dart';
import '../profile/profile_parts.dart';
import 'diagnostics.dart';

/// About this app (owner, 31 October 2026: "display the running app version in the more menu. displaying the details that
/// might help in any problem diognostic"), from the More menu: the app's version and build, how far the phone's clock is
/// from People's (a check-in reads People's time), the phone, its location and fingerprint, and who is signed in; and for
/// a Super Admin or a developer only, People's server: its address, how fast it answered and its version ("for the users
/// dont show the people part in about this app. hide the server link"). Gathered on opening and on a pull, and copied as
/// text for a message.
class AboutScreen extends ConsumerStatefulWidget {
  const AboutScreen({super.key});

  @override
  ConsumerState<AboutScreen> createState() => _AboutScreenState();
}

class _AboutScreenState extends ConsumerState<AboutScreen> {
  Diagnostics? _found;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _gather());
  }

  Future<void> _gather() async {
    final config = ref.read(configProvider);
    final client = ref.read(peopleClientProvider);
    final auth = ref.read(authProvider).value;
    final me = auth is SignedIn ? auth.me : null;

    // People: does it answer, how fast, which code, and its time (the phone's clock against it, at the answer's middle)
    Duration? reachedIn, ahead;
    String? commit, committed, newest;
    final sent = DateTime.now();
    final watch = Stopwatch()..start();
    try {
      final v = await client.get('/api/version');
      watch.stop();
      reachedIn = watch.elapsed;
      if (v is Map) {
        commit = v['commit'] is String ? v['commit'] as String : null;
        committed = v['committed'] is String ? v['committed'] as String : null;
        final now = DateTime.tryParse('${v['now']}');
        if (now != null) ahead = sent.add(watch.elapsed ~/ 2).difference(now);
      }
      final latest = await client.get('/api/app/latest');
      if (latest is Map && latest['version'] is String) newest = latest['version'] as String;
    } on Exception {
      // People unreachable (or an older People): said on the page
    }

    final identity = ref.read(deviceIdentityProvider);
    final model = await identity.name();
    final system = await identity.system();
    final problem = await ref.read(locatorProvider).readiness();
    final last = ref.read(locationCacheProvider).last;
    final hasBiometrics = await ref.read(biometricsProvider).available();
    final credential = await ref.read(sessionStoreProvider).readDevice();
    if (!mounted) return;

    final media = MediaQuery.of(context);
    final mode = ref.read(lookProvider);
    final shownDark = Theme.of(context).brightness == Brightness.dark;
    setState(() {
      _found = Diagnostics(
        appVersion: config.version,
        appBuild: config.build,
        appCommit: config.commit,
        appBuilt: config.builtAt,
        newest: newest,
        serverAddress: Uri.tryParse(config.apiUrl)?.host ?? config.apiUrl,
        reachedIn: reachedIn,
        serverCommit: commit,
        serverCommitted: committed,
        clockAhead: ahead,
        phoneModel: model,
        phoneSystem: system,
        screen: '${media.size.width.round()} × ${media.size.height.round()}, text ${media.textScaler.scale(10) / 10}×',
        look: '${shownDark ? 'Dark' : 'Light'}${mode == ThemeMode.system ? ' (as the phone)' : ''}',
        location: switch (problem) {
          null => AboutWords.locationOn,
          LocationProblem.serviceOff => AboutWords.locationOff,
          LocationProblem.denied => AboutWords.locationDenied,
          LocationProblem.deniedForever => AboutWords.locationDeniedForever,
          _ => AboutWords.locationUnread,
        },
        lastPosition: last == null ? null : positionText(accuracy: last.spot.accuracy, mock: last.spot.mock, age: DateTime.now().difference(last.at)),
        fingerprint: !hasBiometrics
            ? AboutWords.fingerprintNone
            : (credential != null && me != null && credential.userId == me.id ? AboutWords.fingerprintOn : AboutWords.fingerprintOff),
        email: me?.email,
        userId: me?.id,
        roles: me?.roles ?? const [],
        showServer: me?.seesServer ?? false,
        at: DateTime.now(),
      );
    });
  }

  Future<void> _copy(Diagnostics d) async {
    await Clipboard.setData(ClipboardData(text: diagnosticsText(d)));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text(AboutWords.copied)));
  }

  @override
  Widget build(BuildContext context) {
    final found = _found;
    return AccountPage(
      eyebrow: AboutWords.eyebrow,
      title: AboutWords.title,
      intro: AboutWords.intro,
      onRefresh: _gather,
      children: [
        if (found == null)
          const CardLoading()
        else ...[
          for (final s in diagnosticSections(found)) _SectionCard(section: s),
          SizedBox(
            height: Tokens.buttonHeight,
            child: FilledButton.icon(
              onPressed: () => _copy(found),
              icon: const Icon(CupertinoIcons.doc_on_doc, size: 19),
              label: const Text(AboutWords.copy),
            ),
          ),
        ],
      ],
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.section});

  final DiagnosticSection section;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(section.title, style: text.titleMedium),
          const SizedBox(height: 8),
          for (final (label, value) in section.rows)
            MergeSemantics(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(flex: 2, child: Text(label, style: text.bodyMedium?.copyWith(color: p.muted))),
                    const SizedBox(width: 12),
                    Expanded(flex: 3, child: SelectableText(value, style: text.bodyMedium)),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
