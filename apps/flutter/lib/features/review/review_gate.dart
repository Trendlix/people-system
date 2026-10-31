import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/auth_controller.dart';
import '../dashboard/dashboard_data.dart';
import 'review_screen.dart';

// The review at sign-in (owner, 31 October 2026: "make the data review obligatory upon the signin for employees"): in the
// signed-in frame, while an employee's details wait for their review (never confirmed, or changed by HR since, and no
// change they asked for waiting: OwnProfile.mustReview), only Review your details shows, with Sign out; the frame comes
// back once People says they confirmed or asked for a change. Read again when the app comes back to the front, so a
// change HR made meanwhile asks for the review again. Only a screen: People answers the app as before (an older build
// must still check in), and a profile that can't be read holds nobody back.

class ReviewGate extends ConsumerStatefulWidget {
  const ReviewGate({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<ReviewGate> createState() => _ReviewGateState();
}

class _ReviewGateState extends ConsumerState<ReviewGate> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) ref.invalidate(ownProfileProvider);
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider).value;
    if (auth is! SignedIn || auth.me.employeeId == null) return widget.child;
    final read = ref.watch(ownProfileProvider);
    // the first read, before anything shows: a wait, so the frame doesn't flash before the review
    if (read.isLoading && !read.hasValue && !read.hasError) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final profile = read.value;
    return profile != null && profile.mustReview ? const ReviewScreen() : widget.child;
  }
}
