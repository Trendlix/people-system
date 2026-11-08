import 'package:flutter/widgets.dart';

import 'tokens.dart';

// iPads and other wide screens (owner, 7 November 2026: "can the app be optimized for ipad screen?"): a page keeps to a
// column in the middle, at most Tokens.pageMaxWidth wide, while its list still scrolls from edge to edge (the room either
// side is the list's own margin); the tiles that sit two across on a phone go four across.
//
// Then their own layout (owner, 8 November 2026: "i think the Ipad needs a better layout with some more features
// available due to the larger screen"), decided by the window's size, never the device's, so an iPad in Split View or
// Slide Over, or with a small Stage Manager window, falls back to the phone's:
//
//   window width   | navigation                                              | the page beside it
//   ---------------|---------------------------------------------------------|----------------------------------------
//   under 720      | the phone's floating tab bar and More menu              | the phone's (in a 760 column)
//   720 to 1099    | the rail: every place an icon with a short word         | one column; from 840 of its own width,
//   1100 and up    | the sidebar: the places in full, who is signed in       | Requests and Attendance in two panes;
//                  |                                                         | from 700, Dashboard and Profile in two
//                  |                                                         | columns
//
// and a window under 600 tall (a phone on its side) always the phone's. In points: an iPad mini upright is 744 wide, an
// 11" 820 to 834, a 13" 1024 to 1032; on their side 1133 to 1376. Half a Split View is 585 to 678, two thirds 760 to 981.
// The rail and the sidebar list the four tabs and what the More menu holds, so each is one tap away.

/// [base] with its side margins grown so what it holds is at most [max] wide (margins included), centred.
EdgeInsets centredPadding(BuildContext context, EdgeInsets base, {double max = Tokens.pageMaxWidth}) {
  final extra = (MediaQuery.sizeOf(context).width - max) / 2;
  return extra <= 0 ? base : base.copyWith(left: base.left + extra, right: base.right + extra);
}

/// Whether a box this wide shows four tiles across (an iPad) rather than two (a phone).
bool isWide(double width) => width >= Tokens.wideFrom;

/// How the app finds its way round in a window: the phone's tab bar, the rail, or the sidebar.
enum NavLayout { phone, rail, sidebar }

/// The navigation a window this size shows (the table above).
NavLayout navLayoutOf(Size window) {
  if (window.width < Tokens.railFrom || window.height < Tokens.wideMinHeight) return NavLayout.phone;
  return window.width < Tokens.sidebarFrom ? NavLayout.rail : NavLayout.sidebar;
}

/// The frame's navigation, for the pages under it: the phone's when there is none (the frame only says so on a wide
/// window, so a phone's pages are as they were).
class NavScope extends InheritedWidget {
  const NavScope({super.key, required this.layout, required super.child});

  final NavLayout layout;

  static NavLayout of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<NavScope>()?.layout ?? NavLayout.phone;

  @override
  bool updateShouldNotify(NavScope old) => old.layout != layout;
}

/// Whether the floating tab bar is over the page's foot (the phone's layout), so the page leaves room for it.
bool hasTabBar(BuildContext context) => NavScope.of(context) == NavLayout.phone;

/// Whether a page this wide, beside the rail or the sidebar, has room for two side by side: a list and what is open in
/// it ([Tokens.twoPanesFrom]), or two columns of cards ([Tokens.twoColumnsFrom]). Never with the phone's tab bar, so a
/// phone on its side keeps its one column.
bool roomForTwo(BuildContext context, double width, {double from = Tokens.twoPanesFrom}) => !hasTabBar(context) && width >= from;

/// [isWide], and beside the rail or the sidebar also from [Tokens.wideBesideNavFrom]: an iPad mini upright, its page
/// 616 inside its margins beside the rail, keeps its tiles four across as on 7 November (the phone's layout, a phone on
/// its side among them, keeps [isWide] alone).
bool isWideIn(BuildContext context, double width) => isWide(width) || (!hasTabBar(context) && width >= Tokens.wideBesideNavFrom);

/// The list's width beside what is open in it, of a page this wide.
double listPaneWidth(double width) => (width * 0.42).clamp(Tokens.listPaneMin, Tokens.listPaneMax);

/// A pane's padding beside another (no tab bar under it, no column in the middle: the pane is its own width).
EdgeInsets panePadding(BuildContext context, {double top = 16}) =>
    Tokens.pagePadding.copyWith(top: top, bottom: Tokens.pagePadding.bottom + MediaQuery.paddingOf(context).bottom);
