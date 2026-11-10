#!/bin/sh
# One-time setup on the server, run with sudo by the owner:  sudo sh install.sh <folder>
# <folder> holds the hash-checked copies of preflight.py, pr_test.py, handoff.py and
# review-schema.json. Safe to re-run.
#
# Splits Billy across two Unix users so the reviewer can never read the publisher's key:
#   agent      runs Codex (its sign-in stays in /home/agent/.codex); cannot read the key
#   billy-pub  holds the key in /var/lib/billy-pub/.config/billy; never runs Codex
# The scripts live root-owned in /opt/billy, so neither user can change them.
set -eu
[ "$(id -u)" = 0 ] || { echo "STOP: run with sudo"; exit 1; }
SRC=${1:?folder with the downloaded files}
PUB=billy-pub
PH=/var/lib/billy-pub
OLD=/home/agent/.config/billy

id "$PUB" >/dev/null 2>&1 || useradd --system --home-dir "$PH" --create-home --shell /usr/sbin/nologin "$PUB"
chmod 700 "$PH"
install -d -o "$PUB" -g "$PUB" -m 700 "$PH/.config" "$PH/.config/billy" "$PH/.cache"

# Move the key and its config out of agent's home (copy, check, then shred the old copy).
for f in app.pem app.json; do
  if [ -f "$OLD/$f" ]; then
    install -o "$PUB" -g "$PUB" -m 600 "$OLD/$f" "$PH/.config/billy/$f"
    cmp -s "$OLD/$f" "$PH/.config/billy/$f" && shred -u "$OLD/$f"
  fi
done

install -d -o root -g root -m 755 /opt/billy
for f in preflight.py pr_test.py handoff.py review-schema.json; do
  install -o root -g root -m 644 "$SRC/$f" "/opt/billy/$f"
done
# Reviews pass from agent (writes) to billy-pub (reads) through this folder only.
install -d -o agent -g "$PUB" -m 2750 /var/lib/billy-reviews
# Old copies in agent's home are replaced by /opt/billy.
rm -rf /home/agent/.local/lib/billy
chmod 700 /home/agent/.codex 2>/dev/null || true

sudo -u "$PUB" python3 -c 'import cryptography' 2>/dev/null || apt-get install -y python3-cryptography

[ -f "$PH/.config/billy/app.pem" ] || { echo "STOP: key not found in $PH/.config/billy"; exit 1; }
if [ -e "$OLD/app.pem" ]; then echo "STOP: the old key copy is still in $OLD"; exit 1; fi
if sudo -u agent test -r "$PH/.config/billy/app.pem"; then echo "STOP: agent can still read the key"; exit 1; fi
stat -c '%U:%G %a %n' "$PH" "$PH/.config/billy/app.pem" "$PH/.config/billy/app.json" \
  /opt/billy /opt/billy/* /var/lib/billy-reviews /home/agent/.codex
echo "agent_cannot_read_key=yes"
