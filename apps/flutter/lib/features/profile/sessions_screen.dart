import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../auth/auth_controller.dart';
import '../../format.dart';
import '../../models/account.dart';
import '../../providers.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import 'account_screens.dart';
import 'profile_data.dart';
import 'profile_parts.dart';
import 'profile_words.dart';

// Your Sessions (the phone design; apps/web account/sessions; owner, 20 October 2026: one session on the website and one
// in the app a person): how many are open, each with where it was signed in, since when and its last activity, and Sign
// out beside it (POST /api/auth/sessions/:id/end; this phone's own signs the app out, as the menu's Sign out does). Then
// the phones that sign in with a fingerprint (GET /api/auth/devices), each with Sign out (POST
// /api/auth/devices/:id/revoke; this phone's own copy is forgotten too), and Turn on for this phone when it can and
// keeps none People still takes.

class SessionsScreen extends ConsumerWidget {
  const SessionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sessions = ref.watch(mySessionsProvider);
    return AccountPage(
      eyebrow: AccountWords.securityEyebrow,
      title: AccountWords.sessionsTitle,
      intro: AccountWords.sessionsIntro,
      onRefresh: () async {
        ref
          ..invalidate(mySessionsProvider)
          ..invalidate(myDevicesProvider)
          ..invalidate(thisPhoneProvider);
        await ref.read(mySessionsProvider.future).catchError((_) => const <OpenSession>[]);
      },
      children: [
        ...switch (sessions) {
          AsyncValue(value: final List<OpenSession> list) => [
            _Health(sessions: list),
            if (list.isEmpty) const SurfaceCard(child: Text(AccountWords.noSessions)),
            for (final kind in [
              ...sessionKindLabels.keys,
              ...{for (final s in list) s.kind}.where((k) => !sessionKindLabels.containsKey(k)),
            ])
              if (list.any((s) => s.kind == kind))
                _KindCard(
                  kind: kind,
                  sessions: [
                    for (final s in list)
                      if (s.kind == kind) s,
                  ],
                ),
          ],
          AsyncError(:final error) => [LoadFailed(error: error, onRetry: () => ref.invalidate(mySessionsProvider))],
          _ => [const CardLoading()],
        },
        const _FingerprintCard(),
      ],
    );
  }
}

/// How many are open, in a ring, and what to make of it.
class _Health extends StatelessWidget {
  const _Health({required this.sessions});

  final List<OpenSession> sessions;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final n = sessions.length;
    final onlyThis = n == 1 && sessions.single.current;
    return SurfaceCard(
      padding: const EdgeInsets.all(22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            label: AccountWords.activeLabel(n),
            excludeSemantics: true,
            child: Container(
              width: 105,
              height: 105,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: p.track, width: 10),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('$n', style: text.headlineMedium?.copyWith(letterSpacing: -1.5, height: 1.2)),
                  Text(AccountWords.activeOf(n), textAlign: TextAlign.center, style: text.bodySmall?.copyWith(fontSize: 12, height: 1.3)),
                ],
              ),
            ),
          ),
          const SizedBox(height: 27),
          const Eyebrow(AccountWords.sessionHealth),
          const SizedBox(height: 7),
          Text(
            onlyThis ? AccountWords.onlyThisDevice : AccountWords.checkTheOthers,
            style: text.titleLarge?.copyWith(fontSize: 22, fontWeight: FontWeight.w400, letterSpacing: -0.88),
          ),
          const SizedBox(height: 10),
          Text(AccountWords.healthLine, style: text.bodySmall),
        ],
      ),
    );
  }
}

/// The sessions of one kind (the website, the app, a Claude connector), each in its box with Sign out.
class _KindCard extends StatelessWidget {
  const _KindCard({required this.kind, required this.sessions});

  final String kind;
  final List<OpenSession> sessions;

