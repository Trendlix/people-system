import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../auth/auth_controller.dart';
import '../../theme/tokens.dart';

/// Sign-in's words, in one place (ready for Arabic).
abstract final class SignInWords {
  static const title = 'Trendlix People';
  static const subtitle = 'Sign in with your work email';
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
    final text = Theme.of(context).textTheme;
    final notice = widget.state.notice;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: Tokens.pagePadding,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const _Mark(),
                    const SizedBox(height: Tokens.gap * 1.5),
                    Text(SignInWords.title, textAlign: TextAlign.center, style: text.headlineMedium?.copyWith(fontWeight: FontWeight.w800, color: Tokens.ink)),
                    const SizedBox(height: 4),
                    Text(SignInWords.subtitle, textAlign: TextAlign.center, style: text.bodyLarge?.copyWith(color: Tokens.muted)),
                    const SizedBox(height: Tokens.gap * 2),
                    if (notice != null) ...[_Message(text: notice, tone: Tokens.warn, background: Tokens.warnSoft), const SizedBox(height: Tokens.gap)],
                    if (widget.state.fingerprint) ...[
                      SizedBox(
                        height: 56,
                        child: FilledButton.icon(
                          onPressed: _busy ? null : _fingerprint,
                          icon: const Icon(Icons.fingerprint_rounded, size: 28),
                          label: const Text(SignInWords.fingerprint),
                        ),
                      ),
                      const SizedBox(height: Tokens.gap),
                      Row(
                        children: [
                          const Expanded(child: Divider()),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: Tokens.gapSmall),
                            child: Text(SignInWords.orPassword, style: text.bodySmall?.copyWith(color: Tokens.muted)),
                          ),
                          const Expanded(child: Divider()),
                        ],
                      ),
                      const SizedBox(height: Tokens.gap),
                    ],
                    TextField(
                      controller: _email,
                      enabled: !_busy,
                      keyboardType: TextInputType.emailAddress,
                      autocorrect: false,
                      textInputAction: TextInputAction.next,
                      autofillHints: const [AutofillHints.email, AutofillHints.username],
                      decoration: const InputDecoration(labelText: SignInWords.email, prefixIcon: Icon(Icons.alternate_email_rounded)),
                    ),
                    const SizedBox(height: Tokens.gap - 4),
                    TextField(
                      controller: _password,
                      enabled: !_busy,
                      obscureText: _hidden,
                      textInputAction: TextInputAction.done,
                      autofillHints: const [AutofillHints.password],
                      onSubmitted: (_) => _signIn(),
                      decoration: InputDecoration(
                        labelText: SignInWords.password,
                        prefixIcon: const Icon(Icons.lock_outline_rounded),
                        suffixIcon: IconButton(
                          tooltip: _hidden ? SignInWords.show : SignInWords.hide,
                          icon: Icon(_hidden ? Icons.visibility_rounded : Icons.visibility_off_rounded),
                          onPressed: () => setState(() => _hidden = !_hidden),
                        ),
                      ),
                    ),
                    if (_error != null) ...[const SizedBox(height: Tokens.gap), _Message(text: _error!, tone: Tokens.danger, background: Tokens.dangerSoft)],
                    const SizedBox(height: Tokens.gap * 1.5),
                    SizedBox(height: 52, child: _signInButton()),
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

/// The app's mark until the owner's design: the icon's black square, a white T and the red dot.
class _Mark extends StatelessWidget {
  const _Mark();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        width: 72,
        height: 72,
        decoration: BoxDecoration(color: Colors.black, borderRadius: BorderRadius.circular(Tokens.radiusCard)),
        child: Stack(
          alignment: Alignment.center,
          children: [
            const Text('T', style: TextStyle(color: Colors.white, fontSize: 40, fontWeight: FontWeight.w800, height: 1)),
            Positioned(
              right: 16,
              bottom: 16,
              child: Container(width: 9, height: 9, decoration: const BoxDecoration(color: Tokens.brandRed, shape: BoxShape.circle)),
            ),
          ],
        ),
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.text, required this.tone, required this.background});

  final String text;
  final Color tone;
  final Color background;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(Tokens.gap - 2),
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(Tokens.radiusControl)),
      child: Text(text, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: tone)),
    );
  }
}
