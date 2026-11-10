/// The frame's words (the header, the tab bar, the More menu, the notifications), in one place (ready for Arabic).
abstract final class ShellWords {
  static const dashboard = 'Dashboard';
  static const requests = 'Requests';
  static const attendance = 'Attendance';
  static const profile = 'Profile';
  static const more = 'More';
  static const toDark = 'Dark look';
  static const toLight = 'Light look';
  static const notifications = 'Notifications';
  static const account = 'Your account';
  static const viewProfile = 'View profile';
  static const changePhoto = 'Change profile image';
  static const assets = 'My assets';
  static const password = 'Password & security';
  static const devices = 'Devices & sign-ins';
  static const hiring = 'Hiring availability';
  static const signOut = 'Sign out';
  static const markAllRead = 'Mark all as read';
  // a notification that came while the app is open (8 November 2026)
  static const open = 'Open';
  // one the app has no screen for: its page on the website, in the phone's browser (10 November 2026)
  static const onWebsite = 'Opens on the website';
  static const noNotifications = 'Nothing new.';
  static const notificationsFailed = 'Couldn’t load your notifications.';
  static const offerNo = 'Not now';
  static String unread(int n) => n == 1 ? '1 unread notification' : '$n unread notifications';
}
