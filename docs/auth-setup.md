# Google login setup (Supabase + Google Cloud)

One-time setup for **Roadmap phase 2** (members-only Google sign-in). An admin
does this by hand. Developers and Claude never create these accounts or handle
the secrets.

- **Time:** about 20–30 minutes
- **Sites used:** Supabase and Google Cloud, switching back and forth once
- **Site address:** `https://ai-medicine-collective.netlify.app`. If the site gets a
  custom domain, add it everywhere that address appears below.

Menu names on both sites shift from time to time. If a label doesn't match
exactly, look for the closest one.

Keep a private note open (a password manager is ideal) for anything marked 🔒.
**Never paste 🔒 items into chat, issues, pull requests, or this repo.**

---

## Part 1: Create the Supabase project

1. Go to **https://supabase.com** and click **Start your project**.
2. Choose **Continue with GitHub** and sign in as the repo owner (**DrZaff**).
3. If asked to create an organization, name it (e.g. `DrZaff`), choose
   **Personal**, and pick the **Free** plan.
4. Click **New project** and fill in:
   - **Name:** `ai-medicine-collective`
   - **Database password:** click **Generate a password** and save it in your
     private note. 🔒 Keep it; don't share it.
   - **Region:** **East US (North Virginia)**
   - **Plan:** Free
5. Click **Create new project** and wait 1–2 minutes.

### 1b. Copy the callback address (needed in Part 2)

6. In the left sidebar, click **Authentication**, then **Sign In / Providers**.
7. Scroll to **Google** and click it. **Don't turn it on yet.**
8. Copy the **Callback URL (for OAuth)**. It looks like
   `https://abcdefghijkl.supabase.co/auth/v1/callback`. It isn't secret.
9. Leave this tab open and go to Part 2.

---

## Part 2: Create the Google login client

1. In a new tab, go to **https://console.cloud.google.com** and sign in with the
   Google account that should own the login setup.
2. If this is your first time, accept the terms.
3. **Create a project:** click the project picker at the top left, then
   **New project**.
   - **Name:** `AI Medicine Collective`
   - Click **Create**, then make sure the new project is selected at the top.
4. Search for **Google Auth Platform** in the top search bar and open it
   (older name: **OAuth consent screen**).
5. Click **Get started** and fill in:
   - **App name:** `AI Medicine Collective`
   - **User support email:** your email
   - **Audience:** **External** (members sign in with their own Google accounts)
   - **Contact email:** your email
   - Agree to the policy and click **Create**.
6. **Skip the logo.** Uploading one triggers a Google review that can take weeks.
7. In the left menu, click **Audience**, then **Publish app**, and confirm.
   - In "Testing" mode only people you list by hand can sign in. Publishing lets
     any member sign in.
   - The site only asks for name and email, so Google doesn't require a review.
8. In the left menu, click **Clients**, then **Create client**:
   - **Application type:** **Web application**
   - **Name:** `Supabase login`
   - **Authorized JavaScript origins:** add
     - `https://ai-medicine-collective.netlify.app`
     - `http://localhost:8000` (local testing)
   - **Authorized redirect URIs:** add the **Supabase callback URL** from
     Part 1, step 8.
   - Click **Create**.
9. A box shows two values:
   - **Client ID**, ending in `.apps.googleusercontent.com`. Not secret.
   - 🔒 **Client secret.** **Copy it now.** Google may not show it again, so
     click **Download JSON** as a backup and keep it private.

---

## Part 3: Connect Google to Supabase

1. Back in Supabase: **Authentication → Sign In / Providers → Google**.
2. Turn **Enable Sign in with Google** on.
3. Paste the **Client ID** into **Client IDs**.
4. Paste the 🔒 **Client secret** into **Client Secret**. This is the only
   place it ever goes.
5. Click **Save**.

### 3b. Allow the site's addresses

6. Under **Authentication**, click **URL Configuration**.
7. Set **Site URL** to `https://ai-medicine-collective.netlify.app`.
8. Under **Redirect URLs**, click **Add URL** and add each of these, one at a time:
   - `https://ai-medicine-collective.netlify.app/**`
   - `https://deploy-preview-*--ai-medicine-collective.netlify.app/**`
     (lets the preview site for each pull request use login)
   - `http://localhost:8000/**` (local testing)
9. Click **Save**.

---

## Part 4: Hand off the two public values

1. In Supabase, open **Project Settings** (gear icon, bottom left), then
   **API Keys** (on some versions: **API** or **Data API**).
2. Copy:
   - **Project URL**, e.g. `https://abcdefghijkl.supabase.co`
   - **Publishable key** (starts with `sb_publishable_`), or, if that's all
     that's shown, the **anon public** key (a long string starting with `eyJ`)
3. Give these two values to whoever is building the site. They're designed to
   be public: every visitor's browser uses them, so they go in the site's code.
   Security comes from the database's row-level security rules, not from
   hiding these keys.

## 🔒 Never share these

| Item | Where it lives |
|---|---|
| Supabase **secret key** (`sb_secret_…`) or **service_role** key | Stays in Supabase. If server code ever needs it, it goes into Netlify's private environment variables, never the repo. |
| Supabase **database password** | Admin's password manager |
| Google **client secret** | Only in Supabase (Part 3) and the admin's password manager |

