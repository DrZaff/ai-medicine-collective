#!/usr/bin/env bash
# Checks that the agent server (the Dell) is locked down as described in
# docs/agents/dell-setup.md, parts B and C. Read-only: it changes nothing.
#
# Run on the Dell:
#   sudo bash lockdown-check.sh
#
# Each line says PASS, FAIL, WARN (worth a look) or MANUAL (can't be checked
# from software). Exits 1 if anything FAILs, so it can run on a schedule later.

set -u

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "Run it with sudo: sudo bash $0" >&2
  exit 2
fi

AGENT_USER="${AGENT_USER:-agent}"
OWNER="${SUDO_USER:-you}"
pass=0; fail=0; warn=0

if [ -t 1 ]; then G=$'\e[32m'; R=$'\e[31m'; Y=$'\e[33m'; B=$'\e[36m'; N=$'\e[0m'; else G=; R=; Y=; B=; N=; fi
ok()     { echo "${G}PASS${N}   $*"; pass=$((pass + 1)); }
bad()    { echo "${R}FAIL${N}   $*"; fail=$((fail + 1)); }
care()   { echo "${Y}WARN${N}   $*"; warn=$((warn + 1)); }
manual() { echo "${B}MANUAL${N} $*"; }
info()   { echo "       $*"; }
have()   { command -v "$1" > /dev/null 2>&1; }
section(){ echo; echo "== $*"; }

section "System"
if [ -r /etc/os-release ]; then
  . /etc/os-release
  if [ "${ID:-}" = "ubuntu" ] && [ "${VERSION_ID:-}" = "24.04" ]; then ok "Ubuntu 24.04 LTS"
  else care "Expected Ubuntu 24.04 LTS, found ${PRETTY_NAME:-unknown}"; fi
fi
tz=$(timedatectl show -p Timezone --value 2> /dev/null || cat /etc/timezone 2> /dev/null || echo unknown)
[ "$tz" = "America/New_York" ] && ok "Time zone America/New_York" || care "Time zone is $tz (expected America/New_York)"
root_use=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if [ -n "$root_use" ] && [ "$root_use" -lt 80 ]; then ok "Disk ${root_use}% used"; else care "Disk ${root_use:-?}% used (over 80%)"; fi

section "Automatic security updates"
if dpkg -s unattended-upgrades > /dev/null 2>&1; then ok "unattended-upgrades is installed"
else bad "unattended-upgrades is not installed (sudo apt install unattended-upgrades)"; fi
if grep -qs 'APT::Periodic::Unattended-Upgrade "1"' /etc/apt/apt.conf.d/20auto-upgrades; then ok "Automatic upgrades are switched on"
else bad "Automatic upgrades are off (sudo dpkg-reconfigure -plow unattended-upgrades, choose Yes)"; fi
if [ -f /var/run/reboot-required ]; then care "A reboot is waiting to finish an update (sudo reboot)"; else ok "No reboot pending"; fi

section "Firewall (ufw)"
if have ufw; then
  status=$(ufw status verbose 2> /dev/null)
  if grep -q '^Status: active' <<< "$status"; then ok "Firewall is on"; else bad "Firewall is off (sudo ufw enable, after allowing tailscale0)"; fi
  if grep -q 'deny (incoming)' <<< "$status"; then ok "Incoming traffic is denied by default"
  else bad "Incoming is not denied by default (sudo ufw default deny incoming)"; fi
  if grep -Eq 'allow \(outgoing\)' <<< "$status"; then ok "Outgoing traffic is allowed (needed for updates and Tailscale)"; fi
  if grep -q 'ALLOW IN.*on tailscale0\|on tailscale0.*ALLOW IN' <<< "$status" || grep -Eq '^Anywhere on tailscale0 +ALLOW' <<< "$status"; then
    ok "Traffic is allowed in on tailscale0"
  else bad "No rule allowing traffic in on tailscale0 (sudo ufw allow in on tailscale0)"; fi
  others=$(grep -E 'ALLOW( IN)?' <<< "$status" | grep -v 'tailscale0' | grep -v 'OUT' || true)
  if [ -z "$others" ]; then ok "No other incoming rules"
  else bad "Incoming rules that aren't limited to tailscale0 (remove with sudo ufw delete ...):"; while IFS= read -r l; do info "$l"; done <<< "$others"; fi
else
  bad "ufw is not installed"
fi

