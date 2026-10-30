import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'providers.dart';

// Trendlix People, the employee app in Flutter (owner, 30 October 2026: "lets start in the flutter one"). The plan and
// every decision: README.md beside this folder.
void main() => runApp(const ProviderScope(retry: noRetry, child: PeopleApp()));
