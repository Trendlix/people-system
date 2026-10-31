import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/custody.dart';
import '../../providers.dart';

/// What they hold of the company's assets and their custody records (GET /api/me/custody): anyone's own, read only.
final myCustodyProvider = FutureProvider.autoDispose<MyCustody>(
  (ref) async => MyCustody.fromJson(await ref.read(peopleClientProvider).get('/api/me/custody')),
);
