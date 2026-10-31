import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../auth/auth_controller.dart';
import '../../providers.dart';
import '../../theme/parts.dart';
import '../../theme/tokens.dart';

/// Signing in with a code by email's words, as the website says them (apps/web/src/app/login/code).
abstract final class EmailCodeWords {
  static const link = 'Email me a sign-in code';
  static const eyebrow = 'Trendlix People';
  static const title = 'Sign in with a code';
  static const intro = 'Type the email you sign in with. If it has an account, we email it a 6-digit code to sign in with.';
  static const email = 'Work email';
  static const send = 'Email me a code';
  static const sending = 'Sending…';
  static const needEmail = 'Enter your sign-in email.';
  static const code = 'Code from the email';
  static String sentTo(String email) => 'Sent to $email. Nothing after a few minutes? Check your spam folder.';
  static const signIn = 'Sign in';
  static const signingIn = 'Signing in…';
  static const needCode = 'Enter the 6-digit code from the email.';
  static String resend(int seconds) =>
      seconds <= 0 ? 'Send a new code' : 'Send a new code in ${seconds ~/ 60}:${(seconds % 60).toString().padLeft(2, '0')}';
  static const otherEmail = 'Use another email';
  static const failed = 'Couldn’t reach People. Check your connection and try again.';
}

/// How soon a new code may be asked for after the last (People's LOGIN_CODE_RESEND_SECONDS).
const resendSeconds = 60;

/// A code as typed: spaces and dashes out, Arabic-Indic (and Persian) digits as 0-9; null unless it is 6 digits
/// (packages/shared loginCodeOf).
String? codeOf(String typed) {
  final latin = typed
      .replaceAllMapped(RegExp('[٠-٩]'), (m) => '${m[0]!.codeUnitAt(0) - 0x0660}')
      .replaceAllMapped(RegExp('[۰-۹]'), (m) => '${m[0]!.codeUnitAt(0) - 0x06f0}')
      .replaceAll(RegExp(r'[\s-]'), '');
  return RegExp(r'^\d{6}$').hasMatch(latin) ? latin : null;
}

/// Seconds until a new code may be asked for (0: now).
int resendIn(DateTime? sentAt, DateTime now) {
  if (sentAt == null) return 0;
  final left = resendSeconds * 1000 - now.difference(sentAt).inMilliseconds;
  return left <= 0 ? 0 : (left / 1000).ceil();
}

/// Signing in with a code by email (owner, 31 October 2026: "and i can add OTP via Mail for app login if the user didn't
/// remember his password", "via app and web"): the email, then the 6 digits People emailed to it, traded for a session as
/// the password is (the fingerprint offered after it the same).
Future<void> showEmailCode(BuildContext context, {String email = ''}) => showDesignSheet<void>(
  context,
  eyebrow: EmailCodeWords.eyebrow,
  title: EmailCodeWords.title,
  icon: CupertinoIcons.envelope_badge,
  intro: EmailCodeWords.intro,
  builder: (_) => EmailCodeForm(email: email),
);

class EmailCodeForm extends ConsumerStatefulWidget {
  const EmailCodeForm({super.key, this.email = ''});

  final String email;

  @override
  ConsumerState<EmailCodeForm> createState() => _EmailCodeFormState();
}

class _EmailCodeFormState extends ConsumerState<EmailCodeForm> {
  late final _email = TextEditingController(text: widget.email.trim());
  final _code = TextEditingController();
  Timer? _tick;
  DateTime? _sentAt;
  String? _message;
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _tick?.cancel();
    _email.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _ask() async {
    final email = _email.text.trim();
    if (email.isEmpty) return setState(() => _error = EmailCodeWords.needEmail);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final answer = await ref.read(peopleClientProvider).post('/api/auth/email-code', {'email': email});
      if (!mounted) return;
      setState(() {
        _message = answer is Map && answer['message'] is String ? answer['message'] as String : EmailCodeWords.intro;
        _sentAt = DateTime.now();
        _code.clear();
      });
      // the countdown to "Send a new code"
      _tick?.cancel();
      _tick = Timer.periodic(const Duration(seconds: 1), (t) {
        if (!mounted) return t.cancel();
        setState(() {});
        if (resendIn(_sentAt, DateTime.now()) == 0) t.cancel();
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = EmailCodeWords.failed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _signIn() async {
    final code = codeOf(_code.text);
    if (code == null) return setState(() => _error = EmailCodeWords.needCode);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authProvider.notifier).signInWithCode(_email.text, code);
      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = EmailCodeWords.failed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final error = _error == null ? null : Notice(text: _error!, ok: false);
    if (_sentAt == null) {
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
            onSubmitted: (_) => _ask(),
            decoration: const InputDecoration(labelText: EmailCodeWords.email, prefixIcon: Icon(CupertinoIcons.mail, size: 20)),
          ),
          if (error != null) ...[const SizedBox(height: 12), error],
          const SizedBox(height: 18),
          SizedBox(
            height: Tokens.buttonHeight,
            child: FilledButton(onPressed: _busy ? null : _ask, child: Text(_busy ? EmailCodeWords.sending : EmailCodeWords.send)),
          ),
        ],
      );
    }
    final wait = resendIn(_sentAt, DateTime.now());
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Notice(text: _message!, ok: true),
        const SizedBox(height: 16),
        TextField(
          controller: _code,
          enabled: !_busy,
          autofocus: true,
          keyboardType: TextInputType.number,
          textInputAction: TextInputAction.done,
          autofillHints: const [AutofillHints.oneTimeCode],
          inputFormatters: [FilteringTextInputFormatter.allow(RegExp('[0-9٠-٩۰-۹ ]')), LengthLimitingTextInputFormatter(7)],
          textAlign: TextAlign.center,
          style: text.headlineSmall?.copyWith(letterSpacing: 6, fontFeatures: const [FontFeature.tabularFigures()]),
          onSubmitted: (_) => _signIn(),
          decoration: const InputDecoration(labelText: EmailCodeWords.code, hintText: '123456'),
        ),
        const SizedBox(height: 8),
        Text(EmailCodeWords.sentTo(_email.text.trim()), style: text.bodySmall),
        if (error != null) ...[const SizedBox(height: 12), error],
        const SizedBox(height: 18),
        SizedBox(
          height: Tokens.buttonHeight,
          child: FilledButton(onPressed: _busy ? null : _signIn, child: Text(_busy ? EmailCodeWords.signingIn : EmailCodeWords.signIn)),
        ),
        const SizedBox(height: 10),
        SizedBox(
          height: Tokens.tapTarget,
          child: OutlinedButton(onPressed: _busy || wait > 0 ? null : _ask, child: Text(EmailCodeWords.resend(math.max(0, wait)))),
        ),
        TextButton(
          onPressed: _busy
              ? null
              : () => setState(() {
                  _tick?.cancel();
                  _sentAt = null;
                  _message = null;
                  _error = null;
                }),
          child: const Text(EmailCodeWords.otherEmail),
        ),
      ],
    );
  }
}
