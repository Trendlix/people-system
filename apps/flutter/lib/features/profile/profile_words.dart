// The Profile tab's and the account screens' words, in one place (ready for Arabic).

/// The Profile tab.
abstract final class ProfileWords {
  static const pageEyebrow = 'People System · Profile';
  static const pageTitle = 'My Profile';
  static const employeeProfile = 'Employee profile';
  static const profileComplete = 'Profile complete';
  static const allUpToDate = 'All required HR information is up to date.';
  static const confirmOnWebsite = 'Please review and confirm your details on the People website.';
  static const changePhoto = 'Profile photo';
  static String missingOf(List<String> labels) {
    if (labels.isEmpty) return allUpToDate;
    final shown = labels.take(2).join(', ');
    final more = labels.length - 2;
    return 'Still missing: $shown${more > 0 ? ' and $more more' : ''}.';
  }

  static String completeLabel(int percent) => '$percent percent of your profile is complete';

  // the four tiles
  static const manager = 'Manager';
  static const workLocation = 'Work location';
  static const joined = 'Joined';
  static const employment = 'Employment';
  static const none = 'None on file';

  // the switch
  static const personal = 'Personal';
  static const contact = 'Contact';
  static const kpis = 'KPIs';
  static const sections = 'Profile sections';

  // the details
  static const personalInformation = 'Personal information';
  static const personalDetails = 'Personal details';
  static const personalIntro = 'HR keeps your file. If something is wrong or missing, ask HR to change it.';
  static const education = 'Education';
  static const contactInformation = 'Contact information';
  static const contactDetails = 'Contact details';
  static const contactIntro = 'How HR reaches you, and who to call in an emergency.';
  static const workEmail = 'Work email';
  static const workEmailNote = 'Set by the company with your sign-in. Ask HR to change it.';
  static const emergencyContact = 'Emergency contact';
  static const askToChange = 'Ask to change my details';
  static const notOnFile = 'Not on file';
  static String waitingSince(String day) => 'Your request of $day is waiting for HR. You can send another once HR has decided, or cancel it.';
  static const cancelRequest = 'Cancel request';
  static const cancelAsk = 'Cancel this change request? HR will no longer be asked to decide on it.';
  static const keepIt = 'Keep it';
  static const cancelled = 'Your request was cancelled.';
  static String lastDecision(String status, String day) => 'Your request of $day: $status.';
  static const hrNote = 'HR’s note';

  // employment
  static const yourJob = 'Your job';
  static const employmentIntro = 'Your job as HR has it. HR changes it.';
  static const jobTitle = 'Job title';
  static const department = 'Department';
  static const team = 'Team';
  static const grade = 'Grade';
  static const status = 'Status';
  static const employmentType = 'Employment type';
  static const probationEnds = 'Probation ends';
  static const workArrangement = 'Work arrangement';
  static const shift = 'Shift';
  static const contract = 'Contract';
  static const noJob = 'You have no current employment on file.';
  static String officeDays(String days) => 'In the office on $days';
  static String contractLine(String form, String? until) => until == null ? form : '$form, until $until';

  // KPIs (owner, 31 October 2026: "replace payslips with the KPI's")
  static const performance = 'Performance';
  static const kpisTitle = 'Your KPIs';
  static const kpisIntro = 'Your monthly scorecards, newest first. You rate and sign them on the People website.';
  static const noKpis =
      'No scorecards yet. A month’s scorecard opens on the 1st of the next month once HR has published the template for your job title.';
  static const openPerformance = 'Open My performance';
  static String allScorecards(int n) => 'See all $n scorecards';

  // documents
  static const hrRecords = 'HR records';
  static const documents = 'Documents';
  static const employmentContract = 'Employment contract';
  static String signedOn(String day) => 'Signed · $day';
  static const signed = 'Signed';
  static const noContract = 'No signed contract on file yet';
  static const neededByHr = 'Needed by HR: bring it to HR, who add it to your file';
  static const employeeFile = 'Employee file';
  static const fileComplete = 'Every paper HR needs is on file';

