import '../../models/timesheet.dart';
import '../requests/request_text.dart' show dmy, hoursShort;

/// The timesheet's words (owner, 4 November 2026), in one place (ready for Arabic).
abstract final class TimesheetWords {
  static const eyebrow = 'Hours';
  static const title = 'My timesheet';
  static const menu = 'My timesheet';
  static const logHours = 'Log hours';
  static const logHoursLine = 'You log your hours on your timesheet: each day’s hours against a client or a task.';
  static String week(String start, String end) => '${dmy(start)} to ${dmy(end)}';
  static const previousWeek = 'Previous week';
  static const nextWeek = 'Next week';
  static const thisWeek = 'This week';
  static String total(double hours) => hoursShort(hours);
  static const addLine = 'Add hours';
  static const noLines = 'Nothing logged.';
  static const save = 'Save';
  static const saved = 'Saved.';
  static const send = 'Send for approval';
  static const sent = 'Sent for approval.';
  static const sending = 'Sending…';
  static const saving = 'Saving…';
  static String approvedBy(String? who) => who == null ? 'Approved.' : 'Approved by $who.';
  static String waitingFor(String? who) => who == null ? 'Waiting for HR’s approval.' : 'Waiting for $who’s approval.';
  static String rejected(String? why) => why == null ? 'Rejected: correct it and send it again.' : 'Rejected: $why. Correct it and send it again.';
  static String unsent(List<String> weeks) =>
      weeks.length == 1 ? 'The week of ${dmy(weeks.first)} isn’t sent yet.' : '${weeks.length} earlier weeks aren’t sent yet, the latest from ${dmy(weeks.first)}.';
  static const openIt = 'Open it';
  static const status = {
    TimesheetStatus.draft: 'Not sent yet',
    TimesheetStatus.submitted: 'Waiting for approval',
    TimesheetStatus.approved: 'Approved',
    TimesheetStatus.rejected: 'Rejected',
  };
  static const notLoaded = 'Your timesheet couldn’t be loaded.';
  static const tryAgain = 'Try again';
  static const unsaved = 'Changes not saved yet.';

  // the line's sheet
  static const newLine = 'Hours';
  static const editLine = 'Change the hours';
  static const day = 'Day';
  static const client = 'Client';
  static const noClient = 'No client';
  static const pickClient = 'Choose the client';
  static const yours = 'Yours';
  static const task = 'Task';
  static const taskHint = 'E.g. Editing the launch video';
  static const hours = 'Hours';
  static const hoursHint = 'E.g. 1.5 or 7.75';
  static const note = 'Note';
  static const keep = 'Keep';
  static const remove = 'Remove';
  static const clientOrTask = 'Choose the client, or write the task.';
  static const hoursRule = 'Enter the hours from 0.25 to 24, in quarter hours, e.g. 1.5 or 7.75.';
  static String dayFull(String date) => '${dmy(date)} would have more than 24 hours.';
  static const futureDay = 'That day hasn’t come yet: log hours once they are worked.';

  // approving
  static String weekOf(String name) => '$name’s hours';
  static const lines = 'Lines';
}