If one of these is ever pasted somewhere by accident (chat, a commit, an issue),
treat it as leaked: **create a new one and replace the old one right away.**
Deleting the message or commit is not enough (see CLAUDE.md, Rule 2).

---

## Part 5: Create the member tables

The database starts empty. Each file in `supabase/migrations/` is run **once,
in number order**, by an admin:

1. Open the file on GitHub (for example
   `supabase/migrations/001_profiles_and_roles.sql`), click **Raw**, and copy
   everything.
2. In Supabase, open **SQL Editor** (left sidebar), click **New query**, and
   paste.
3. Click **Run**. It should say **Success. No rows returned.**

If it shows an error, don't run it again. Copy the error message to whoever is
building the site.

### Make yourself the first admin

Everyone who signs in starts as `pending`, including you. After you have signed
in to the site with Google **once**, run this in the SQL Editor, with your own
Google email:

```sql
update public.profiles
   set role = 'admin', approved_at = now()
 where email = 'you@example.com';
```

It should say **Success** and report 1 row. From then on, approve members and
change roles from the site's moderator page, not from SQL.

### Turn off email-and-password sign-up

The site only offers Google sign-in. In Supabase, go to **Authentication →
Sign In / Providers → Email** and turn **Enable Email provider** off, so nobody
can create an account another way.

---

## Checklist

- [ ] Supabase project `ai-medicine-collective` created
- [ ] Google Cloud project created, app **published**, web client created
- [ ] Client ID and secret saved in Supabase, Google provider turned **on**
- [ ] Site URL and the 3 redirect URLs added in Supabase
- [ ] Project URL and publishable/anon key handed to the developer
- [ ] Email provider turned **on** (added 2026-10-05 for sign-in by emailed code; see "Email" below)
- [ ] Migration files run in the SQL Editor, in order
- [ ] First admin set (after signing in once)

## Troubleshooting

- **"redirect_uri_mismatch" from Google:** the redirect URI in Google Cloud
  (Part 2, step 8) must exactly match Supabase's callback URL. Check for a
  missing `/auth/v1/callback` or a typo.
- **Sign-in works but sends you to the wrong page:** check the Site URL and
  Redirect URLs in Supabase (Part 3b).
- **Only some people can sign in:** the Google app is probably still in
  "Testing". Publish it (Part 2, step 7).

## Email (added October 2026)

The site sends email through Resend from `mail.aimedicinecollective.com`
(domain registered at Porkbun; four DNS records there, shown on Resend's
Domains page).

- **Sign-in codes:** Supabase > Authentication > Emails > SMTP Settings uses
  Resend (host `smtp.resend.com`, port `465`, username `resend`, password = a
  Resend key with sending access). The "Magic link or OTP" and "Confirm sign
  up" templates show `{{ .Token }}` and deliberately contain **no link**:
  mail scanners open links, which uses up the one-time code.
- **Emails the database sends itself** (inbox alerts, migration 011): a second
  Resend key stored in Supabase Vault under the exact name `resend_api_key`.
  Create the key in Resend (sending access, limited to the mail domain), then
  add it in the Supabase dashboard's Vault page, or run this once in the SQL
  Editor with your key in place of the placeholder (do not save the query):
  `select vault.create_secret('PASTE-KEY-HERE', 'resend_api_key');`
- **If alerts don't arrive:** in the SQL Editor run
  `select id, status_code, error_msg, created from net._http_response order by created desc limit 5;`
  A `200` means Resend accepted it; anything else says why not.
- Keys never go in the repo or in chat. To replace one, delete it in Resend,
  create a new one, and update it where it is stored.

## Site address (changed October 2026)

The site now lives at `https://www.aimedicinecollective.com`. In Supabase >
Authentication > URL Configuration, the **Site URL** is that address, and the
**Redirect URLs** list includes `https://www.aimedicinecollective.com/**` and
`https://aimedicinecollective.com/**` alongside the netlify entries above
(keep those: the old address and deploy previews still use them). Without
these entries, signing in from the new address sends people back to the old one.

## Passwords (added October 2026)

People can sign in with Google, or with their email and a password. This uses
the Email provider that is already on; nothing else needs switching on.
Recommended in Supabase > Authentication > Sign In / Providers > Email: set
the minimum password length to 10 to match the site, and leave "Confirm email"
on. New password accounts are confirmed with the emailed code, and a forgotten
password is handled by emailing a sign-in code, so the "Reset password" email
template is never used.

## Bot check (Cloudflare Turnstile)

Stops scripts from guessing passwords. Two keys from a free Cloudflare
account (Turnstile > Add widget; hostnames `aimedicinecollective.com` and
`ai-medicine-collective.netlify.app`; mode Managed):

- **Site key** (public): `TURNSTILE_SITE_KEY` in `auth.js`.
- **Secret key**: Supabase > Authentication > Attack Protection > enable
  CAPTCHA protection, provider Turnstile, paste the secret. Never in the
  repo or in chat.

Order matters: put the site key in the code and deploy it **before** turning
protection on in Supabase. Protection on with no site key in the code would
block every email sign-in (Google would still work). To switch the check off,
turn protection off in Supabase first, then empty the site key.
