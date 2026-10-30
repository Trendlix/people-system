import 'package:flutter/material.dart';

import '../../shell/app_shell.dart';
import '../../theme/parts.dart';

/// The Attendance tab (the phone design, 30 October 2026). Its screens come in this build's next step.
class AttendanceTab extends StatelessWidget {
  const AttendanceTab({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: tabPagePadding(context),
      children: const [PageHead(eyebrow: 'People System · Attendance', title: 'My Attendance')],
    );
  }
}
