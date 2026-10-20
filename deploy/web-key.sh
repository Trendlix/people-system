#!/bin/sh
# Makes the key the website (on Vercel) and the API share to sign the address a check-in comes from (check-ins locked
# to the office network; owner, 20 October 2026: "allow me to lock checkin's to wifi name or ip, whatever is right"),
# and prints the line to save in Vercel. Run on the server, beside .env:
#   ./web-key.sh
# It writes WEB_KEY into .env when .env has none, and never replaces one: run again, it prints the same key.
# Then: ./deploy.sh, so the API starts with it; and in Vercel, people-system, Settings, Environment Variables,
# Production: WEB_KEY, the value printed below. Then redeploy the website. Attendance → Check-in Setup says "Ready" once
# both have it. Until then the lock can't be switched on, and no one is refused for its lack.
# It is a secret: whoever holds it can sign an address as the website does. To replace it, remove the WEB_KEY line from
# .env, run this again, ./deploy.sh, and save the new one in Vercel; until both have the new one, Office staff's
# check-ins are refused while the lock is on.
set -eu
cd "$(dirname "$0")"
[ -f .env ] || { echo "There is no .env here yet: copy .env.example to .env and fill it in first (DEPLOY.md, step 3). Nothing was changed."; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "openssl is needed to make the key. Nothing was changed."; exit 1; }

key=$(sed -n 's/^WEB_KEY=//p' .env | tr -d '"\r' | head -n 1)
if [ -n "$key" ]; then
  echo "WEB_KEY is in .env already: it is kept as it is."
  [ "${#key}" -ge 32 ] || echo "It is shorter than 32 characters, so the API won't use it: remove the WEB_KEY line from .env and run this again."
else
  key=$(openssl rand -hex 32)
  if grep -q '^WEB_KEY=' .env; then
    # the empty WEB_KEY= line copied from .env.example is filled in, the rest of .env kept as it is
    tmp=$(mktemp)
    trap 'rm -f "$tmp"' EXIT
    sed "s/^WEB_KEY=.*/WEB_KEY=$key/" .env > "$tmp"
    cat "$tmp" > .env
  else
    printf '\n# The key the website and the API share to sign a check-in'"'"'s address (./web-key.sh; DEPLOY.md).\nWEB_KEY=%s\n' "$key" >> .env
  fi
  chmod 600 .env
  echo "WEB_KEY was made and written into .env. Run ./deploy.sh so the API starts with it."
fi
echo
echo "Save it in Vercel: people-system, Settings, Environment Variables, Production, as"
echo "  Name:  WEB_KEY"
echo "  Value: the line below. Then redeploy the website (settings apply to new deployments only)."
echo "----------------------------------------------------------------------"
echo "$key"
echo "----------------------------------------------------------------------"
echo "It is a secret: clear the screen when it is saved (clear)."
