#!/bin/sh
# Brings People System on this server up to the latest version on GitHub: fetch, save the database, build the API,
# restart, and wait until it answers. Run on the server:  ./deploy.sh   (the pipeline on GitHub runs the same script
# after a push, see .github/workflows/backend.yml).
set -eu
cd "$(dirname "$0")"
[ -f .env ] || { echo "There is no .env here yet. Copy .env.example to .env and fill it in first."; exit 1; }
chmod 600 .env

# The newest version, this script included: once it is fetched, the script starts again as it now is.
if [ -z "${PEOPLE_FETCHED:-}" ]; then
  git pull --ff-only
  PEOPLE_FETCHED=1 exec sh "$0" "$@"
fi

# People's records are in this database: before anything is changed, it is saved as it is. A new version may change
# the tables, which happens when the API starts. The save is kept with the daily ones, in backups/; if it cannot be
# made, nothing is deployed.
if docker compose ps --status running --services 2>/dev/null | grep -qx backup; then
  stamp=$(date +%Y-%m-%d-%H%M%S)
  if docker compose exec -T backup sh -c "umask 077; pg_dump -h db -U people -d people_system -Fc -f /backups/people_system-$stamp-before-deploy.dump.part && mv /backups/people_system-$stamp-before-deploy.dump.part /backups/people_system-$stamp-before-deploy.dump"; then
    echo "The database was saved before the deploy: backups/people_system-$stamp-before-deploy.dump"
  else
    echo "The database could not be saved before the deploy, so nothing was deployed. The version that was running is still running."
    exit 1
  fi
else
  echo "No save before this deploy: the backup service is not running yet (a first start)."
fi

# The stamp of the build, which the API answers at /api/version: the last commit that changed what the image is
# built from, and its date. A push that changes nothing of the API builds the same image and restarts nothing.
# A stamp never stops a deploy: if git cannot answer, both are empty and the deploy goes on.
PEOPLE_COMMIT=$(git log -1 --format=%h -- ../apps/api ../packages/shared ../package.json ../package-lock.json 2>/dev/null || true)
PEOPLE_COMMITTED=$(git log -1 --format=%cI -- ../apps/api ../packages/shared ../package.json ../package-lock.json 2>/dev/null || true)
export PEOPLE_COMMIT PEOPLE_COMMITTED
if [ -n "$PEOPLE_COMMIT" ]; then
  echo "This build is stamped $PEOPLE_COMMIT, committed $PEOPLE_COMMITTED."
else
  echo "This build has no stamp: git did not name the last commit of the API. The deploy goes on."
fi

docker compose build api
docker compose up -d --wait
docker compose ps
