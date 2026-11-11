# Setting up the agent server

The Dell OptiPlex 7060 Micro (i5-8500T, 16 GB RAM, 512 GB SSD) becomes the always-on machine that runs the orchestrator in [architecture.md](architecture.md). It runs agents only. Live sites stay on their current hosting, and no production secrets go on it. Part A can be done on GitHub today; parts B to F need the machine.

## A. On GitHub now (no Dell needed)

1. Review and merge the pull request that adds this file.
2. Create the labels: `agent:proposed`, `agent:ready`, `agent:working`, `agent:review`, `agent:human`, `agent:blocked`, `agent:failed`, `risk:low`, `risk:medium`, `risk:high`, `needs-clinical-review`, `needs-adjudication` (when the two models disagree about a study; docs/editorial/scientific-review.md) (Issues > Labels > New label).
3. Add `.github/CODEOWNERS`, by pull request (drafted in #125):
    - the owner for `/.github/`, `/supabase/`, `auth.js` and `netlify.toml`
    - the clinical reviewer for the clinical files (calculators and tool logic, `evidence/`, `course-*.html`)
4. Create a ruleset for `main` (Settings > Rules > Rulesets):
    - Require a pull request with 1 approval, **require review from code owners**, and **dismiss stale approvals when new commits are pushed** (this ties clinical sign-off to the exact commit).
    - GitHub never lets anyone approve their own pull request. So give the **repository admin** role a bypass in **"For pull requests only"** mode: the owner can merge their own PRs (including those Claude opens under the owner's account) through the PR page, but nobody can push straight to `main`. Agent PRs must come from a separate identity (A.5) so the owner can approve them.
    - Require the status checks **Data, build, links and secrets** and **Pages open without errors**.
    - Block force pushes and deletion.
    - Other bypass: **none at first**. Don't add `github-actions[bot]`: a bypass applies to every workflow running as that actor. Before turning the ruleset on, move the weekly digest onto its own GitHub App (architecture.md, "Security boundaries"), in its own pull request, and put only that App on the bypass list. Check that the next Friday run succeeds. The step-by-step plan is [digest-publisher.md](digest-publisher.md).
    - Then run a **negative test**: a test PR without the owner's approval, and a test PR touching a clinical file without the clinician's approval, must both be blocked from merging.
5. Make the agents' GitHub identity: a **GitHub App** (for example "AMC Agents"), not a token tied to your own account. PRs opened with your own token count as yours, and you could never approve them. Give it Contents, Issues and Pull requests set to read and write, nothing else (no Administration, Secrets or Workflows), and install it only on the repositories agents may work on. Its PRs appear as the App, so you approve them like anyone else's. Keep its App ID and private key for part C; the orchestrator turns them into short-lived tokens.
6. **Step zero** (architecture.md): the three experiments: Claude's GitHub Action building a low-risk issue, Codex reviewing a PR with a planted defect, and the two end to end. Record the permissions, the usage, the reliability, and whether Site checks ran on the PRs they opened. This decides how much the Dell has to do; if the integrations cover building and reviewing, parts D and E shrink to scheduling and monitoring.

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

4. Store the agents' App ID and private key from A.5 where only the orchestrator (the `agent` user) can read them, for example `~/.config/agents/` with permissions `600`. Delete the downloaded key file.

## D. Sandboxes for the workers

Only needed if step zero shows custom workers are required.

1. Install rootless Docker for the `agent` user (Docker's "Run the Docker daemon as a non-root user" guide), plus the **gVisor runtime (`runsc`)**. gVisor (or a disposable virtual machine) is **required** before any unattended run. Rootless Docker alone is for supervised tests with harmless code only. If gVisor breaks Chromium, put the workers in a small virtual machine instead.
2. Build one worker image per repository type (for this site: Python 3.12, Node 22, Playwright 1.63.0 with Chromium, git, Claude Code, Codex). Pin every version. No credentials in the image.
3. Enforce outbound limits:
    - Workers sit on an internal network whose only exit is an allow-list proxy (for example Squid or tinyproxy).
    - The proxy allows GitHub, the package registries and the AI API hosts.
    - Host firewall rules drop all other outbound traffic from that network, IPv4 and IPv6, including DNS to anything but the proxy.
4. Give each sandbox CPU and memory limits (for example 2 CPUs and 6 GB), and a read-only root with one writable work folder.
5. **Sandbox validation tests**, run inside a worker before going further. Each must fail:
    - reach the router or any `192.168.*` address
    - reach `169.254.169.254`
    - reach a blocked site over IPv4 and over IPv6
    - follow a redirect from an allowed site to a blocked one
    - query an outside DNS server
    - read a file from the host

   And these must work: `git clone` from GitHub, `npm install`, `pip install`, and one AI API call. Measure memory with the browser smoke test running.

## E. AI credentials

The owner's subscription sign-ins never go into a worker: code running in a worker can read anything the worker holds (architecture.md, "AI credentials").

1. **Official integrations** (step zero) connect to your plans through each vendor's own setup on GitHub. Nothing is stored on the Dell.
2. **Your own interactive use** on the Dell: sign in to Claude Code and Codex as yourself, outside the `agent` user and every worker.
3. **Custom unattended workers:**
    - Create one dedicated API key per provider (the Claude Console, and the OpenAI platform) in a separate project or workspace, with a hard monthly spending limit.
    - Store each key where only the orchestrator can read it. The orchestrator passes the key into one run's sandbox as an environment variable, and it is gone when the sandbox is deleted.
    - Revoke and replace a key on any sign of misuse.
4. Before scheduling any unattended runs, check each provider's current terms for that exact pattern. If a provider confirms a subscription credential is allowed for it, it may replace the API key, still injected per run, never stored in an image, never copied or proxied.
5. Confirm the installed versions support the headless options used (`claude -p --help`, `codex exec --help`), and record the versions.

## F. First runs, by hand

1. In a worker container, clone ai-medicine-collective and run the three check commands from AGENTS.md. All should pass.
2. Open a tiny test issue with the **Agent task** template, label it `agent:ready`, and run the loop by hand: Claude in a container, checks in a second container, a draft PR, then the Codex review.
3. Then install the orchestrator (a separate pull request, not written yet) as a systemd user service with a timer, for this one repository, one task at a time. Reboot mid-run once and confirm it recovers.

## Decisions for the owner

- **Step zero results:** how much of the loop GitHub's built-in Claude and Codex integrations cover.
- **Usage after month one:** how much runs on the plans through official integrations, and what the capped worker API keys actually cost.
- **The digest publisher App** (A.4), before the ruleset goes on.
- **Who the clinical reviewer is** for CODEOWNERS.
- **Which repository joins next**, one at a time, once it has an AGENTS.md and working checks.
