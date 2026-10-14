#!/bin/sh
# Makes the key with which GitHub brings People System on this server up to date after a push
# (.github/workflows/backend.yml), and prints the two values to save as secrets of the repository.
# Run once on the server, as the user who runs ./deploy.sh:
#   ./ci-key.sh
# The key is tied to this deploy.sh: whoever holds it can start a deploy of what is on GitHub, and nothing else.
# No shell, no file copy, no forwarding. Run it again to replace the key; the old one stops working.
#
# Another system on this server may have a deploy key of its own (named github-actions-deploy). This one has a
# different name, so it never removes another key, and no other script removes it.
set -eu
cd "$(dirname "$0")"
here=$(pwd)
name=github-actions-deploy-people-system
keys="$HOME/.ssh/authorized_keys"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

[ -f deploy.sh ] || { echo "deploy.sh is not beside this script."; exit 1; }
[ -r /etc/ssh/ssh_host_ed25519_key.pub ] || { echo "This server's own key (/etc/ssh/ssh_host_ed25519_key.pub) cannot be read. Nothing was changed."; exit 1; }
hostkey=$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)

mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
touch "$keys" && chmod 600 "$keys"
ssh-keygen -q -t ed25519 -N "" -C "$name" -f "$tmp/key"
# the key before this one, if there was one, is taken out (only this key's own name: " $name" at the end of the line)
grep -v " $name\$" "$keys" > "$tmp/keys" || true
printf 'command="%s/deploy.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty %s\n' "$here" "$(cat "$tmp/key.pub")" >> "$tmp/keys"
cat "$tmp/keys" > "$keys"

# the name the server is reached under: the one set in .env, as the workflow uses it
host=$(sed -n 's/^SERVER_NAME=//p' .env 2>/dev/null | tr -d '"\r' | head -n 1)
[ -n "$host" ] || host=$(hostname -f 2>/dev/null || hostname)
echo
echo "In GitHub: Trendlix/people-system, Settings, Secrets and variables, Actions, New repository secret."
echo
echo "1. Name: VPS_SSH_KEY     Value: everything between the two lines below, the BEGIN and END lines included"
echo "----------------------------------------------------------------------"
cat "$tmp/key"
echo "----------------------------------------------------------------------"
echo
echo "2. Name: VPS_KNOWN_HOSTS     Value: this one line"
echo "$host $hostkey"
echo
echo "The private key is not kept on this server: it is shown here once. Clear the screen when both are saved (clear)."
echo "If the server is reached under another name than $host, or as another user than $(id -un), set the variables"
echo "VPS_HOST and VPS_USER on the same page (the tab Variables), and put that name in front of the line of secret 2."
