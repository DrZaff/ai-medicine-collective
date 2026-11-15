#!/bin/sh
# One-time setup on the server, run with sudo by the owner:  sudo sh install.sh <folder>
# <folder> holds the hash-checked copies of preflight.py, pr_test.py, handoff.py and
# review-schema.json. Safe to re-run.
#
# Splits Billy across two Unix users so the reviewer can never read the publisher's key:
#   agent      runs Codex (its sign-in stays in /home/agent/.codex); cannot read the key
#   billy-pub  holds the key in /var/lib/billy-pub/.config/billy; never runs Codex
#   billy-stop owns /var/lib/billy-control and only ever sets the stop marker STOP there;
#              agent and billy-pub can read it but never set, replace or clear it
# The scripts live root-owned in /opt/billy, so neither user can change them.
set -eu
[ "$(id -u)" = 0 ] || { echo "STOP: run with sudo"; exit 1; }
SRC=${1:?folder with the downloaded files}
PUB=billy-pub
PH=/var/lib/billy-pub
OLD=/home/agent/.config/billy

STOPPER=billy-stop
CONTROL=/var/lib/billy-control
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
# Private repositories' commits pass the other way, billy-pub (writes) to agent (reads), as git
# bundles: the reviewer never holds a GitHub credential.
install -d -o "$PUB" -g agent -m 2750 /var/lib/billy-sources
# The stop marker's folder: readable by everyone, writable only by billy-stop. While
# $CONTROL/STOP exists, every Billy step refuses (docs/agents/billy.md, "The stop marker").
id "$STOPPER" >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent \
  --shell /usr/sbin/nologin "$STOPPER"
[ ! -L "$CONTROL" ] || { echo "STOP: $CONTROL is a symlink"; exit 1; }
install -d -o "$STOPPER" -g "$STOPPER" -m 755 "$CONTROL"
# Old copies in agent's home are replaced by /opt/billy.
rm -rf /home/agent/.local/lib/billy
chmod 700 /home/agent/.codex 2>/dev/null || true

sudo -u "$PUB" python3 -c 'import cryptography' 2>/dev/null || apt-get install -y python3-cryptography

[ -f "$PH/.config/billy/app.pem" ] || { echo "STOP: key not found in $PH/.config/billy"; exit 1; }
if [ -e "$OLD/app.pem" ]; then echo "STOP: the old key copy is still in $OLD"; exit 1; fi
if sudo -u agent test -r "$PH/.config/billy/app.pem"; then echo "STOP: agent can still read the key"; exit 1; fi
for u in agent "$PUB"; do
  if sudo -u "$u" test -w "$CONTROL"; then echo "STOP: $u can write to $CONTROL"; exit 1; fi
  probe="$CONTROL/.probe-$$"
  if sudo -u "$u" sh -c "touch '$probe'" 2>/dev/null; then
    rm -f "$probe"; echo "STOP: $u could create a file in $CONTROL"; exit 1
  fi
done
stat -c '%U:%G %a %n' "$PH" "$PH/.config/billy/app.pem" "$PH/.config/billy/app.json" \
  /opt/billy /opt/billy/* /var/lib/billy-reviews /var/lib/billy-sources /home/agent/.codex "$CONTROL"
if [ -e "$CONTROL/STOP" ] || [ -L "$CONTROL/STOP" ]; then
  echo "stop_marker=SET (Billy refuses every step until the owner clears it)"
else
  echo "stop_marker=clear"
fi
echo "Installed files (compare with the merged commit):"
sha256sum /opt/billy/*
echo "agent_cannot_read_key=yes"
echo "stop_marker_protected=yes"
