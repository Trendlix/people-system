/// The Requests tab's words, and what every kind of request says alike (where it stands, who decides, each step), in
/// one place, ready for Arabic. People's own words (packages/shared and apps/web, 30 October 2026) where it has them.
/// Each kind's form and page keep their own words beside them (kinds/*.dart).
abstract final class RequestsWords {
  // ---------- the page ----------
  static const eyebrow = 'People System · Requests';
  static const title = 'My Requests';
  static const intro = 'What you have asked for, newest first, with each decision as it is made.';
  static const createRequest = 'Create request';
  static const noProfile = 'Requests are for someone with an employee profile. Ask HR to add one for your sign-in.';
  static const notLoaded = 'Couldn’t load this. Pull down to try again.';
  static const balanceNotLoaded = 'Your leave balance couldn’t be loaded. Pull down to try again.';

  // ---------- the annual leave ----------
  static String annualOf(int year) => 'Annual leave · $year';
  static const available = 'Available';
  static String usableFromOf(String date) => 'Usable from $date';
  static String daysAvailable(double n) => n == 1 ? 'day\navailable' : 'days\navailable';
  static const remaining = 'remaining';
  static String ringLabel(String percent, int year) => '$percent of your $year annual leave is still available';
  static const entitlement = 'Entitlement';
  static const carriedIn = 'Carried in';
  static const adjusted = 'Adjusted by HR';
  static const taken = 'Taken';
  static const booked = 'Booked';
  static const waiting = 'Waiting';

  // ---------- the figures ----------
  static const requestsThisYear = 'Requests this year';
  static const noneAskedYet = 'None asked for yet';
  static const approvedOne = 'Approved';
  static const bothApproved = 'Both requests approved';
  static const allApproved = 'All approved';
  static String approvedCount(int n) => '$n approved';
  static String waitingCount(int n) => '$n waiting';
  static String closedCount(int n) => '$n closed';
  static const permissionLeft = 'Permission left';
  static const permission = 'Permission';
  static const permissionOffValue = 'Off';
  static const permissionOff = 'Permission is turned off: Leave Setup gives no permission hours a month.';
  static String ofHoursThisMonth(String clock) => 'of $clock hours this month';

  // ---------- recent requests ----------
  static const history = 'History';
  static const recentRequests = 'Recent requests';
  static const all = 'All';
  static const approved = 'Approved';
  static const emptyAll = 'You haven’t asked for anything yet. Start a request below.';
  static const emptyApproved = 'None of your requests is approved yet.';
  static const emptyWaiting = 'Nothing is waiting: every request you sent is decided.';
  static String showAll(int n) => 'Show all $n';
  static const showFewer = 'Show fewer';
  static String failedOf(List<String> kinds) => 'Some of your requests couldn’t be loaded (${kinds.join(', ')}). Pull down to try again.';
  static String rowLabel(String title, String when, String status) => '$title${when.isEmpty ? '' : ', $when'}, $status. Open.';

  // ---------- other leave ----------
  static const balances = 'Balances';
  static const otherLeave = 'Other leave';
  static String ofDaysLeftThisYear(String days, double n) => 'of $days ${n == 1 ? 'day' : 'days'} left this year';
  static String daysLeftThisYear(double n) => n == 1 ? 'day left this year' : 'days left this year';
  static String ofTimesLeftInService(int max) => 'of $max ${max == 1 ? 'time' : 'times'} left in service';
  static String daysUsedThisYear(double n) => n == 1 ? 'day used this year' : 'days used this year';

  // ---------- start another request ----------
  static const selfService = 'Self service';
  static const startAnother = 'Start another request';
  static const startIntro = 'Choose a request type and we’ll guide you through the details.';

  /// Each kind's card: its name, what it is for, and the way on (as My Requests on the website words them).
  static const startCards = {
    'permission': ('Permission', 'A few hours away from a working day, in half-hour blocks.', 'New permission'),
    'correction': ('Attendance correction', 'Correct a check-in or check-out that is missing or not right.', 'Ask for a correction'),
    'wfh': ('Work from home', 'A working day from home instead of the office.', 'Work from home'),
    'od': ('Official duty', 'Work for the company away from the office, e.g. at a client’s site.', 'Request official duty'),
    'compensatory': ('Compensatory days', 'A day off for a rest day or an official holiday you worked.', 'Compensatory day'),
    'home': ('Check-in locations', 'Ask for a place to check in from besides the office.', 'Request a check-in location'),
    'claim': ('Reimbursements', 'Claim back an expense you paid for the company.', 'New reimbursement'),
    'resignation': ('Resignation', 'Tell HR you wish to resign, and when you plan to leave.', 'Resign'),
  };

  // ---------- each kind, as a row of Recent requests ----------
  static const kindTitles = {
    'permission': 'Permission',
    'correction': 'Attendance correction',
    'wfh': 'Work from home',
    'od': 'Official duty',
    'compensatory': 'Compensatory day',
    'home': 'Check-in location',
    'claim': 'Reimbursement',
    'resignation': 'Resignation',
  };

