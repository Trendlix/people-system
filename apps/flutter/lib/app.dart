import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'api/people_client.dart';
import 'auth/auth_controller.dart';
import 'features/home/home_screen.dart';
import 'features/sign_in/sign_in_screen.dart';
import 'theme/app_theme.dart';
import 'theme/tokens.dart';

/// The app's screens and their addresses. Phase 1: one, which shows sign-in or Home as the session stands; the
/// request and approval screens (Phases 2 and 3) get their own.
final router = GoRouter(routes: [GoRoute(path: '/', builder: (context, state) => const AuthGate())]);

class PeopleApp extends StatelessWidget {
  const PeopleApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(title: 'Trendlix People', theme: appTheme(), routerConfig: router, debugShowCheckedModeBanner: false);
  }
}

/// Sign-in or Home, as the session stands; while the kept session is checked, a wait; People unreachable, Try again.
class AuthGate extends ConsumerWidget {
  const AuthGate({super.key});

  static const tryAgain = 'Try again';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authProvider);
    return switch (auth) {
      AsyncData(value: SignedIn(:final me)) => HomeScreen(key: ValueKey(me.id), me: me),
      AsyncData(value: final SignedOut s) => SignInScreen(key: ValueKey(s), state: s),
      AsyncError(:final error) => _Unreachable(message: error is ApiException ? error.message : PeopleClient.unreachableText),
      _ => const Scaffold(body: Center(child: CircularProgressIndicator())),
    };
  }
}

class _Unreachable extends ConsumerWidget {
  const _Unreachable({required this.message});

  final String message;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: Tokens.pagePadding,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Icon(Icons.cloud_off_rounded, size: 48, color: Tokens.muted),
              const SizedBox(height: Tokens.gap),
              Text(message, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium?.copyWith(color: Tokens.ink)),
              const SizedBox(height: Tokens.gap * 1.5),
              FilledButton(onPressed: () => ref.invalidate(authProvider), child: const Text(AuthGate.tryAgain)),
            ],
          ),
        ),
      ),
    );
  }
}