section "SSH"
if have sshd; then
  cfg=$(sshd -T 2> /dev/null)
  val() { awk -v k="$1" '$1 == k { print $2; exit }' <<< "$cfg"; }
  [ "$(val passwordauthentication)" = "no" ] && ok "Password login is off" || bad "Password login is on (set PasswordAuthentication no)"
  [ "$(val permitrootlogin)" = "no" ] && ok "Root login is off" || bad "Root login is allowed (set PermitRootLogin no)"
  [ "$(val pubkeyauthentication)" = "yes" ] && ok "Key login is on" || bad "Key login is off"
  [ "$(val kbdinteractiveauthentication)" = "no" ] && ok "Keyboard-interactive login is off" || care "Keyboard-interactive login is on (set KbdInteractiveAuthentication no)"
  if [ -n "$OWNER" ]; then
    home=$(getent passwd "$OWNER" | cut -d: -f6)
    if [ -s "$home/.ssh/authorized_keys" ]; then ok "$OWNER has an SSH key installed"
    else care "$OWNER has no ~/.ssh/authorized_keys (fine if you only use Tailscale SSH)"; fi
  fi
else
  care "OpenSSH server not found (fine if you only use Tailscale SSH)"
fi
if passwd -S root 2> /dev/null | awk '{ exit !($2 == "L" || $2 == "LK") }'; then ok "The root account's password is locked"
else care "The root account has a usable password (sudo passwd -l root)"; fi

section "Tailscale"
if have tailscale; then
  ip4=$(tailscale ip -4 2> /dev/null | head -1)
  if [ -n "$ip4" ]; then ok "Tailscale is connected ($ip4)"; else bad "Tailscale is installed but not connected (sudo tailscale up --ssh)"; fi
  systemctl is-enabled tailscaled > /dev/null 2>&1 && ok "Tailscale starts at boot" || bad "Tailscale doesn't start at boot (sudo systemctl enable --now tailscaled)"
else
  bad "Tailscale is not installed"
fi

section "Listening services"
if have ss; then
  while read -r proto local proc; do
    addr=${local%:*}; port=${local##*:}
    case "$addr" in
      127.*|"[::1]"|100.*|"[fd7a:115c:a1e0:"*) ;;  # this machine only, or Tailscale only
      *) info "$proto port $port is open on all interfaces (${proc:-unknown}); the firewall blocks it from outside Tailscale" ;;
    esac
  done < <(ss -H -tuln 2> /dev/null | awk '{ print $1, $5 }' | sort -u)
  ok "Listed above: anything reachable only because the firewall stops it (normally just SSH on 22)"
fi

section "The agent account"
if id "$AGENT_USER" > /dev/null 2>&1; then
  ok "User '$AGENT_USER' exists"
  groups_of=$(id -nG "$AGENT_USER")
  if grep -Eqw 'sudo|admin|wheel' <<< "$groups_of"; then bad "'$AGENT_USER' is in an admin group ($groups_of): sudo deluser $AGENT_USER sudo"
  else ok "'$AGENT_USER' has no admin group"; fi
  if grep -qw docker <<< "$groups_of"; then bad "'$AGENT_USER' is in the docker group, which is root in all but name. Use rootless Docker instead (dell-setup.md, part D)"
  else ok "'$AGENT_USER' is not in the docker group"; fi
  if sudo -l -U "$AGENT_USER" 2> /dev/null | grep -q 'may run'; then bad "'$AGENT_USER' has sudo rights (check /etc/sudoers.d/)"
  else ok "'$AGENT_USER' has no sudo rights"; fi
  [ -e "/var/lib/systemd/linger/$AGENT_USER" ] && ok "'$AGENT_USER' services keep running when nobody is logged in" || care "Linger is off for '$AGENT_USER' (sudo loginctl enable-linger $AGENT_USER)"
  ahome=$(getent passwd "$AGENT_USER" | cut -d: -f6)
  found=""
  for p in .config/gh/hosts.yml .git-credentials .claude .claude.json .codex .config/agents; do
    [ -e "$ahome/$p" ] && found="$found ~$AGENT_USER/$p"
  done
  if [ -z "$found" ]; then ok "No GitHub or AI sign-ins in '$AGENT_USER' (none belong there yet)"
  else care "Sign-ins or tokens found in '$AGENT_USER' before they're due (part E):$found"; fi
else
  bad "User '$AGENT_USER' doesn't exist (sudo adduser --disabled-password --gecos \"\" $AGENT_USER)"
fi

section "Not today (only reported)"
have docker && info "Docker is installed: fine later, for part D, as rootless Docker" || info "Docker is not installed (correct for today)"

section "Check these by hand"
manual "BIOS: AC Recovery = Power On. Pull the power, plug it back in, and confirm the Dell starts by itself."
manual "From your laptop, with Tailscale ON: 'ssh $OWNER@<dell name>' should work."
manual "From your laptop, with Tailscale OFF, on home Wi-Fi: 'ssh $OWNER@<dell name>.local' should FAIL."
manual "The Dell and your router are on the UPS (battery backup)."
info "Last boot: $(uptime -s 2> /dev/null || echo unknown)"

echo
echo "Summary: ${pass} passed, ${fail} failed, ${warn} warnings."
if [ "$fail" -gt 0 ]; then
  echo "Fix the FAIL lines, then run this again."
  exit 1
fi
echo "Locked down. Do the MANUAL checks if you haven't yet."
exit 0