  /// The kinds by name, for the line saying which couldn't be loaded.
  static const kindNames = {
    'leave': 'leave',
    'permission': 'permission',
    'correction': 'attendance corrections',
    'wfh': 'work from home',
    'od': 'official duty',
    'compensatory': 'compensatory days',
    'home': 'check-in locations',
    'claim': 'reimbursements',
    'resignation': 'resignation',
  };
  static String sentOn(String date) => 'Sent $date';
  static String recordedByHrOn(String date) => 'Recorded by HR $date';
  static String correctedByHrOn(String date) => 'Corrected by HR $date';
  static String lastDayOf(String date) => 'Last day $date';
  static String noticeOf(String notice) => '$notice${notice.endsWith('s') ? '’' : '’s'} notice';
  static const homeTypes = {'home': 'Home location', 'remote_site': 'Remote site', 'client': 'Client location'};
  static const pointDeleted = 'Point deleted';
  static const pointOnMap = 'Point on the map';

  // ---------- where a request stands ----------
  static const statusLabels = {
    'with_manager': 'With the manager',
    'with_hr': 'With HR',
    'with_finance': 'With Finance',
    'with_ceo': 'With the CEO',
    'approved': 'Approved',
    'rejected': 'Rejected',
    'cancelled': 'Cancelled',
    'withdrawn': 'Withdrawn',
    'replaced': 'Replaced',
    'removed': 'Removed',
    'sent': 'Sent',
    'recorded': 'Recorded',
    'returned': 'Returned',
  };
  static const withTheCeo = 'With the CEO';
  static const ended = 'Ended';
  static const approverLabels = {'direct_manager': 'Direct manager', 'team_lead': 'Team lead', 'department_head': 'Head of department'};
  static String hrStage(bool confidential) => confidential ? 'the CEO' : 'HR';
  static const atHrStage = 'at HR’s stage';
  static String withApprover(String phrase, String? name) => 'With $phrase${name == null ? '' : ' ($name)'}';
  static String waitingFor(String who) => 'Waiting for $who';
  static String rejectedBy(String who) => 'Rejected by $who';
  static const rejected = 'Rejected';
  static String cancelledBy(String who) => 'Cancelled by $who';
  static const cancelled = 'Cancelled';
  static const recordedByHr = 'Recorded by HR';

  // ---------- each step ----------
  static const stepSubmitted = 'Asked for by the employee';
  static const stepNoManager = 'No direct manager or lead: sent straight to HR';
  static const stepNoManagerCeo = 'No direct manager or lead: sent straight to HR’s stage';
  static const stepRecordedByHr = 'Recorded by HR, approved at once';
  static String stepApproved(String who) => '$who approved it';
  static String stepRejected(String who) => '$who rejected it';
  static const stepApprovedAtHr = 'Approved at HR’s stage';
  static const stepRejectedAtHr = 'Rejected at HR’s stage';
  static const stepCancelled = 'Cancelled';
  static const stepCoverChanged = 'Cover changed';
  static const stepEdited = 'Edited by a Super Admin';
  static const stepRestored = 'Restored by a Super Admin';
  static const stepImported = 'Imported, approved';
  static String standingIn(String name) => 'standing in for $name';

  /// Once sent: where it goes next.
  static String sentGoesTo(String first, String hr) => 'Request sent. It goes to $first, then $hr; each step shows on the request.';
  static String sentGoesToHr(String hr) => 'Request sent. It goes to $hr; each step shows on the request.';
  static const sentApprovedAtOnce = 'Recorded, approved at once.';

  // ---------- a request's page ----------
  static const back = 'Back';
  static const everyStep = 'Every step';
  static const noSteps = 'No steps logged yet.';
  static const whereItStands = 'Where it stands';
  static const theRequest = 'The request';
  static const recordedPast = 'Recorded past';
  static String noneSentStraightTo(String who) => 'None: sent straight to $who';
  static const recordedNoDecision = 'Recorded by HR: no decision needed';
  static const keepIt = 'Keep it';
  static const moved = 'This request has moved on since you opened it: someone else decided it, or it was cancelled. It shows where it stands now.';
  static const notYours = 'This request couldn’t be found, or isn’t yours to see.';
  static const filesKeptOnWebsite = 'Open them on the People website.';
  static String fileLine(String name, String kind, String size) => '$name · $kind · $size';
  static const pdf = 'PDF';
  static const photo = 'Photo';

  // ---------- the forms (each kind's sheet) ----------
  static const newRequest = 'New request';
  static const cancel = 'Cancel';
  static const send = 'Send request';
  static const sending = 'Sending…';
  static const beforeYouSend = 'Before you can send it:';
  static const peopleSaid = 'People couldn’t send it:';
  static const optional = '(optional)';
  static const chooseDay = 'Choose a day';
  static const chooseTime = 'Choose a time';
  static const clear = 'Clear';
  static const takePhoto = 'Take a photo';
  static const choosePhoto = 'Choose a photo';
  static String removeFile(String name) => 'Remove $name';
  static const photoFailed = 'The photo couldn’t be read. Please try again.';
  static const loadingForm = 'Getting the form ready…';
  static const formNotLoaded = 'The form couldn’t be loaded. Please try again in a moment.';
  static const tryAgain = 'Try again';
  static String keepTo(int max, int has) => 'Keep it to $max characters; it has $has.';
}