  @override
  Widget build(BuildContext context) {
    return SurfaceCard(
      padding: const EdgeInsets.all(22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          CardHead(eyebrow: AccountWords.signedInDevices, title: sessionKindLabels[kind] ?? kind),
          for (final s in sessions) ...[const SizedBox(height: 16), _SessionBox(session: s)],
        ],
      ),
    );
  }
}

class _SessionBox extends ConsumerStatefulWidget {
  const _SessionBox({required this.session});

  final OpenSession session;

  @override
  ConsumerState<_SessionBox> createState() => _SessionBoxState();
}

class _SessionBoxState extends ConsumerState<_SessionBox> {
  var _busy = false;
  String? _error;

  Future<void> _signOut() async {
    final s = widget.session;
    if (s.current) {
      // this phone's own session: signing out here, as the menu's Sign out does
      final yes = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          content: const Text(AccountWords.signOutHere),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text(AccountWords.cancel)),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text(AccountWords.signOut)),
          ],
        ),
      );
      if (yes == true) await ref.read(authProvider.notifier).signOut();
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(peopleClientProvider).post('/api/auth/sessions/${Uri.encodeComponent(s.id)}/end');
      ref.invalidate(mySessionsProvider);
    } on Object catch (e) {
      if (mounted) setState(() => _error = wordsOf(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final s = widget.session;
    final at = s.createdAt == null ? '—' : momentOf(s.createdAt!);
    final last = s.lastActiveAt == null
        ? '—'
        : (s.createdAt != null && isoDayOf(s.lastActiveAt!) == isoDayOf(s.createdAt!) ? clockOf(s.lastActiveAt!) : momentOf(s.lastActiveAt!));
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: p.raised,
        borderRadius: BorderRadius.circular(Tokens.radiusControl),
        border: Border.all(color: p.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          MergeSemantics(
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: p.card,
                    borderRadius: BorderRadius.circular(11),
                    border: Border.all(color: p.line),
                  ),
                  child: Icon(s.kind == 'app' ? CupertinoIcons.device_phone_portrait : CupertinoIcons.square_grid_2x2, size: 18, color: p.ink),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(s.device, style: text.labelMedium?.copyWith(height: 1.5)),
                      if (s.current)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Row(
                            children: [
                              Container(
                                width: 5,
                                height: 5,
                                decoration: BoxDecoration(shape: BoxShape.circle, color: p.ink),
                              ),
                              const SizedBox(width: 6),
                              Text(AccountWords.thisDevice, style: text.bodySmall),
                            ],
                          ),
                        ),
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(AccountWords.signedIn(at, last), style: text.bodySmall),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (_error != null) ...[const SizedBox(height: 10), Text(_error!, style: text.bodySmall?.copyWith(color: p.danger))],
          const SizedBox(height: 12),
          QuietButton(
            _busy ? AccountWords.signingOut : AccountWords.signOut,
            expand: true,
            semanticsLabel: '${AccountWords.signOut}, ${s.device}',
            onPressed: _busy ? null : _signOut,
          ),
        ],
      ),
    );
  }
}

// ---------- fingerprint sign-in ----------

class _FingerprintCard extends ConsumerStatefulWidget {
  const _FingerprintCard();

  @override
  ConsumerState<_FingerprintCard> createState() => _FingerprintCardState();
}

class _FingerprintCardState extends ConsumerState<_FingerprintCard> {
  String? _busy;
  ({String text, bool ok})? _said;

