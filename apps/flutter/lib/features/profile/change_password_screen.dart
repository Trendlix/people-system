import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';
import 'account_screens.dart';
import 'profile_parts.dart';
import 'profile_words.dart';

// Change Password (the phone design; apps/web account/password): the current password, the new one and its
// confirmation, each with an eye to show it; People's rule under the new one; People's refusals in its words (POST
// /api/auth/change-password, { currentPassword, newPassword }). Changing it ends one's other sessions and stops
// fingerprint sign-in on every phone, so this phone's copy of the credential goes too (as the website's app page does).
// The passwords are only ever in the fields and the request's body: never kept, never logged.

class ChangePasswordScreen extends ConsumerStatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  ConsumerState<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends ConsumerState<ChangePasswordScreen> {
  final _current = TextEditingController();
  final _fresh = TextEditingController();
  final _confirm = TextEditingController();
  var _busy = false;

  /// What the last press came to: People's words, or the good news.
  ({String text, bool ok})? _said;

  @override
  void initState() {
    super.initState();
    _fresh.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _current.dispose();
    _fresh.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _change() async {
    FocusScope.of(context).unfocus();
    if (_fresh.text != _confirm.text) {
      setState(() => _said = (text: AccountWords.noMatch, ok: false));
      return;
    }
    setState(() {
      _busy = true;
      _said = null;
    });
    try {
      await ref.read(peopleClientProvider).post('/api/auth/change-password', {'currentPassword': _current.text, 'newPassword': _fresh.text});
      // People stopped fingerprint sign-in on every phone: this one's copy goes, so it offers it again next time
      await ref.read(sessionStoreProvider).clearDevice();
      _current.clear();
      _fresh.clear();
      _confirm.clear();
      if (mounted) setState(() => _said = (text: AccountWords.changed, ok: true));
    } on Object catch (e) {
      if (mounted) setState(() => _said = (text: wordsOf(e), ok: false));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final length = _fresh.text.length;
    final filled = (length.clamp(0, 10) / 2.5).floor();
    final said = _said;
    return AccountPage(
      eyebrow: AccountWords.securityEyebrow,
      title: AccountWords.passwordTitle,
      intro: AccountWords.passwordIntro,
      children: [
        SurfaceCard(
          padding: const EdgeInsets.all(24),
          child: AutofillGroup(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                PasswordField(label: AccountWords.current, controller: _current, enabled: !_busy, autofill: AutofillHints.password),
                const SizedBox(height: 18),
                PasswordField(label: AccountWords.fresh, controller: _fresh, enabled: !_busy, autofill: AutofillHints.newPassword),
                const SizedBox(height: 8),
                Semantics(
                  label: AccountWords.lengthOf(length.clamp(0, 10)),
                  excludeSemantics: true,
                  child: Row(
                    children: [
                      for (var i = 0; i < 4; i++) ...[
                        if (i > 0) const SizedBox(width: 4),
                        Expanded(
                          child: Container(
                            height: 3,
                            decoration: BoxDecoration(color: i < filled ? p.ink : p.track, borderRadius: BorderRadius.circular(Tokens.radiusPill)),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 7),
                Text(AccountWords.rule, style: text.bodySmall),
                const SizedBox(height: 19),
                PasswordField(label: AccountWords.confirm, controller: _confirm, enabled: !_busy, autofill: AutofillHints.newPassword, onSubmitted: _change),
                const SizedBox(height: 19),
                Align(
                  alignment: Alignment.centerLeft,
                  child: SolidButton(_busy ? AccountWords.changing : AccountWords.changePassword, busy: _busy, onPressed: _change),
                ),
                if (said != null) ...[const SizedBox(height: 16), Notice(text: said.text, ok: said.ok)],
              ],
            ),
          ),
        ),
        const _Guidance(),
      ],
    );
  }
}

/// A password's field: its label over it, the eye to show or hide what was typed (hidden every time it opens).
class PasswordField extends StatefulWidget {
  const PasswordField({super.key, required this.label, required this.controller, required this.enabled, required this.autofill, this.onSubmitted});

  final String label;
  final TextEditingController controller;
  final bool enabled;
  final String autofill;
  final VoidCallback? onSubmitted;

  @override
  State<PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<PasswordField> {
  var _shown = false;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(widget.label, style: text.labelMedium),
        const SizedBox(height: 8),
        TextField(
          controller: widget.controller,
          enabled: widget.enabled,
          obscureText: !_shown,
          autocorrect: false,
          enableSuggestions: false,
          autofillHints: [widget.autofill],
          keyboardType: TextInputType.visiblePassword,
          textInputAction: widget.onSubmitted == null ? TextInputAction.next : TextInputAction.done,
          onSubmitted: widget.onSubmitted == null ? null : (_) => widget.onSubmitted!(),
          decoration: InputDecoration(
            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(11),
              borderSide: BorderSide(color: p.line),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(11),
              borderSide: BorderSide(color: p.line),
            ),
            suffixIcon: IconButton(
              tooltip: _shown ? AccountWords.hide : AccountWords.show,
              onPressed: () => setState(() => _shown = !_shown),
              icon: Icon(_shown ? CupertinoIcons.eye_slash : CupertinoIcons.eye, size: 20, color: p.muted),
            ),
          ),
        ),
      ],
    );
  }
}

/// The dark card of advice (the design's "Password guidance"), light on the dark look.
class _Guidance extends StatelessWidget {
  const _Guidance();

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(color: p.inverse, borderRadius: BorderRadius.circular(Tokens.radiusCard), boxShadow: p.shadow),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            AccountWords.guidance.toUpperCase(),
            style: text.labelSmall?.copyWith(color: p.inverseMuted),
            semanticsLabel: AccountWords.guidance,
          ),
          const SizedBox(height: 8),
          Text(AccountWords.guidanceTitle, style: text.headlineSmall?.copyWith(fontSize: 27, letterSpacing: -1.35, height: 1.05, color: p.onInverse)),
          const SizedBox(height: 29),
          for (final tip in AccountWords.tips)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 7),
                    child: Container(
                      width: 5,
                      height: 5,
                      decoration: BoxDecoration(shape: BoxShape.circle, color: p.onInverse),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(tip, style: text.bodySmall?.copyWith(color: p.inverseMuted)),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
