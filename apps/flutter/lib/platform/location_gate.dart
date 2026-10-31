import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart';
import '../providers.dart';
import '../theme/parts.dart';
import '../theme/tokens.dart';
import 'locator.dart';

/// The gate's words, in one place (ready for Arabic).
abstract final class LocationGateWords {
  static const eyebrow = 'Trendlix People';
  static const title = 'Turn on location';
  static const intro = 'Trendlix People works with your location on: for checking in and out, and to keep a record of where each action is made.';
  static const serviceOff = 'Location is off on this phone.';
  static const denied = 'Trendlix People isn’t allowed to use your location.';
  static const deniedForever = 'Location was refused for Trendlix People. Allow it in the app’s settings: Permissions → Location → Allow.';
  static const turnOn = 'Turn on location';
  static const allow = 'Allow location';
  static const openSettings = 'Open the app’s settings';
  static const signOut = 'Sign out';
}

/// The app only with the location on (owner, 31 October 2026: "app has to be location enabled to work"; asked, "Whole
/// app needs location"): signed in, while the phone's location is off or the app isn't allowed it, a screen to turn it on
/// or allow it in place of the app (kept as it was underneath), checked again whenever the app comes back. Reading the
/// position stays at a press and once a minute in use (LocationCache), never in the background.
class LocationGate extends ConsumerStatefulWidget {
  const LocationGate({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<LocationGate> createState() => _LocationGateState();
}

class _LocationGateState extends ConsumerState<LocationGate> with WidgetsBindingObserver {
  /// Why the location can't be read; null: it can, or not known yet (the app shows meanwhile).
  LocationProblem? _problem;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _check());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _check();
  }

  Future<void> _check() async {
    final problem = await ref.read(locatorProvider).readiness();
    if (!mounted) return;
    // only the location's switch and its permission close the app: a slow or failed reading doesn't
    setState(() => _problem = problem == LocationProblem.serviceOff || problem == LocationProblem.denied || problem == LocationProblem.deniedForever ? problem : null);
  }

  Future<void> _fix() async {
    final locator = ref.read(locatorProvider);
    setState(() => _busy = true);
    switch (_problem) {
      case LocationProblem.serviceOff:
        await locator.openLocationSettings();
      case LocationProblem.denied:
        await locator.ask();
      case LocationProblem.deniedForever:
        await locator.openAppSettings();
      default:
    }
    if (!mounted) return;
    setState(() => _busy = false);
    await _check();
  }

  @override
  Widget build(BuildContext context) {
    final signedIn = ref.watch(authProvider).value is SignedIn;
    final problem = _problem;
    if (!signedIn || problem == null) return widget.child;
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final (line, action) = switch (problem) {
      LocationProblem.serviceOff => (LocationGateWords.serviceOff, LocationGateWords.turnOn),
      LocationProblem.deniedForever => (LocationGateWords.deniedForever, LocationGateWords.openSettings),
      _ => (LocationGateWords.denied, LocationGateWords.allow),
    };
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
                    Center(child: Icon(CupertinoIcons.location_slash, size: 56, color: p.ink)),
                    const SizedBox(height: 20),
                    const Center(child: Eyebrow(LocationGateWords.eyebrow)),
                    const SizedBox(height: 8),
                    Text(LocationGateWords.title, textAlign: TextAlign.center, style: text.displaySmall),
                    const SizedBox(height: 10),
                    Text(LocationGateWords.intro, textAlign: TextAlign.center, style: text.bodyMedium?.copyWith(color: p.muted)),
                    const SizedBox(height: 18),
                    Notice(text: line, ok: false),
                    const Spacer(),
                    SizedBox(
                      height: Tokens.buttonHeight,
                      child: FilledButton.icon(
                        onPressed: _busy ? null : _fix,
                        icon: const Icon(CupertinoIcons.location_fill, size: 20),
                        label: Text(action),
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextButton(onPressed: _busy ? null : () => ref.read(authProvider.notifier).signOut(), child: const Text(LocationGateWords.signOut)),
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
