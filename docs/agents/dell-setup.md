# Setting up the agent server

The Dell OptiPlex 7060 Micro (i5-8500T, 16 GB RAM, 512 GB SSD) becomes the always-on machine that runs the orchestrator in [architecture.md](architecture.md). It runs agents only. Live sites stay on their current hosting, and no production secrets go on it. Part A can be done on GitHub today; parts B to F need the machine.

## A. On GitHub now (no Dell needed)

1. Review and merge the pull request that adds this file.
2. Create the labels: `agent:proposed`, `agent:ready`, `agent:working`, `agent:review`, `agent:human`, `agent:blocked`, `agent:failed`, `risk:low`, `risk:medium`, `risk:high`, `needs-clinical-review` (Issues > Labels > New label).
3. Add `.github/CODEOWNERS`, by pull request:
    - the owner for `/.github/`, `/supabase/`, `auth.js` and `netlify.toml`
    - the clinical reviewer for the clinical files (calculators and tool logic, `evidence/`, `course-*.html`)
4. Create a ruleset for `main` (Settings > Rules > Rulesets):
    - Require a pull request with 1 approval, **require review from code owners**, and **dismiss stale approvals when new commits are pushed** (this ties clinical sign-off to the exact commit).
    - Require the status checks **Data, build, links and secrets** and **Pages open without errors**.
    - Block force pushes and deletion.
    - Bypass: `github-actions[bot]` only, so the weekly digest can still commit to `main`. Check that the next Friday run succeeds.
5. Make the orchestrator's GitHub credential: a fine-grained personal access token limited to the repositories agents may work on, with Contents, Issues and Pull requests set to read and write and nothing else. Keep it for part C.
6. **Step zero** (architecture.md): try Codex's GitHub pull request review on a small PR, and Claude Code's GitHub Action on a small labeled issue. Write down what each covers and which allowance it uses. This decides how much the Dell has to do.

## B. Install the operating system

1. Update the BIOS from Dell's support site. Set **AC power recovery** to **On**, so the machine restarts by itself after a power cut. Use wired Ethernet, and fit a small UPS (battery backup) for the Dell and router.
2. Install **Ubuntu Server 24.04 LTS**, with SSH enabled and your public key imported.
3. Disk encryption: since no production data or secrets live on this machine, unencrypted is acceptable and lets it restart unattended. Encrypt it if you'd rather have theft protection and can type a passphrase after power cuts.
4. After the first boot:

```sh
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y unattended-upgrades git python3 python3-venv curl sqlite3 uidmap
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
3. Create the unprivileged `agent` user (no `sudo`). It runs the orchestrator and the containers:

```sh
sudo adduser --disabled-password --gecos "" agent
sudo loginctl enable-linger agent      # its services keep running when nobody is logged in
```

4. As `agent`, store the GitHub token from A.5 with `gh auth login --with-token < token.txt`, then delete `token.txt`.

## D. Containers for the workers

1. Install rootless Docker for the `agent` user (Docker's "Run the Docker daemon as a non-root user" guide), so even a container escape lands in an unprivileged account. Optional, stronger: the gVisor runtime (`runsc`).
2. Build one worker image per repository type (for this site: Python 3.12, Node 22, Playwright 1.63.0 with Chromium, git, Claude Code, Codex). Pin every version.
3. Limit what workers can reach: a dedicated Docker network whose outbound traffic only goes to GitHub, the package registries and the AI providers, through an allow-list proxy. Block the home network, `169.254.169.254` and everything else. Test that a worker can't reach your router's address.
4. Give each container CPU and memory limits (for example 2 CPUs and 6 GB), and `--read-only` with a writable work folder only.

## E. Sign in the agents

1. Sign in to Claude Code and Codex inside the worker setup with your own accounts, through their own sign-in flows. Never copy their tokens into a tool or a file the orchestrator manages.
2. Check the current terms and usage pages for scripted, scheduled use of each plan. Plan for month one as a measurement period (architecture.md, "Limits and usage").
3. Confirm the installed versions support the headless options used (`claude -p --help`, `codex exec --help`), and record the versions.

## F. First runs, by hand

1. In a worker container, clone ai-medicine-collective and run the three check commands from AGENTS.md. All should pass.
2. Open a tiny test issue with the **Agent task** template, label it `agent:ready`, and run the loop by hand: Claude in a container, checks in a second container, a draft PR, then the Codex review.
3. Then install the orchestrator (a separate pull request, not written yet) as a systemd user service with a timer, for this one repository, one task at a time. Reboot mid-run once and confirm it recovers.

## Decisions for the owner

- **Step zero results:** how much of the loop GitHub's built-in Claude and Codex integrations cover.
- **Usage after month one:** whether the Max and Plus plans are enough, or an API key with a hard monthly limit is needed for the overflow.
- **Who the clinical reviewer is** for CODEOWNERS.
- **Which repository joins next**, one at a time, once it has an AGENTS.md and working checks.
