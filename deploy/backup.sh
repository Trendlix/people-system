#!/bin/sh
# Saves People System's whole database once a day into backups/, and when this container starts. Files older than
# KEEP_DAYS are removed. A save that fails (the database not up yet after a restart of the server, say) is tried
# again five minutes later, not a day later.
# A save holds national IDs and salaries: keep the folder to the server's administrator, and copy it off the server too.
umask 077
while true; do
  file="/backups/people_system-$(date +%Y-%m-%d-%H%M).dump"
  if pg_dump -h db -U people -d people_system -Fc -f "$file.part"; then mv "$file.part" "$file"; echo "Saved $file"; pause=86400
  else rm -f "$file.part"; echo "The database could not be saved this time. Trying again in five minutes."; pause=300; fi
  find /backups -name 'people_system-*.dump' -mtime "+${KEEP_DAYS:-14}" -delete
  sleep "$pause"
done
