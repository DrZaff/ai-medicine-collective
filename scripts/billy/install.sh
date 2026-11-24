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
# Each step also leaves a read-only copy of its run record in /var/lib/billy-runs/<user>/ for
# Mission Control (issue #228). Only members of the group billy-runs (Mission Control's fetcher,
# added in its phase A5a) can read them; agent and billy-pub can't touch each other's.
# The scripts live root-owned in /opt/billy, so neither user can change them.
set -eu
[ "$(id -u)" = 0 ] || { echo "STOP: run with sudo"; exit 1; }
SRC=${1:?folder with the downloaded files}
PUB=billy-pub
PH=/var/lib/billy-pub
OLD=/home/agent/.config/billy

STOPPER=billy-stop
CONTROL=/var/lib/billy-control
RUNS=/var/lib/billy-runs
RUNS_GROUP=billy-runs
# The only accounts allowed to read the shared run records: an allow-list, not "everyone in the
# group but a few" (Codex's review of dadd4ce). Empty until Mission Control's fetcher exists; its
# phase A5a adds that one account here.
READERS=""
# Accounts that must never read the publisher's key or the Codex sign-in, besides agent.
NEVER_READ="mission-control billy-stop"
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
# Shared run records: one folder per writer, setgid so each copy belongs to billy-runs.
getent group "$RUNS_GROUP" >/dev/null || groupadd --system "$RUNS_GROUP"
for d in "$RUNS" "$RUNS/agent" "$RUNS/$PUB"; do
  [ ! -L "$d" ] || { echo "STOP: $d is a symlink"; exit 1; }
done
install -d -o root -g root -m 755 "$RUNS"
install -d -o agent -g "$RUNS_GROUP" -m 2750 "$RUNS/agent"
install -d -o "$PUB" -g "$RUNS_GROUP" -m 2750 "$RUNS/$PUB"
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
# Shared run records: each writer can add to its own folder only; the other can't write there.
for pair in "agent:$PUB" "$PUB:agent"; do
  u=${pair%%:*}; other=${pair#*:}
  probe="$RUNS/$u/.probe-$$"
  sudo -u "$u" sh -c "touch '$probe'" 2>/dev/null || { echo "STOP: $u can't write $RUNS/$u"; exit 1; }
  rm -f "$probe"
  if sudo -u "$u" sh -c "touch '$RUNS/$other/.probe-$$'" 2>/dev/null; then
    rm -f "$RUNS/$other/.probe-$$"; echo "STOP: $u could write in $RUNS/$other"; exit 1
  fi
  if sudo -u "$u" sh -c "touch '$RUNS/.probe-$$'" 2>/dev/null; then
    rm -f "$RUNS/.probe-$$"; echo "STOP: $u could write in $RUNS"; exit 1
  fi
done
# Neither writer is in billy-runs (it would let each read the other's records), nor Mission
# Control's web app account, nor the stop helper's (Codex, 4ab847b): only the fetcher joins it,
# in phase A5a.
for u in agent "$PUB" mission-control "$STOPPER"; do
  if id -nG "$u" 2>/dev/null | tr ' ' '\n' | grep -qx "$RUNS_GROUP"; then
    echo "STOP: $u must not be in the group $RUNS_GROUP"; exit 1
  fi
done
# Effective access, not just membership: the kernel's own test applies ACLs too, so any extra
# permission, however it was granted, stops the install (Codex's review of 0508c9a). A writer
# can't enter the other's folder; Mission Control's other accounts can enter neither.
for pair in "agent:$RUNS/$PUB" "$PUB:$RUNS/agent" \
            "mission-control:$RUNS/agent" "mission-control:$RUNS/$PUB" \
            "$STOPPER:$RUNS/agent" "$STOPPER:$RUNS/$PUB"; do
  u=${pair%%:*}; d=${pair#*:}
  id "$u" >/dev/null 2>&1 || continue
  if sudo -u "$u" test -x "$d" || sudo -u "$u" test -r "$d"; then
    echo "STOP: $u can enter or list $d"; exit 1
  fi
done
# billy-runs holds exactly the READERS: the group's listed members plus every account whose
# primary group it is (getent lists only the former). Anyone else stops the install.
gid=$(getent group "$RUNS_GROUP" | cut -d: -f3)
members=$( { getent group "$RUNS_GROUP" | cut -d: -f4 | tr ',' '\n'
             getent passwd | awk -F: -v g="$gid" '$4 == g { print $1 }'; } |
           grep -v '^$' | sort -u | tr '\n' ' ')
members=${members% }
for u in $members; do
  case " $READERS " in
    *" $u "*) ;;
    *) echo "STOP: $u is in $RUNS_GROUP but not an allowed reader (READERS in install.sh)"; exit 1 ;;
  esac
done
# Each allowed reader can open a real record, written as Billy writes one, and can write
# nothing: folder permissions alone can't show a file-level ACL that would block real records
# (Codex, dadd4ce).
for u in $READERS; do
  id "$u" >/dev/null 2>&1 || { echo "STOP: allowed reader $u doesn't exist"; exit 1; }
  for w in agent "$PUB"; do
    d="$RUNS/$w"; probe="$d/.install-probe-$$.json"
    sudo -u "$w" sh -c "umask 022; printf '{}' > '$probe' && chmod 640 '$probe'" ||
      { echo "STOP: $w couldn't write a probe record in $d"; exit 1; }
    if ! sudo -u "$u" cat "$probe" >/dev/null 2>&1; then
      rm -f "$probe"; echo "STOP: $u can't open a record in $d"; exit 1
    fi
    if sudo -u "$u" sh -c "printf x >> '$probe'" 2>/dev/null; then
      rm -f "$probe"; echo "STOP: $u could change a record in $d"; exit 1
    fi
    rm -f "$probe"
    if sudo -u "$u" sh -c "touch '$d/.probe-$$'" 2>/dev/null; then
      rm -f "$d/.probe-$$"; echo "STOP: $u could write in $d"; exit 1
    fi
  done
done
# Mission Control's accounts, and every allowed reader, can't read the key or the Codex sign-in.
for u in $NEVER_READ $READERS; do
  id "$u" >/dev/null 2>&1 || continue
  if sudo -u "$u" test -r "$PH/.config/billy/app.pem"; then echo "STOP: $u can read the key"; exit 1; fi
  # Entering is enough to open a known file inside, so test entering as well as listing
  # (Codex's review of ae88c51).
  if sudo -u "$u" test -x /home/agent/.codex || sudo -u "$u" test -r /home/agent/.codex; then
    echo "STOP: $u can enter or list /home/agent/.codex"; exit 1
  fi
done
stat -c '%U:%G %a %n' "$PH" "$PH/.config/billy/app.pem" "$PH/.config/billy/app.json" \
  /opt/billy /opt/billy/* /var/lib/billy-reviews /var/lib/billy-sources /home/agent/.codex "$CONTROL" \
  "$RUNS" "$RUNS/agent" "$RUNS/$PUB"
echo "billy-runs readers: ${READERS:-(none yet; Mission Control's fetcher joins in A5a)}"
if [ -e "$CONTROL/STOP" ] || [ -L "$CONTROL/STOP" ]; then
  echo "stop_marker=SET (Billy refuses every step until the owner clears it)"
else
  echo "stop_marker=clear"
fi
echo "Installed files (compare with the merged commit):"
sha256sum /opt/billy/*
echo "agent_cannot_read_key=yes"
echo "stop_marker_protected=yes"
echo "shared_runs_protected=yes"
echo "mission_control_cannot_read_key=yes"
