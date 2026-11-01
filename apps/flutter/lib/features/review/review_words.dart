// The review's words, in one place (ready for Arabic): the website's (apps/web employees/[id]/confirm and
// employees/confirmation.ts) where it says the same thing.

abstract final class ReviewWords {
  static const eyebrow = 'People System · Your details';
  static const title = 'Review Your Details';
  static String changed(String names) => 'Your details changed since you confirmed them ($names).';
  static const changedSince = 'Changed since you last confirmed';
  static const statement = 'Your statement';
  static const accept = 'I have read and accept this statement';
  static const mustAccept = 'Tick “I have read and accept this statement” to confirm your details.';
  static const confirm = 'Confirm my details';
  static const confirming = 'Confirming…';
  static const confirmed = 'Details confirmed.';
  static const askForChange = 'Ask for a change';
  static const changeWaiting = 'Your change request is waiting for HR.';
  static const signOut = 'Sign out';
  static const close = 'Close';
  static const notLoaded = 'Couldn’t load your details.';
  static const tryAgain = 'Try again';

  // the parts of the change request's sheet
  static const personal = 'Personal';
  static const contact = 'Contact & Address';
  static const emergency = 'Emergency Contact';
  static const education = 'Education';
}
