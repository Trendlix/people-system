import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'providers.dart';

// Trendlix People, the employee app in Flutter (owner, 30 October 2026: "lets start in the flutter one"). The plan and
// every decision: README.md beside this folder.
void main() {
  // the design's font is under the SIL Open Font License, which asks for its notice to travel with it
  LicenseRegistry.addLicense(() async* {
    yield LicenseEntryWithLineBreaks(const ['Instrument Sans'], await rootBundle.loadString('assets/fonts/OFL.txt'));
  });
  runApp(const ProviderScope(retry: noRetry, child: PeopleApp()));
}
