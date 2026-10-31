-- Asking for a sign-in code by email is counted with Forgot password's requests (owner, 31 October 2026: "and i can add
-- OTP via Mail for app login"): limited by the address and the email the same way.
ALTER TABLE "access_link_requests" DROP CONSTRAINT "access_link_requests_kind_check";
ALTER TABLE "access_link_requests" ADD CONSTRAINT "access_link_requests_kind_check" CHECK ("kind" IN ('forgot', 'set_failed', 'login_code'));
