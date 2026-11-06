# Setting up the agent server

The Dell OptiPlex 7060 Micro (i5-8500T, 16 GB RAM, 512 GB SSD) becomes the always-on server that runs the orchestrator in [architecture.md](architecture.md). Part A can be done on GitHub today; parts B to E need the machine.

## A. On GitHub now (no Dell needed)

1. Merge the pull request that adds this file, after reviewing it.
2. Create the labels: `agent:proposed`, `agent:ready`, `agent:working`, `agent:review`, `agent:human`, `agent:blocked`, `agent:failed`, `needs-clinical-review` (Issues > Labels > New label).
3. Protect `main` (Settings > Branches, or Rules > Rulesets):
    - Require a pull request before merging, with 1 approval.
    - Require the status checks **Data, build, links and secrets** and **Pages open without errors** (they appear after `site-checks.yml` has run once).
    - Block force pushes and deletion.
    - Allow `github-actions[bot]` to bypass, so the weekly digest can still commit to `main`. Check the next Friday run succeeds.
4. Optional: add `.github/CODEOWNERS` with `/.github/ @DrZaff` and `/supabase/ @DrZaff`, so workflow and database changes always need the owner.
5. Make a fine-grained personal access token for the agents (Settings > Developer settings): only the repositories agents may work on; Contents, Issues and Pull requests set to read and write; nothing else. Keep it for step C.4; never put it in a repository.

## B. Install the operating system

1. Update the BIOS from Dell's support site. In BIOS settings, set **AC power recovery** to **On**, so the machine restarts by itself after a power cut. Use wired Ethernet.
2. Install **Ubuntu Server 24.04 LTS**, with SSH enabled and your public key imported.
3. Disk encryption: encrypting the whole disk protects data if the machine is stolen, but then it waits for a passphrase after every reboot, which blocks unattended restarts. Decide before installing (see "Decisions" below).
4. After the first boot:

```sh
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y unattended-upgrades git python3 python3-venv curl
sudo dpkg-reconfigure -plow unattended-upgrades       # choose Yes
sudo timedatectl set-timezone America/New_York
```

## C. Lock it down and create the agent account

1. Remote access through Tailscale only, with no ports open to the internet:

```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh
sudo ufw default deny incoming && sudo ufw default allow outgoing
sudo ufw allow in on tailscale0 && sudo ufw enable
```

2. In `/etc/ssh/sshd_config`, set `PasswordAuthentication no` and `PermitRootLogin no`, then run `sudo systemctl restart ssh`.
3. Create the unprivileged agent user (no `sudo`):

```sh
sudo adduser --disabled-password --gecos "" agent
sudo -iu agent mkdir -p ~/agents/{work,logs} ~/.config
```

4. As `agent`, save the GitHub token from A.5 for git and the GitHub CLI (`gh auth login --with-token < token.txt`, then delete `token.txt`). Set the commit identity to the account the token belongs to.

## D. Install the tools (as `agent`)

1. Node.js 22 through `nvm` (installs per user, no `sudo`), then the agents:

```sh
npm install -g @anthropic-ai/claude-code @openai/codex
claude        # sign in once, then /exit
codex login   # sign in once
```

2. The site's test browser: `npm install -g playwright@1.63.0 && npx playwright install chromium`. Installing the browser's system libraries needs `sudo npx playwright install-deps chromium` once, from your own account.
3. Check that the versions installed support the headless options the orchestrator uses (`claude -p --help`, `codex exec --help`), and note them in the orchestrator's config.

## E. First run, by hand

1. `git clone https://github.com/DrZaff/ai-medicine-collective ~/agents/repos/ai-medicine-collective`, then run the three check commands from AGENTS.md. All three should pass.
2. Open a tiny test issue with the **Agent task** template (for example, fixing a typo), label it `agent:ready`, and run Claude Code headless on it by hand in a worktree. Confirm it opens a draft PR and the site checks run on it.
3. Run Codex in review mode on that PR and confirm it comments.
4. Then install the orchestrator (a separate pull request, not written yet) as a systemd timer, starting with this one repository and a daily cap of a few dollars.

## Decisions for the owner

- **Disk encryption vs. unattended restarts** (B.3).
- **Subscriptions or API keys** for Claude Code and Codex. Flat-rate plans make costs predictable; API keys make every run cost money but are easier to cap per task.
- **Whether the Dell also hosts websites** under the self-hosting plan. It can, but a home connection and home power are less reliable than a rented server. If it does, publish sites through Cloudflare Tunnel so no ports open on your home network.
- **Which repositories join next**, one at a time, after each has an AGENTS.md and working checks.