  Future<void> _signOutPhone(FingerprintDevice d, String? thisId) async {
    setState(() {
      _busy = d.id;
      _said = null;
    });
    try {
      await ref.read(peopleClientProvider).post('/api/auth/devices/${Uri.encodeComponent(d.id)}/revoke');
      // this phone's own: the copy behind its fingerprint goes too, so the password is asked for next time
      if (d.id == thisId) await ref.read(sessionStoreProvider).clearDevice();
      ref
        ..invalidate(myDevicesProvider)
        ..invalidate(thisPhoneProvider);
      if (mounted) setState(() => _said = (text: AccountWords.phoneSignedOut, ok: true));
    } on Object catch (e) {
      if (mounted) setState(() => _said = (text: wordsOf(e), ok: false));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _turnOn() async {
    setState(() {
      _busy = 'on';
      _said = null;
    });
    try {
      final on = await ref.read(authProvider.notifier).turnOnFingerprint();
      if (on) {
        ref
          ..invalidate(myDevicesProvider)
          ..invalidate(thisPhoneProvider);
        if (mounted) setState(() => _said = (text: AccountWords.turnedOn, ok: true));
      }
    } on FingerprintProblem catch (e) {
      if (mounted) setState(() => _said = (text: e.message, ok: false));
    } on ApiException catch (e) {
      if (mounted) setState(() => _said = (text: e.message, ok: false));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final devices = ref.watch(myDevicesProvider);
    final phone = ref.watch(thisPhoneProvider).value;
    final thisId = phone?.credentialId;
    final list = devices.value;
    final offer = list != null && phone != null && phone.canUseFingerprint && !list.any((d) => d.id == thisId);
    final said = _said;
    return SurfaceCard(
      padding: const EdgeInsets.all(22),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 38,
            height: 40,
            decoration: BoxDecoration(
              color: p.card,
              borderRadius: BorderRadius.circular(11),
              border: Border.all(color: p.line),
            ),
            child: Icon(Icons.fingerprint_rounded, size: 24, color: p.ink),
          ),
          const SizedBox(width: 18),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Padding(padding: EdgeInsets.only(top: 2), child: Eyebrow(AccountWords.mobileSecurity)),
                const SizedBox(height: 6),
                Semantics(
                  header: true,
                  child: Text(AccountWords.fingerprintTitle, style: text.titleMedium?.copyWith(fontSize: 18, letterSpacing: 0, height: 1.5)),
                ),
                const SizedBox(height: 8),
                Text(AccountWords.fingerprintLine(deviceUnusedDays), style: text.bodySmall),
                const SizedBox(height: 15),
                switch (devices) {
                  AsyncValue(value: final List<FingerprintDevice> list) when list.isEmpty => Text(
                    AccountWords.noPhone,
                    style: text.labelMedium?.copyWith(height: 1.5),
                  ),
                  AsyncValue(value: final List<FingerprintDevice> list) => Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (final d in list)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              MergeSemantics(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Wrap(
                                      spacing: 8,
                                      runSpacing: 4,
                                      crossAxisAlignment: WrapCrossAlignment.center,
                                      children: [
                                        Text('${d.deviceName} · ${d.platformLabel}', style: text.labelMedium?.copyWith(height: 1.5)),
                                        if (d.id == thisId) const Pill(AccountWords.thisPhone),
                                      ],
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      AccountWords.added(
                                        d.createdAt == null ? '—' : shortDateOf(isoDayOf(d.createdAt!)),
                                        d.lastUsedAt == null ? null : momentOf(d.lastUsedAt!),
                                      ),
                                      style: text.bodySmall,
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(height: 8),
                              QuietButton(
                                _busy == d.id ? AccountWords.signingOut : AccountWords.signOut,
                                expand: true,
                                semanticsLabel: '${AccountWords.signOut}, ${d.deviceName}',
                                onPressed: _busy != null ? null : () => _signOutPhone(d, thisId),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                  AsyncError(:final error) => Text('${AccountWords.notLoaded} ${wordsOf(error)}', style: text.bodySmall?.copyWith(color: p.danger)),
                  _ => const SizedBox(
                    height: 24,
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                    ),
                  ),
                },
                if (offer) ...[
                  const SizedBox(height: 12),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: SolidButton(_busy == 'on' ? AccountWords.turningOn : AccountWords.turnOn, busy: _busy != null, onPressed: _turnOn),
                  ),
                ],
                if (said != null) ...[const SizedBox(height: 12), Notice(text: said.text, ok: said.ok)],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
