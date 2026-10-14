#!/bin/sh
# Prints the root certificate of this Caddy's private authority, on one line, for the web app to trust.
# Run on the server after the first ./deploy.sh:
#   ./ca-cert.sh
# It is a public certificate, not a secret: anyone connecting to port 8443 is shown the chain it belongs to.
# Its key never leaves the server. It stays the same across deploys and restarts (it is kept in the volume
# caddy_data); if that volume is ever deleted, Caddy makes a new one and this has to be run and saved again.
set -eu
cd "$(dirname "$0")"
root=/data/caddy/pki/authorities/local/root.crt
docker compose exec -T caddy test -f "$root" || { echo "Caddy has not made its authority yet. Run ./deploy.sh first, wait a few seconds, then run this again."; exit 1; }
echo
echo "Save this one line (it is the certificate, base64-encoded) as API_CA_CERT:"
echo "  1. Vercel: people-system, Settings, Environment Variables, Production. Then redeploy."
echo "  2. GitHub: Trendlix/people-system, Settings, Secrets and variables, Actions, tab Variables."
echo "----------------------------------------------------------------------"
docker compose exec -T caddy cat "$root" | base64 | tr -d '\n'
echo
echo "----------------------------------------------------------------------"