  // the account
  static const account = 'Account';
  static const securityAndPreferences = 'Security & preferences';
  static const photoLine = 'How your employee image is set';
  static const changePassword = 'Change password';
  static const passwordLine = 'Password and sign-in security';
  static const sessions = 'Sessions';
  static const sessionsLine = 'Review signed-in devices';
  static const interviewHours = 'Interview hours';
  static const interviewLine = 'Manage hiring availability';

  static const noProfile = 'Your account has no employee profile, so there is nothing to show here. Your account’s settings are below.';
  static const notLoaded = 'Couldn’t load your profile.';
  static const tryAgain = 'Try again';
}

/// The sheet that asks HR to change one's details (the website's Request a Change).
abstract final class ChangeWords {
  static const eyebrow = 'Your details';
  static const title = 'Ask HR to change them';
  static const intro = 'Correct what is wrong or missing. Only what you change is sent, and nothing changes on your profile until HR approves it.';
  static const note = 'What should change and why';
  static const noteHint = 'You can give HR any proof by hand.';
  static const send = 'Send to HR';
  static const sending = 'Sending…';
  static const nothingChanged = 'Change at least one detail first.';
  static const sent = 'Your request was sent to HR. You’ll see their decision on your profile.';
  static const choose = 'Choose';
  static const pickDate = 'Choose a date';
  static const clear = 'Clear';
}

/// The account's screens.
abstract final class AccountWords {
  static const securityEyebrow = 'Account · Security';
  static const profileEyebrow = 'Account · Profile';
  static const availabilityEyebrow = 'Account · Availability';
  static const notLoaded = 'Couldn’t load this.';
  static const tryAgain = 'Try again';

  // change password
  static const passwordTitle = 'Change Password';
  static const passwordIntro = 'If an admin gave you a temporary password, replace it here with one only you know.';
  static const current = 'Current password';
  static const fresh = 'New password';
  static const confirm = 'Confirm new password';
  static const rule = 'At least 10 characters, and different from your current password. A short sentence is easy to remember.';
  static const changePassword = 'Change password';
  static const changing = 'Changing…';
  static const show = 'Show password';
  static const hide = 'Hide password';
  static const noMatch = 'The new password and its confirmation do not match.';
  static const changed = 'Your password has been changed. Your other sessions were signed out and fingerprint sign-in was turned off on your phones.';
  static String lengthOf(int n) => '$n of 10 characters';
  static const guidance = 'Password guidance';
  static const guidanceTitle = 'Make it memorable, not predictable.';
  static const tips = [
    'Use a short sentence or several unrelated words.',
    'Don’t reuse your company or personal passwords.',
    'Changing it signs out your other sessions and turns off fingerprint sign-in on your phones.',
  ];

  // profile image
  static const photoTitle = 'Profile Image';
  static const photoIntro = 'A clear photo helps teammates recognise you across the People System.';
  static const photoSetByHr = 'Your photo is set by HR';
  static const photoHow = 'Your picture comes from the personal photo in your employee file, which only HR adds and crops. To change it, give HR a new photo.';
  static const goodPhoto = 'A good profile photo';
  static const photoTips = [
    'Use a recent photo with your face clearly visible.',
    'Choose a simple background with good lighting.',
    'Avoid logos, group photos and screenshots.',
  ];

  // sessions
  static const sessionsTitle = 'Your Sessions';
  static const sessionsIntro = 'You can be signed in once on the website and once in the app. Sign out of anything you don’t recognise.';
  static String activeOf(int n) => n == 1 ? 'active\nsession' : 'active\nsessions';
  static String activeLabel(int n) => n == 1 ? '1 active session' : '$n active sessions';
  static const sessionHealth = 'Session health';
  static const onlyThisDevice = 'Only this phone is signed in.';
  static const checkTheOthers = 'Check the others below are yours.';
  static const healthLine = 'Signing in on another device signs the older one out. Changing your password also closes your other sessions.';
  static const signedInDevices = 'Signed in devices';
  static const thisDevice = 'This device';
  static String signedIn(String at, String last) => 'Signed in $at · Last active $last';
  static const signOut = 'Sign out';
  static const signingOut = 'Signing out…';
  static const signOutHere = 'Sign out of this phone? You’ll need to sign in again.';
  static const cancel = 'Cancel';
  static const noSessions = 'You have no other sessions open.';
  static const mobileSecurity = 'Mobile security';
  static const fingerprintTitle = 'Fingerprint Sign-In';
  static String fingerprintLine(int days) =>
      'Fingerprint sign-in is turned on in the Trendlix People app after signing in there with your password. A phone stops signing in with it after $days days without use, and every phone does when your password changes.';
  static const noPhone = 'No phone signs in with a fingerprint.';
  static const thisPhone = 'This phone';
  static String added(String day, String? used) => used == null ? 'Added $day · Never used' : 'Added $day · Last used $used';
  static const turnOn = 'Turn on for this phone';
  static const turningOn = 'Turning on…';
  static const turnedOn = 'Fingerprint sign-in is on. Next time, sign in with your fingerprint.';
  static const phoneSignedOut = 'That phone no longer signs in with a fingerprint.';

