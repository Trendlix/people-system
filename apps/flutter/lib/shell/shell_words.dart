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
  static const noNotifications = 'Nothing new. Decisions on your requests and things waiting for you show here.';
  static const notificationsFailed = 'Couldn’t load your notifications.';
  static const offerTitle = 'Sign in with your fingerprint?';
  static const offerBody = 'Next time, open the app and touch the sensor: no password.';
  static const offerYes = 'Use fingerprint';
  static const offerNo = 'Not now';
  static const fingerprintOn = 'Fingerprint sign-in is on.';
  static String unread(int n) => n == 1 ? '1 unread notification' : '$n unread notifications';
}
