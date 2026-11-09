# Database backups

The free Supabase plan keeps no backups. `.github/workflows/db-backup.yml`
makes one every night (about 4:37 AM Eastern). It encrypts the backup and
keeps it for 30 days as a download on the run's page (Actions > Database
backup > a run > Artifacts). If a run fails, the organizers get an email.

What a backup holds:

- **public**: every table the site uses (profiles, tools, comments, chat,
  messages, requests, meetings, reports and so on);
- **auth**: the accounts, so members can still sign in after a restore;
- **storage**: the *list* of uploaded files, not the files themselves.

Uploaded files (the `project-files` bucket) are not in it. Until that is
automated, an admin can download the bucket from Supabase > Storage now and
then. The tools' code lives in its own places, and the site itself is this
repository.

## Set it up (once, about 10 minutes)

1. **Connection string.** Supabase > your project > **Connect** (top of the
   page) > **Session pooler** > copy the URI. It looks like
   `postgresql://postgres.ahwnarhmuzxgjindreuz:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`.
   Put the database password in place of `[YOUR-PASSWORD]`. If you don't have
   it, reset it under Project Settings > Database (nothing on the site uses
   it). Use the *Session pooler*, not the *Direct connection*: GitHub's
   machines can't reach the direct one.
2. **Passphrase.** Make a long random one (a password manager's generator,
   30+ characters). Store it in the organizers' shared password manager
   **before** anything else: without it no backup can be opened, and nobody
   can recover it.
3. **GitHub.** Settings > Environments > **New environment** named
   `db-backup`. Under *Deployment branches and tags* choose
   *Selected branches and tags* and add `main`. Leave *Required reviewers*
   off, or the nightly run will wait for someone to approve it. Add two
   environment secrets: `SUPABASE_DB_URL` (step 1) and `BACKUP_PASSPHRASE`
   (step 2).
4. Actions > **Database backup** > Run workflow. It should finish in a minute
   or two with an artifact named `db-backup-<date>`.

The repository is public, so anyone signed in to GitHub can download the
artifact. It is encrypted (AES-256) and useless without the passphrase.

## Open a backup

On a computer with `gpg` and PostgreSQL 17's tools (`pg_restore`, `psql`):

```sh
unzip db-backup-2026-11-09.zip
gpg --decrypt --output amc.dump amc-2026-11-09.dump.gpg   # asks for the passphrase
pg_restore --list amc.dump | less                          # what is inside
```

## Get back something deleted by mistake

The usual case: a tool, a topic or a person's messages were removed and
should come back. Restore the backup into a scratch database on your own
computer, find the rows, and copy them back with a small `insert` in the
Supabase SQL Editor:

```sh
createdb amc_scratch
pg_restore --no-owner --no-privileges --dbname=amc_scratch amc.dump
psql amc_scratch -c "select * from public.projects where title ilike '%sepsis%'"
```

Deleted rows can't break anything else when copied back, as long as their
author's profile still exists. Never paste patient information anywhere while
doing this.

## Rebuild everything in a new Supabase project

If the project itself is lost:

1. Create a new project. Set up sign-in, email, Vault secrets and the cron
   jobs again from `docs/auth-setup.md` (the backup holds data, not those
   settings).
2. Restore in this order (the connection string is the new project's
   Session pooler URI):

   ```sh
   pg_restore --no-owner --no-privileges --data-only --schema=auth    --dbname="$NEW_DB_URL" amc.dump
   pg_restore --no-owner --no-privileges              --schema=public --dbname="$NEW_DB_URL" amc.dump
   pg_restore --no-owner --no-privileges --data-only --schema=storage --dbname="$NEW_DB_URL" amc.dump
   ```

   Accounts first (data only: Supabase creates those tables itself), then
   the site's tables in full, then the list of files.
3. Re-run the `grant` statements: `--no-privileges` leaves them out. Running
   each migration's grants (or the migrations' `grant ...` lines) restores
   them.
4. Point the site at the new project: its address and publishable key in
   `auth.js` (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_STORAGE_KEY`),
   `script.js`, `games/bearcat-pinball.html` and `netlify.toml` (the security
   headers name the Supabase host). Then upload the files from your bucket copy.

This order was tested on 2026-11-09 with a local copy of PostgreSQL
(accounts, profiles and chat all came back). It has not yet been tried
against a real second Supabase project: do that once, on a free scratch
project, before relying on it.