  // interview hours
  static const hoursTitle = 'Your Interview Hours';
  static const hoursIntro =
      'Set the weekly hours you can interview in. HR sees these alongside your leave, holidays, other interviews and your calendar’s busy times.';
  static const needsHours = 'Set your interview hours so HR can book you.';
  static const weeklySchedule = 'Weekly schedule';
  static const weeklyHours = 'Weekly Hours';
  static String activeDays(int n) => n == 1 ? '1 active day' : '$n active days';
  static String inEffect(String rules) => 'In effect: $rules.';
  static String noneYet(String rules) => 'None set yet. The company asks for $rules.';
  static const noInterviews = 'No interviews.';
  static const addRange = 'Add a range';
  static String addRangeOn(String day) => 'Add a range on $day';
  static String removeRange(String day, String range) => 'Remove $day, $range';
  static const from = 'From';
  static const to = 'To';
  static const add = 'Add';
  static const countsFrom = 'Counts from';
  static const countsFromHint = 'The weekly hours apply from this day on.';
  static const minimumNotice = 'Minimum notice';
  static const noticeHint = 'How far ahead you must be booked. Only longer than the company’s.';
  static const buffer = 'Buffer between interviews';
  static const bufferHint = 'Kept free before and after each interview.';
  static const oneOff = 'One-off changes';
  static const oneOffHint = 'A day off from interviews, or extra hours on a date. Past ones go by themselves.';
  static const addDayOff = 'Add a day off';
  static const addExtra = 'Add extra hours';
  static const dayOff = 'Day off from interviews';
  static const extraHours = 'Extra hours';
  static const date = 'Date';
  static const remove = 'Remove';
  static const save = 'Save interview hours';
  static const saving = 'Saving…';
  static const saved = 'Saved. HR sees you free in these hours, less your leave, interviews and busy calendar.';
  static const cleared = 'Saved: you have no interview hours now.';
  static String lastSaved(String at, String? by) => by == null ? 'Last saved $at.' : 'Last saved $at by $by.';
  static const yourCalendar = 'Your calendar';
  static String companyReads(String calendar) => 'Your $calendar is read for you.';
  static String companyReadsLine(String? email) =>
      'Its busy times are read through the company’s connection, by your work email${email == null ? '' : ' ($email)'}: there is nothing to connect. Only when you’re busy is read, never what your events are.';
  static String connected(String calendar) => 'Your $calendar is connected.';
  static String connectedAs(String account) => 'Connected as $account. Only when you’re busy is read, never what your events are.';
  static String needsReconnecting(String calendar) => 'Your $calendar needs connecting again.';
  static const reconnectOnWebsite = 'Connect it again on the People website, under Account → Interview Hours.';
  static const noCalendar = 'No calendar is connected.';
  static const noCalendarLine =
      'Connect one on the People website, under Account → Interview Hours. Your leave, holidays and booked interviews are taken away all the same.';
  static const calendarNotLoaded = 'Your calendar connections couldn’t be loaded.';
  static const comingUp = 'Coming up';
  static const upcoming = 'Your Upcoming Interviews';
  static const noUpcoming = 'No interviews to come.';
  static String interviewLine(String at, int minutes, String kind) => '$at · $minutes minutes · $kind';
}
