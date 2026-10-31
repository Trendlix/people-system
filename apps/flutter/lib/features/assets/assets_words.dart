import '../../format.dart';

// My Assets' words, in one place (ready for Arabic), and how a return date, a record's items and a file's size read: as
// the website's My Custody says them (apps/web assets/custody.ts dueText, outText, itemsText, sizeText).

abstract final class AssetsWords {
  static const eyebrow = 'Account · Assets';
  static const title = 'My Assets';
  static const intro = 'What the company has handed to you, since when and until when. Each handover and return is recorded by the asset team.';
  static const custody = 'Custody';
  static const whatYouHold = 'What you hold';
  static const holdNothing = 'You hold no company assets.';
  static const history = 'History';
  static const records = 'Your custody records';
  static const noRecords = 'No custody records yet.';
  static const notSigned = 'Not signed';
  static const openOnWebsite = 'To open a signed form, use the People website.';
  static const notLoaded = 'Couldn’t load your assets.';
  static String serial(String s) => 'S/N $s';
  static String condition(String c) => 'Condition when handed over: $c';
  static String withIt(String s) => 'With it: $s';
  static String since(String day, String record) => 'Since $day · $record';
  static String outOn(String day) => 'Out $day';
  static String signedForm(String name, String size) => 'Signed form: $name · $size';
  static String countOf(int n) => n == 1 ? '1 item' : '$n items';
  static String overdue(int n) => n == 1
      ? 'One item is past its return date. Please return it, or speak to the person who handed it over.'
      : '$n items are past their return date. Please return them, or speak to the person who handed them over.';

  // the Profile's row and the More menu
  static const companyAssets = 'Company assets';
  static const assetsLine = 'What the company has handed to you';
  static String withYou(int n) => n == 0 ? 'Nothing with you now' : (n == 1 ? '1 item with you' : '$n items with you');
}

/// "1 day", "3 days".
String daysTextOf(int n) => n == 1 ? '1 day' : '$n days';

/// A return date in words: a shoot's "Return by 23 Oct 2026", overdue "Overdue 2 days (due 23 Oct 2026)", closed "Was
/// due 23 Oct 2026"; a long-term assignment "Long term: back at clearance".
String dueTextOf({required String kind, String? status, String? dueDate, required bool overdue, required int daysOverdue}) {
  if (kind != 'shoot' || dueDate == null) return 'Long term: back at clearance';
  final due = shortDateOf(dueDate);
  if (overdue) return 'Overdue ${daysTextOf(daysOverdue)} (due $due)';
  if (status == 'closed') return 'Was due $due';
  return 'Return by $due';
}

/// How many are still out: "3 out", "1 of 3 out", "All 3 back", "Back".
String outTextOf(int items, int out) {
  if (out == 0) return items == 1 ? 'Back' : 'All $items back';
  return out == items ? '$items out' : '$out of $items out';
}

/// A file's size: "120 KB", "1.4 MB".
String sizeTextOf(int bytes) {
  if (bytes < 1024 * 1024) return '${(bytes / 1024).round().clamp(1, 1023)} KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}
