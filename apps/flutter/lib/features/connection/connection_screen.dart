import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/people_client.dart';
import '../../providers.dart';
import '../../theme/tokens.dart';

/// Phase 0's screen (README §3): whether the app reaches People through its private authority, the proof on a phone
/// that the connection works before sign-in is built on it.
final connectionCheckProvider = FutureProvider.autoDispose<void>((ref) async {
  final body = await ref.watch(peopleClientProvider).get('/api/health');
  if (body is! Map || body['status'] != 'ok') throw ApiException(200, const ['People answered, but not as expected.']);
});

class ConnectionScreen extends ConsumerWidget {
  const ConnectionScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final check = ref.watch(connectionCheckProvider);
    final text = Theme.of(context).textTheme;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: Tokens.pagePadding,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Trendlix People', style: text.headlineMedium?.copyWith(fontWeight: FontWeight.w700, color: Tokens.ink), textAlign: TextAlign.center),
              const SizedBox(height: Tokens.gap * 2),
              check.when(
                loading: () => const _Status(icon: null, text: 'Connecting to People…', colour: Tokens.muted),
                data: (_) => const _Status(icon: Icons.check_circle_rounded, text: 'Connected to People', colour: Tokens.ok),
                error: (e, _) => Column(
                  children: [
                    _Status(icon: Icons.error_outline_rounded, text: e is ApiException ? e.message : PeopleClient.unreachableText, colour: Tokens.danger),
                    const SizedBox(height: Tokens.gap),
                    FilledButton(onPressed: () => ref.invalidate(connectionCheckProvider), child: const Text('Try again')),
                  ],
                ),
              ),
              const SizedBox(height: Tokens.gap * 2),
              Text('Sign-in comes in the next version.', style: text.bodyMedium?.copyWith(color: Tokens.muted), textAlign: TextAlign.center),
            ],
          ),
        ),
      ),
    );
  }
}

class _Status extends StatelessWidget {
  const _Status({required this.icon, required this.text, required this.colour});

  final IconData? icon;
  final String text;
  final Color colour;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (icon == null)
          const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2.5))
        else
          Icon(icon, color: colour, size: 24),
        const SizedBox(width: Tokens.gapSmall),
        Flexible(child: Text(text, style: Theme.of(context).textTheme.titleMedium?.copyWith(color: colour, fontWeight: FontWeight.w600))),
      ],
    );
  }
}
