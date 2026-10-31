import 'package:flutter/material.dart';

import '../kpis/kpi_words.dart';
import '../kpis/my_kpis_screen.dart';

/// My performance (the Dashboard's quick action, the Profile's KPIs): since 31 October 2026 (owner: "employees and
/// managers can perform the KPI's from the mobile app") the KPI screens in lib/features/kpis, where the employee rates
/// themself and signs, and a manager scores their people's. Kept under its name for the routes that open it.
class PerformanceScreen extends StatelessWidget {
  const PerformanceScreen({super.key});

  static const title = KpiWords.myTitle;
  static const intro = KpiWords.myIntro;
  static const none = KpiWords.noneText;
  static const failed = KpiWords.notLoaded;

  @override
  Widget build(BuildContext context) => const MyKpisScreen();
}
