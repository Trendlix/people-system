import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../auth/auth_controller.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';

/// Sign-in's words, in one place (ready for Arabic).
abstract final class SignInWords {
  static const eyebrow = 'Trendlix People';
  static const title = 'Welcome back.';
  static const subtitle = 'Sign in with your work email.';
  static const fingerprint = 'Sign in with fingerprint';
  static const orPassword = 'or use your password';
  static const email = 'Work email';
  static const password = 'Password';
  static const show = 'Show password';
  static const hide = 'Hide password';
  static const signIn = 'Sign in';
  static const needEmail = 'Enter your work email.';
  static const needPassword = 'Enter your password.';
}

class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key, required this.state});

  final SignedOut state;

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _hidden = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // the fingerprint asked for at once, unless something needs saying first
    if (widget.state.fingerprint && widget.state.notice == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _fingerprint());
    }
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    String? error;
    try {
      await action();
    } on ApiException catch (e) {
      error = e.message;
    } on FingerprintProblem catch (e) {
      error = e.message;
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = error;
        });
      }
    }
  }

  void _fingerprint() => _run(() => ref.read(authProvider.notifier).signInWithFingerprint());

  void _signIn() {
    final email = _email.text.trim();
    if (email.isEmpty) return setState(() => _error = SignInWords.needEmail);
    if (_password.text.isEmpty) return setState(() => _error = SignInWords.needPassword);
    FocusScope.of(context).unfocus();
    _run(() => ref.read(authProvider.notifier).signInWithPassword(email, _password.text));
  }

  /// Filled when it is the way in; outlined under the fingerprint's.
  Widget _signInButton() {
    final child = _busy ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.5)) : const Text(SignInWords.signIn);
    final onPressed = _busy ? null : _signIn;
    return widget.state.fingerprint ? OutlinedButton(onPressed: onPressed, child: child) : FilledButton(onPressed: onPressed, child: child);
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final notice = widget.state.notice;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 28, 20, 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Align(alignment: AlignmentDirectional.centerStart, child: Wordmark(height: 28)),
                    const SizedBox(height: 40),
                    const Eyebrow(SignInWords.eyebrow),
                    const SizedBox(height: 8),
                    Text(SignInWords.title, style: text.displaySmall),
                    const SizedBox(height: 8),
                    Text(SignInWords.subtitle, style: text.bodyMedium?.copyWith(color: p.muted)),
                    const SizedBox(height: 28),
                    if (notice != null) ...[Notice(text: notice, ok: false), const SizedBox(height: 12)],
                    SurfaceCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (widget.state.fingerprint) ...[
                            SizedBox(
                              height: 58,
                              child: FilledButton.icon(
                                onPressed: _busy ? null : _fingerprint,
                                style: FilledButton.styleFrom(textStyle: text.titleMedium),
                                icon: const Icon(Icons.fingerprint_rounded, size: 26),
                                label: const Text(SignInWords.fingerprint),
                              ),
                            ),
                            const SizedBox(height: 18),
                            Row(
                              children: [
                                const Expanded(child: Divider()),
                                Padding(
                                  padding: const EdgeInsets.symmetric(horizontal: 10),
                                  child: Text(SignInWords.orPassword, style: text.bodySmall),
                                ),
                                const Expanded(child: Divider()),
                              ],
                            ),
                            const SizedBox(height: 18),
                          ],
                          TextField(
                            controller: _email,
                            enabled: !_busy,
                            keyboardType: TextInputType.emailAddress,
                            autocorrect: false,
                            textInputAction: TextInputAction.next,
                            autofillHints: const [AutofillHints.email, AutofillHints.username],
                            decoration: const InputDecoration(labelText: SignInWords.email, prefixIcon: Icon(CupertinoIcons.mail, size: 20)),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _password,
                            enabled: !_busy,
                            obscureText: _hidden,
                            textInputAction: TextInputAction.done,
                            autofillHints: const [AutofillHints.password],
                            onSubmitted: (_) => _signIn(),
                            decoration: InputDecoration(
                              labelText: SignInWords.password,
                              prefixIcon: const Icon(CupertinoIcons.lock, size: 20),
                              suffixIcon: IconButton(
                                tooltip: _hidden ? SignInWords.show : SignInWords.hide,
                                icon: Icon(_hidden ? CupertinoIcons.eye : CupertinoIcons.eye_slash, size: 20),
                                onPressed: () => setState(() => _hidden = !_hidden),
                              ),
                            ),
                          ),
                          if (_error != null) ...[const SizedBox(height: 12), Notice(text: _error!, ok: false)],
                          const SizedBox(height: 18),
                          SizedBox(height: Tokens.buttonHeight, child: _signInButton()),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
