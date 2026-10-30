import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'features/connection/connection_screen.dart';
import 'theme/app_theme.dart';

/// The app's screens and their addresses (Phase 0: the connection check; Phase 1 adds sign-in and Home).
final router = GoRouter(routes: [GoRoute(path: '/', builder: (context, state) => const ConnectionScreen())]);

class PeopleApp extends StatelessWidget {
  const PeopleApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(title: 'Trendlix People', theme: appTheme(), routerConfig: router, debugShowCheckedModeBanner: false);
  }
}
