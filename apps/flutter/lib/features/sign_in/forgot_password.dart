import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../providers.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';

/// Forgot password's words, as the website says them (apps/web/src/app/forgot-password).
abstract final class ForgotWords {
  static const link = 'Forgot password?';
  static const eyebrow = 'Trendlix People';
  static const title = 'Forgot password';
  static const intro = 'Type the email you sign in with. If it has an account, we email it a link to set a new password.';
  static const email = 'Work email';
  static const send = 'Email me a link';
  static const sending = 'Sending…';
  static const needEmail = 'Enter your sign-in email.';
  static const spam = 'Nothing after a few minutes? Check your spam folder, or ask HR for a link.';
  static const done = 'Back to sign in';
  static const failed = 'Couldn’t send it. Check your connection and try again.';
}

/// Forgot password in the app (owner, 31 October 2026: "add forget password to the app"): the website's own (owner, 22
/// October 2026: "Set-password link"): People emails a link to set a new password to an active account with the email,
/// and answers the same either way, so the app never says whether an account has it. The link opens on the website.
Future<void> showForgotPassword(BuildContext context, {String email = ''}) => showDesignSheet<void>(
  context,
  eyebrow: ForgotWords.eyebrow,
  title: ForgotWords.title,
  icon: CupertinoIcons.lock_rotation,
  intro: ForgotWords.intro,
  builder: (_) => ForgotPasswordForm(email: email),
);

class ForgotPasswordForm extends ConsumerStatefulWidget {
  const ForgotPasswordForm({super.key, this.email = ''});

  final String email;

  @override
  ConsumerState<ForgotPasswordForm> createState() => _ForgotPasswordFormState();
}

class _ForgotPasswordFormState extends ConsumerState<ForgotPasswordForm> {
  late final _email = TextEditingController(text: widget.email.trim());
  bool _busy = false;
  String? _error;
  String? _sent;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final email = _email.text.trim();
    if (email.isEmpty) return setState(() => _error = ForgotWords.needEmail);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final answer = await ref.read(peopleClientProvider).post('/api/auth/forgot-password', {'email': email});
      final message = answer is Map && answer['message'] is String ? answer['message'] as String : null;
      if (mounted) setState(() => _sent = message ?? ForgotWords.intro);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = ForgotWords.failed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    if (_sent != null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Notice(text: _sent!, ok: true),
          const SizedBox(height: 12),
          Text(ForgotWords.spam, style: text.bodySmall),
          const SizedBox(height: 18),
          SizedBox(
            height: Tokens.buttonHeight,
            child: FilledButton(onPressed: () => Navigator.of(context).pop(), child: const Text(ForgotWords.done)),
          ),
        ],
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _email,
          enabled: !_busy,
          autofocus: widget.email.trim().isEmpty,
          keyboardType: TextInputType.emailAddress,
          textInputAction: TextInputAction.send,
          autofillHints: const [AutofillHints.email, AutofillHints.username],
          onSubmitted: (_) => _send(),
          decoration: const InputDecoration(labelText: ForgotWords.email, prefixIcon: Icon(CupertinoIcons.mail, size: 20)),
        ),
        if (_error != null) ...[const SizedBox(height: 12), Notice(text: _error!, ok: false)],
        const SizedBox(height: 18),
        SizedBox(
          height: Tokens.buttonHeight,
          child: FilledButton(onPressed: _busy ? null : _send, child: Text(_busy ? ForgotWords.sending : ForgotWords.send)),
        ),
      ],
    );
  }
}
