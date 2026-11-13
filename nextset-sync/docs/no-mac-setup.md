# Building and installing without a Mac

Everything below happens in a web browser on Windows, plus the TestFlight
app on the iPhone. Apple's tools run on GitHub's macOS machines: GitHub
compiles, signs and uploads the app to TestFlight, and the iPhone installs it
from there. You need a **paid Apple Developer Program membership** (TestFlight
requires one) and a GitHub account.

Time: about 30 minutes once, then about 20 minutes of waiting per new build.

## 1. Give the project its own GitHub repository (once)

GitHub only offers a **Run workflow** button for workflows on a repository's
default branch, and the website repository is the wrong place for app signing
secrets, so the app gets its own repository.

1. github.com → **+** (top right) → **New repository**.
2. Owner **DrZaff**, name **nextset-sync**. Leave it empty: no README,
   no .gitignore, no licence.
3. **Public or private?** GitHub Actions on **public** repositories is free,
   macOS included. On **private** repositories macOS minutes count 10× against
   your plan's monthly Actions minutes; one TestFlight build takes about
   15–20 macOS minutes. Check your plan under **Settings → Billing and
   plans**. The code contains no secrets either way; the signing keys go in
   GitHub's encrypted secrets.
4. Tell Claude (or Codex) the repository exists. They push the `nextset-sync`
   folder as its root, keeping history. To do it yourself instead, from any
   computer with git:
   ```sh
   git clone -b claude/bangle-iphone-workout-sleep-x9j8xy https://github.com/DrZaff/ai-medicine-collective.git
   cd ai-medicine-collective
   git subtree split --prefix nextset-sync -b nextset-sync-only
   git push https://github.com/DrZaff/nextset-sync.git nextset-sync-only:main
   ```

In the new repository, `.github/workflows/ci.yml` builds and tests every push
on GitHub's Mac and Linux machines, and `testflight.yml` uploads a build when
you ask it to.

## 2. Register the app with Apple (once)

1. **App ID.** https://developer.apple.com/account → **Certificates, IDs &
   Profiles** → **Identifiers** → **+** → **App IDs** → **App** →
   Description `NextSet Sync`, Bundle ID **Explicit**
   `com.zaffuto.nextsetsync` (no capabilities to tick) →
   **Continue** → **Register**.
   If that bundle ID is taken, use `com.<yourname>.nextsetsync` and set the
   GitHub variable `BUNDLE_ID` to it in step 4.
2. **App record.** https://appstoreconnect.apple.com → **Apps** → **+** →
   **New App** → iOS, Name `NextSet Sync` (App Store names are unique, so
   add a word if it is taken, e.g. `NextSet Sync Zaffuto`), primary language
   English, Bundle ID the one above, SKU `nextset-sync`, User Access **Full**
   → **Create**. It stays private; nothing is published.
3. **Team ID.** https://developer.apple.com/account → **Membership details**
   → copy **Team ID** (10 characters).

## 3. An API key for GitHub (once)

App Store Connect → **Users and Access** → **Integrations** tab → **App Store
Connect API** → **Team Keys** → **+** (Generate API Key) → name
`GitHub TestFlight`, Access **Admin** → **Generate**.

* **Download** the `.p8` file. Apple lets you download it only once.
* Copy the **Key ID** (in the key's row) and the **Issuer ID** (above the
  list).

Admin is needed because Xcode's cloud signing, run by the workflow, creates
the distribution certificate and provisioning profile for you. Nothing else
in the workflow uses the key, and it is deleted from the build machine after
each run. To revoke it later, use the same page.

## 4. Store the secrets in GitHub (once)

In the **nextset-sync** repository: **Settings → Environments → New
environment** → name `testflight` → **Configure environment**.

* **Environment secrets → Add secret**, three times:
  * `ASC_KEY_ID`: the Key ID
  * `ASC_ISSUER_ID`: the Issuer ID
  * `ASC_KEY_P8`: open the `.p8` in Notepad and paste **all** of it,
    including the first and last lines (the ones made of dashes and words)
* **Environment variables → Add variable**: `APPLE_TEAM_ID` = your Team ID
  (and `BUNDLE_ID` if you changed it in step 2).

## 5. Build and upload (each new version)

1. Repository → **Actions** → **TestFlight** → **Run workflow** → **Run
   workflow**. It runs the tests, archives, signs and uploads (about 15
   minutes). A red X means it failed: open it, and the first error line says
   why (the setup check names any missing secret).
2. App Store Connect → your app → **TestFlight** tab. The new build shows
   **Processing** for 5–30 minutes. No export-compliance question appears:
   the app declares it uses no non-exempt encryption.
3. First time only: **Internal Testing → +** → group name `Me` → add
   yourself as a tester → add the build to the group. Internal testers need
   no Beta App Review.

## 6. Install on the iPhone

1. Install **TestFlight** from the App Store on the iPhone and sign in with
   the same Apple ID.
2. Open the invitation email (or TestFlight shows the app) → **Install**.
3. Later builds show up in TestFlight with an **Update** button. A TestFlight
   build expires after 90 days; run the workflow again for a fresh one.

## Plan B: sideloading the unsigned build (unverified)

Every CI run also produces `NextSetSync-unsigned-ipa` (Actions → the run →
**Artifacts**). Windows sideloading tools such as Sideloadly can sign it with
your Apple ID and install it over USB. Not tested here, and with a free Apple
ID the app expires after 7 days. Use
TestFlight if you can.

## What still needs a person

* The Bluetooth, overnight and vibration checks in
  [first-day-checklist.md](first-day-checklist.md). GitHub's Macs have no
  Bluetooth watch to talk to.
