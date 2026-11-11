# Operations: accounts, owners and renewals

**This is a draft for the owner to complete.** It lists every outside service the
site depends on, who controls each one, where its secrets live, and what
stops working if it is lost. The aim: no part of the site depends on one
person's personal account, and a second organizer could keep everything
running from this page.

Never write a password, key or token on this page. The repository is public.
Secrets go in the shared password manager (see the last section), and this
page only says where they are.

## The services

Fill in the two blank columns. *Login* means the account that owns the
service. *Backup admin* means a second person who can sign in and act if the
owner is unavailable.

| Service | What it does for the site | What breaks without it | Login | Backup admin |
|---|---|---|---|---|
| **GitHub** (`DrZaff/ai-medicine-collective`) | The site's code, every automation (blog drafts, digest, Instagram, backups), and all GitHub secrets | Nothing new can be published, and the automations stop | DrZaff | |
| **Netlify** (site `ai-medicine-collective`) | Hosting, deploy previews, security headers | The site goes offline | | |
| **Porkbun** | Owns `aimedicinecollective.com` and its DNS, including the records Resend needs | The address stops working, and email stops if DNS lapses | | |
| **Supabase** (project `ahwnarhmuzxgjindreuz`) | Accounts, sign-in, every members' table, uploaded files, the timetable (`pg_cron`), Vault secrets | All member features stop. Nothing can be recovered without a backup | | |
| **Google Cloud** (OAuth client) | "Sign in with Google" | Google sign-in stops (email and password sign-in still works) | | |
| **Resend** | All email: sign-in codes, inbox alerts, meeting confirmations, the digest, action emails | No sign-in codes, so password sign-ups and resets stop | | |
| **Cloudflare** (Turnstile) | The bot check on the email sign-in forms | Those forms are refused once captcha enforcement is on | | |
| **Formspree** | Emails the organizers when someone asks to join | New join requests aren't announced (they still appear on the Moderation page) | | |
| **Anthropic** (API key) | Blog drafts, the AI vs Physician paper, the deep sweep | No new drafts, and the jobs skip quietly | | |
| **Meta** (Instagram @aimedicinecollective and its Meta app) | Posts each briefing and edition to Instagram | Posts stop (the site is unaffected) | | |
| **Agent server** (the Dell, see `docs/agents/dell-setup.md`) | The supervised agent pilot | Only the pilot stops | | |

## Where each secret lives

| Secret | Where it lives | Used by | Expires? |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | GitHub > Settings > Secrets > Actions | blog, living review, deep sweep | No (revoke if leaked) |
| `RESEND_API_KEY`, `NOTIFY_EMAIL` | GitHub Actions secrets | action emails from every workflow | No |
| `IG_ACCESS_TOKEN` | GitHub Actions secret | Instagram posting | After 60 days, but renewed every Monday by `instagram-token.yml` |
| `IG_USER_ID` (optional) | GitHub Actions secret | Instagram posting, when the account id can't be read from the token | No |
| `SECRETS_WRITE_TOKEN` | GitHub Actions secret | lets the Instagram renewal store a new token | **Yes**, on the date set when it was made |
| `DIGEST_APP_ID`, `DIGEST_APP_PRIVATE_KEY` | GitHub environment `digest-publish` | the Friday digest job's push to `main` | No |
| `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE` | GitHub environment `db-backup` | nightly backup (`docs/backups.md`) | The URL changes if the database password is reset |
| `resend_api_key` | Supabase Vault | inbox alerts, meeting emails, digest sending | No |
| `github_actions_token` | Supabase Vault | the database's timetable starting the GitHub jobs | **Yes**: when it lapses, the jobs quietly fall back to GitHub's late schedule |
| Resend SMTP password | Supabase > Authentication > SMTP | sign-in codes | No |
| Turnstile secret key | Supabase > Authentication > Attack Protection | captcha check | No |
| Google client secret | Supabase > Authentication > Providers > Google | Google sign-in | Check in Google Cloud |
| Database password | Nowhere in the site. Only in the password manager and `SUPABASE_DB_URL` | backups, rebuilds | No |

The publishable Supabase key, the Turnstile site key and the Formspree form
address are public by design and live in the site's code.

## Renewal calendar

Put these dates in a shared calendar, with a reminder two weeks before each.

- **Domain** (Porkbun): renews yearly. Turn on auto-renew and keep a card on file
  that won't expire first. Date: ____
- **`github_actions_token`** (fine-grained token): expires on ____. Renewal steps
  are in `docs/auth-setup.md`, under "Starting the jobs on time".
- **`SECRETS_WRITE_TOKEN`**: expires on ____. Make a new one with the same
  single permission and replace the secret.
- **Backup test**: every three months, download a recent backup and open it as
  in `docs/backups.md`. A backup nobody has opened isn't a backup yet.
- **Free plan limits**: check twice a year.
  - Resend: 100 emails a day and 3,000 a month; the digest cap is in `email_settings`.
  - Supabase: 500 MB database and 1 GB of files, and the project pauses after a week with no activity.
  - Netlify: build minutes.

## Adding a second organizer

1. **Password manager.** Make a shared vault (for example 1Password or
   Bitwarden) and store every login and secret from this page in it.
2. **GitHub.** Move the repository into a GitHub organization (Settings >
   Danger zone > Transfer) owned by two people, or add the second organizer as
   a collaborator with the Maintain role. Links to the old address redirect
   automatically. The Netlify connection, secrets and Actions move with it,
   but check Netlify's repository link afterwards.
3. **Netlify.** Team settings > Members > invite as Owner.
4. **Supabase.** Organization > Team > invite as Owner. On the site, make
   them an admin through `set_member_role` on the Moderation page.
5. **Porkbun.** Porkbun has no shared access, so record the login in the vault
   and turn on two-factor authentication with a method both people can reach.
6. **Resend, Cloudflare, Formspree, Google Cloud, Anthropic.** Invite the
   second person as a team member or admin where the service allows it.
   Otherwise, keep the login in the vault.
7. **Meta.** Add them as an admin of the Instagram account and as a developer
   on the Meta app.

## If someone steps away

- Remove their access everywhere above, and change their role on the
  Moderation page.
- Rotate any secret they could have copied: the database password (then
  update `SUPABASE_DB_URL`), API keys they made, and the backup passphrase if
  they held it. Old backups stay encrypted with the old passphrase, so keep
  that passphrase in the vault until those backups expire after 30 days.
- Update the Login and Backup admin columns above.

## Contact address

The site's contact and corrections address is currently a personal one
(`CORRECTIONS_EMAIL` in `script.js`, plus the privacy, terms and corrections
pages). Next step: set up free email forwarding at Porkbun (for example
`hello@aimedicinecollective.com` forwarding to two organizers), then replace
the personal address everywhere in one pull request.
