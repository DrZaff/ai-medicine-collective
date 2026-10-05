// === AI Medicine Collective: sign-in, account page, moderation page ===
//
// Loaded only on account.html and moderate.html, after the Supabase library.
// The URL and publishable key below are public by design (every visitor's
// browser uses them). What people can read or change is decided by the
// database's row-level-security rules (supabase/migrations/), not by this file.

const SUPABASE_URL = "https://ahwnarhmuzxgjindreuz.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_3C4xXn0j3GiunX-t6cd0HQ_ze_yTErT";

// Where the session is kept in localStorage. script.js checks for the same
// key (its AUTH_STORAGE_KEY) to relabel the SIGN IN link on pages that don't
// load the Supabase library, so keep the two values identical. The names
// differ because both files load on this page and share one global scope.
const SUPABASE_STORAGE_KEY = "sb-ahwnarhmuzxgjindreuz-auth-token";

// script.js reads this (its MEMBER_ROLE_HINT_KEY) to show the Members area
// links on pages that don't load the Supabase library. Keep the two identical.
const ROLE_HINT_STORAGE_KEY = "amc-member-role";

function rememberRole(role) {
  try {
    if (role) localStorage.setItem(ROLE_HINT_STORAGE_KEY, role);
    else localStorage.removeItem(ROLE_HINT_STORAGE_KEY);
  } catch {
    // localStorage unavailable: the links just won't show
  }
  window.dispatchEvent(new Event("amc-role-changed"));
}

// Number of unread inbox messages, saved the same way so the Members area
// row can show "INBOX (2)" on any page. script.js reads MEMBER_UNREAD_HINT_KEY.
const UNREAD_HINT_STORAGE_KEY = "amc-unread";

function rememberUnread(count) {
  try {
    if (count > 0) localStorage.setItem(UNREAD_HINT_STORAGE_KEY, String(count));
    else localStorage.removeItem(UNREAD_HINT_STORAGE_KEY);
  } catch {
    // localStorage unavailable: the count just won't show
  }
  window.dispatchEvent(new Event("amc-role-changed"));
}

// Looked up in the background after the profile loads; never blocks the page.
async function refreshUnread(userId) {
  const { count, error } = await db
    .from("project_messages")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", userId)
    .is("read_at", null);
  if (!error) rememberUnread(count || 0);
}

const CONTACT_EMAIL = "zaffutbn@ucmail.uc.edu";
const ROLE_LABELS = {
  pending: "PENDING",
  rejected: "DECLINED",
  member: "MEMBER",
  moderator: "MODERATOR",
  admin: "ADMIN",
};
const APPROVED_ROLES = ["member", "moderator", "admin"];

// "About you" details (table join_details). These lists must match the
// CHECK constraints in supabase/migrations/002_join_details.sql.
const TRAINING_ROLES = [
  "Medical student",
  "Resident / Fellow",
  "Attending / Faculty",
  "Other healthcare professional",
  "Other",
];
const INTERESTS = [
  ["Medical education", "Med ed"],
  ["Patient care", "Patient care"],
  ["Research", "Research"],
  ["Guidelines", "Guidelines"],
  ["Lifestyle", "Lifestyle"],
  ["Learning AI skills", "Learning AI"],
];

// New requests also email the organizers through the same Formspree form the
// old join page used, so nobody has to keep checking the moderation page.
const REQUEST_NOTIFY_URL = "https://formspree.io/f/mqaonqpr";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { storageKey: SUPABASE_STORAGE_KEY, flowType: "pkce" },
});

/* ========= small DOM helpers (text only, never HTML from data) ========= */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function button(label, className, onClick) {
  const btn = el("button", className, label);
  btn.type = "button";
  btn.addEventListener("click", onClick);
  return btn;
}

function roleTag(role) {
  return el("span", `member-tag role-tag role-${role}`, ROLE_LABELS[role] || role);
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function avatar(profile) {
  const url = profile.avatar_url || "";
  if (url.startsWith("https://")) {
    const img = el("img", "account-avatar");
    img.src = url;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    return img;
  }
  const initials = (profile.full_name || profile.email || "?")
    .split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return el("span", "member-avatar", initials);
}

// The site's public address, for links that get copied out of the site
// (citations). Deploy previews and localhost would otherwise leak into CVs.
const SITE_ORIGIN = "https://ai-medicine-collective.netlify.app";

// One line a member can paste into a CV. `item` needs id, kind, title, created_at.
function citationFor(item, author) {
  const isMaterial = item.kind === "material";
  const year = new Date(item.created_at).getFullYear();
  return `${author || "AI Medicine Collective"}. ${item.title}. AI Medicine Collective ` +
    `${isMaterial ? "Learning Materials" : "Projects Hub"}; ${year}. ` +
    `${SITE_ORIGIN}/${isMaterial ? "learn" : "hub"}.html?project=${item.id}`;
}

// A button that copies text (copyText lives in script.js, loaded on every page)
function copyButton(label, getText) {
  const btn = button(label, "hub-tab copy-btn", async () => {
    try {
      await copyText(getText());
      btn.textContent = "COPIED";
    } catch {
      btn.textContent = "COPY FAILED";
    }
    setTimeout(() => { btn.textContent = label; }, 1500);
  });
  return btn;
}

// Placeholder shown while a page loads. It takes up roughly the room the
// content will, so the page doesn't jump when the content arrives.
function loadingBlock(label) {
  const wrap = el("div", "loading");
  wrap.setAttribute("role", "status");
  wrap.append(el("p", "loading-label", label || "> LOADING..."));
  for (let i = 0; i < 3; i++) {
    const bar = el("div", "loading-bar");
    bar.setAttribute("aria-hidden", "true");
    wrap.append(bar);
  }
  return wrap;
}

// "Nothing here yet", with a next step when there is one
function emptyState(title, text, linkText, href) {
  const wrap = el("div", "empty-state");
  wrap.append(el("p", "empty-state-title", title));
  if (text) wrap.append(el("p", "empty-state-text", text));
  if (linkText && href) {
    const link = el("a", "btn", linkText);
    link.href = href;
    wrap.append(link);
  }
  return wrap;
}

async function getSessionAndProfile() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    rememberRole(null);
    rememberUnread(0);
    return { session: null, profile: null };
  }

  const { data: profile, error } = await db
    .from("profiles")
    .select("id, full_name, avatar_url, role, created_at")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error) throw error;
  // The profiles table doesn't hand out email addresses (migration 006);
  // a person's own email comes from their sign-in session.
  if (profile) profile.email = session.user.email;
  rememberRole(profile ? profile.role : null);
  if (profile && APPROVED_ROLES.includes(profile.role)) refreshUnread(profile.id).catch(() => {});

  // details: the row, null if not filled in yet, or undefined if it couldn't
  // be read (then the form is simply not offered).
  let details;
  if (profile) {
    const result = await db
      .from("join_details")
      .select("training_role, program, interests, message")
      .eq("user_id", session.user.id)
      .maybeSingle();
    details = result.error ? undefined : result.data;
  }
  return { session, profile, details };
}

function signInWithGoogle() {
  // Come back to the account page on whatever site we're on
  // (live site, a deploy preview, or localhost).
  const redirectTo = new URL("account.html", window.location.href).href;
  return db.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
}

/* ========= ACCOUNT PAGE ========= */

function initAccountPage() {
  const app = document.getElementById("account-app");
  if (!app) return;

  const show = (...nodes) => app.replaceChildren(...nodes);

  function renderSignedOut(message) {
    const panel = el("div", "account-panel");
    if (message) panel.append(el("p", "account-status is-error", message));
    panel.append(
      el("p", null, "Sign in with your Google account, or with a code we email you. No password to remember."),
      button("> SIGN IN WITH GOOGLE", "signin-btn", async (e) => {
        e.currentTarget.disabled = true;
        const { error } = await signInWithGoogle();
        if (error) renderSignedOut("> SIGN-IN FAILED. Please try again.");
      }),
      el("p", "signin-or", "// or"),
      emailSignIn()
    );
    const note = el("p", "note");
    note.append(
      "// First time here? Signing in sends a membership request to our moderators. " +
      "With Google we receive only your name, email and profile picture; with a code, only your email. See the "
    );
    const link = el("a", null, "privacy policy");
    link.href = "privacy.html";
    note.append(link, ".");
    panel.append(note);
    show(panel);
  }

  // Sign in without Google: we email a one-time code, the person types it in.
  // (The email also carries a link, which works when it's opened in the same
  // browser that asked for it.) Sent by Supabase through the Collective's
  // own mail domain.
  function emailSignIn() {
    const wrap = el("div", "signin-email");
    const status = el("p", "join-status");
    status.setAttribute("role", "status");
    const say = (text, isError) => {
      status.textContent = text;
      status.classList.toggle("is-error", !!isError);
    };

    const askForm = el("form", "signin-email-form");
    const email = el("input", "join-input");
    email.id = "signin-email";
    email.type = "email";
    email.required = true;
    email.maxLength = 254;
    email.autocomplete = "email";
    email.placeholder = "you@example.com";
    const emailLabel = el("label", "join-label", "Email");
    emailLabel.htmlFor = email.id;
    const send = el("button", "join-submit", "> Email me a code");
    send.type = "submit";
    askForm.append(emailLabel, email, send);

    const codeForm = el("form", "signin-email-form");
    codeForm.hidden = true;
    const code = el("input", "join-input signin-code");
    code.id = "signin-code";
    code.type = "text";
    code.inputMode = "numeric";
    code.autocomplete = "one-time-code";
    code.required = true;
    code.maxLength = 16; // room for spaces when pasted
    code.placeholder = "code from the email";
    const codeLabel = el("label", "join-label", "Code");
    codeLabel.htmlFor = code.id;
    const verify = el("button", "join-submit", "> Sign in");
    verify.type = "submit";
    const restart = button("Use a different email", "hub-tab", () => {
      codeForm.hidden = true;
      askForm.hidden = false;
      say("");
      email.focus();
    });
    codeForm.append(codeLabel, code, verify, restart);

    let address = "";
    askForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      address = email.value.trim();
      if (!address) return;
      send.disabled = true;
      say("> SENDING...");
      const { error } = await db.auth.signInWithOtp({
        email: address,
        options: { emailRedirectTo: new URL("account.html", window.location.href).href },
      });
      send.disabled = false;
      if (error) {
        console.error(error);
        say(error.status === 429
          ? "> TOO MANY TRIES. Please wait a minute and try again."
          : "> COULD NOT SEND THE CODE. Check the address, or use Google sign-in.", true);
        return;
      }
      askForm.hidden = true;
      codeForm.hidden = false;
      say(`> CODE SENT to ${address}. It can take a minute; check spam too.`);
      code.focus();
    });

    codeForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const token = code.value.replace(/\D/g, "");
      if (token.length < 6) return say("> ENTER THE CODE FROM THE EMAIL (digits only).", true);
      verify.disabled = true;
      say("> CHECKING...");
      const { error } = await db.auth.verifyOtp({ email: address, token, type: "email" });
      verify.disabled = false;
      if (error) {
        console.error(error);
        say("> THAT CODE DIDN'T WORK. It may have expired; ask for a new one.", true);
        return;
      }
      await refresh();
    });

    wrap.append(askForm, codeForm, status);
    return wrap;
  }

  async function renderSignedIn(session, profile, details) {
    const panel = el("div", "account-panel");

    if (!profile) {
      panel.append(
        el("p", "account-status is-error", "> ACCOUNT NOT SET UP"),
        el("p", null, `You're signed in as ${session.user.email}, but your member record is missing. Please email ${CONTACT_EMAIL}.`)
      );
    } else {
      const head = el("div", "account-head");
      const who = el("div", "account-who");
      who.append(
        el("span", "account-name", profile.full_name || profile.email),
        el("span", "account-email", profile.email)
      );
      head.append(avatar(profile), who, roleTag(profile.role));
      panel.append(head);

      if (profile.role === "pending" && details === null) {
        panel.append(
          el("p", "account-status", "> ONE MORE STEP"),
          el("p", null, "You're signed in. Tell us a little about yourself below so a moderator can review your request.")
        );
      } else if (profile.role === "pending") {
        panel.append(
          el("p", "account-status", "> ACCESS PENDING"),
          el("p", null, "Your request is with our moderators. Member features unlock once you're approved; check back here to see your status.")
        );
      } else if (profile.role === "rejected") {
        panel.append(
          el("p", "account-status is-error", "> REQUEST DECLINED"),
          el("p", null, `Your membership request was not approved. If you think this is a mistake, email ${CONTACT_EMAIL}.`)
        );
      } else {
        panel.classList.add("account-panel--wide");
        const firstName = (profile.full_name || "").trim().split(/\s+/)[0];
        panel.append(
          el("p", "account-status", firstName ? `> WELCOME BACK, ${firstName.toUpperCase()}` : "> WELCOME BACK"),
          gettingStarted(profile),
          dashboard(profile)
        );
      }

      if (profile.role !== "rejected") {
        if (details !== undefined) panel.append(detailsForm(profile, details));
        panel.append(await profileForm(profile, details));
      }
    }

    panel.append(
      button("SIGN OUT", "account-signout", async () => {
        await db.auth.signOut();
        rememberRole(null);
        rememberUnread(0);
        renderSignedOut();
      })
    );
    show(panel);
    // Arriving from "EDIT MY PROFILE": the form didn't exist when the page loaded
    if (window.location.hash === "#profile") {
      const target = document.getElementById("profile");
      if (target) target.scrollIntoView();
    }
  }

  // "Getting started": four small first steps. Shown until they're all done
  // or the member hides it (remembered on this device only).
  function gettingStarted(profile) {
    const HIDE_KEY = "amc-onboarding-hidden";
    const TOOL_USED_KEY = "amc-tool-used"; // set by the Tools page (script.js)
    const read = (key) => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    };

    const wrap = el("section", "onboard");
    wrap.hidden = true;
    if (read(HIDE_KEY)) return wrap;

    const has = async (query) => {
      const { count: n, error } = await query;
      return !error && n > 0;
    };
    const steps = [
      ["Fill in your profile", "#profile", async () => {
        const { data } = await db.from("profiles").select("bio, focus_areas").eq("id", profile.id).maybeSingle();
        return !!data && !!(data.bio || data.focus_areas);
      }],
      ["Try a tool", "tools.html", async () => !!read(TOOL_USED_KEY)],
      ["Say hello in chat", "chat.html", () => has(
        db.from("chat_messages").select("id", { count: "exact", head: true }).eq("author_id", profile.id))],
      ["Vote on a tool request, or post your own", "requests.html", async () =>
        (await has(db.from("tool_request_votes").select("request_id", { count: "exact", head: true }).eq("user_id", profile.id)))
        || (await has(db.from("tool_requests").select("id", { count: "exact", head: true }).eq("author_id", profile.id)))],
    ];

    (async () => {
      const done = await Promise.all(steps.map(([, , check]) => check().catch(() => false)));
      const finished = done.filter(Boolean).length;
      if (finished === steps.length) return; // nothing left to do: stay hidden

      const list = el("ul", "onboard-list");
      steps.forEach(([label, href], i) => {
        const li = el("li", done[i] ? "is-done" : null);
        const link = el("a", null, label);
        link.href = href;
        if (href === "#profile") {
          link.addEventListener("click", () => {
            const target = document.getElementById("profile");
            if (target) target.open = true;
          });
        }
        li.append(el("span", "onboard-box", done[i] ? "[x]" : "[ ]"), link);
        list.append(li);
      });

      wrap.append(
        el("h3", "subsection-title", `// Getting started (${finished} of ${steps.length})`),
        list,
        button("Hide this", "hub-tab onboard-hide", () => {
          try {
            localStorage.setItem(HIDE_KEY, "1");
          } catch {
            // it will simply come back next time
          }
          wrap.hidden = true;
        })
      );
      wrap.hidden = false;
    })();
    return wrap;
  }

  // Member home: one card per area, each filled in the background with a
  // live number. A card that can't load its number still works as a link.
  function dashboard(profile) {
    const wrap = el("div", "dash");
    const grid = el("div", "dash-grid");
    const isMod = profile.role === "moderator" || profile.role === "admin";

    const card = (title, href, hint) => {
      const link = el("a", "dash-card");
      link.href = href;
      const value = el("span", "dash-value", "…");
      const note = el("span", "dash-note", hint);
      link.append(el("span", "dash-title", title), value, note);
      grid.append(link);
      return { link, value, note };
    };
    const count = (query) => query.then(({ count: n, error }) => (error ? null : n || 0));
    const fill = async (target, work) => {
      try {
        await work();
      } catch (err) {
        console.error(err);
        target.value.textContent = "—";
      }
    };

    const inbox = card("// Inbox", "inbox.html", "private messages");
    const mine = card("// My submissions", "hub.html?view=mine", "projects and materials");
    const chat = card("// Chat", "chat.html", "latest message");
    const people = card("// Directory", "directory.html", "members");
    const requests = card("// Requests", "requests.html", "open tool requests");
    const hub = card("// Projects hub", "hub.html", "published projects");
    const learn = card("// Learning", "learn.html", "published materials");
    const mod = isMod ? card("// Moderation", "moderate.html", "waiting for review") : null;

    fill(inbox, async () => {
      const n = await count(db.from("project_messages").select("id", { count: "exact", head: true })
        .eq("recipient_id", profile.id).is("read_at", null));
      inbox.value.textContent = n === null ? "—" : String(n);
      inbox.note.textContent = n === 1 ? "unread message" : "unread messages";
      if (n > 0) inbox.link.classList.add("dash-card--alert");
    });

    const attention = el("div", "dash-attention");
    fill(mine, async () => {
      const { data, error } = await db.from("projects")
        .select("id, kind, title, status, created_at")
        .eq("author_id", profile.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const by = (status) => data.filter((p) => p.status === status).length;
      mine.value.textContent = String(data.length);
      mine.note.textContent = data.length
        ? `${by("published")} published · ${by("pending")} in review · ${by("rejected")} not approved`
        : "nothing submitted yet";

      // Anything still waiting, or sent back, is listed under the cards
      const open = data.filter((p) => p.status !== "published").slice(0, 5);
      if (open.length) {
        attention.append(el("h3", "subsection-title", "// Your items in progress"));
        const list = el("ul", "dash-list");
        for (const item of open) {
          const li = el("li");
          const link = el("a", null, item.title);
          link.href = `${item.kind === "material" ? "learn.html" : "hub.html"}?project=${encodeURIComponent(item.id)}`;
          li.append(link, el("span", `member-tag status-${item.status}`,
            item.status === "pending" ? "IN REVIEW" : "NOT APPROVED"));
          list.append(li);
        }
        attention.append(list);
      }
    });

    fill(chat, async () => {
      const { data, error } = await db.from("chat_messages")
        .select("body, created_at, topic_id, author:profiles!chat_messages_author_id_fkey(full_name)")
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const last = data[0];
      if (!last) {
        chat.value.textContent = "0";
        chat.note.textContent = "no messages yet. Start one.";
        return;
      }
      chat.link.href = `chat.html?topic=${encodeURIComponent(last.topic_id)}`;
      chat.value.textContent = formatDate(last.created_at);
      chat.value.classList.add("dash-value--small");
      const text = last.body.length > 70 ? `${last.body.slice(0, 70).trimEnd()}…` : last.body;
      chat.note.textContent = `${(last.author && last.author.full_name) || "Member"}: ${text}`;
    });

    fill(people, async () => {
      const n = await count(db.from("profiles").select("id", { count: "exact", head: true })
        .in("role", APPROVED_ROLES));
      people.value.textContent = n === null ? "—" : String(n);
      people.note.textContent = n === 1 ? "member" : "members";
    });

    const published = (kind) => count(db.from("projects").select("id", { count: "exact", head: true })
      .eq("kind", kind).eq("status", "published"));
    fill(hub, async () => {
      const n = await published("project");
      hub.value.textContent = n === null ? "—" : String(n);
    });
    fill(learn, async () => {
      const n = await published("material");
      learn.value.textContent = n === null ? "—" : String(n);
      // Core path progress, once there is a path (migration 009)
      const [steps, done] = await Promise.all([
        db.from("learning_path_items").select("project_id"),
        db.from("learning_progress").select("project_id").eq("user_id", profile.id),
      ]);
      if (steps.error || done.error || !steps.data.length) return;
      const finished = new Set(done.data.map((row) => row.project_id));
      const n2 = steps.data.filter((step) => finished.has(step.project_id)).length;
      learn.note.textContent = n2 === steps.data.length
        ? "published materials · core path complete"
        : `published materials · core path ${n2} of ${steps.data.length}`;
    });
    fill(requests, async () => {
      const n = await count(db.from("tool_requests").select("id", { count: "exact", head: true }).eq("status", "open"));
      requests.value.textContent = n === null ? "—" : String(n);
    });

    if (mod) {
      fill(mod, async () => {
        const [requests, items] = await Promise.all([
          count(db.from("profiles").select("id", { count: "exact", head: true }).eq("role", "pending")),
          count(db.from("projects").select("id", { count: "exact", head: true }).eq("status", "pending")),
        ]);
        const total = (requests || 0) + (items || 0);
        mod.value.textContent = requests === null || items === null ? "—" : String(total);
        mod.note.textContent = `${requests || 0} requests · ${items || 0} submissions waiting`;
        if (total > 0) mod.link.classList.add("dash-card--alert");
      });
    }

    wrap.append(grid, attention);
    return wrap;
  }

  // "About you": role, program, interests, message. Folded away once filled in.
  function detailsForm(profile, details) {
    const isNew = details === null;
    const wrap = el("details", "account-details");
    wrap.open = isNew;
    wrap.append(el("summary", "account-details-summary",
      isNew ? "// About you" : "// About you (edit)"));

    const form = el("form", "account-details-form");
    const field = (labelText, control, stacked) => {
      const row = el("div", stacked ? "join-row join-row--stacked" : "join-row");
      const label = el("label", "join-label", labelText);
      label.htmlFor = control.id;
      row.append(label, control);
      return row;
    };

    const role = el("select", "join-input");
    role.id = "details-role";
    role.required = true;
    const blank = el("option", null, "Select one");
    blank.value = "";
    blank.disabled = true;
    blank.selected = isNew;
    role.append(blank);
    for (const value of TRAINING_ROLES) {
      const option = el("option", null, value);
      option.selected = !isNew && details.training_role === value;
      role.append(option);
    }

    const program = el("input", "join-input");
    program.id = "details-program";
    program.type = "text";
    program.maxLength = 120;
    program.placeholder = "e.g. UC Internal Medicine";
    program.value = (details && details.program) || "";

    const interests = el("fieldset", "join-interests");
    interests.append(el("legend", "join-label", "Interests"));
    const boxes = INTERESTS.map(([value, label]) => {
      const chip = el("label", "interest-chip");
      const box = el("input");
      box.type = "checkbox";
      box.value = value;
      box.checked = !!details && (details.interests || []).includes(value);
      chip.append(box, ` ${label}`);
      interests.append(chip);
      return box;
    });

    const message = el("textarea", "join-input");
    message.id = "details-message";
    message.rows = 3;
    message.maxLength = 1000;
    message.placeholder = "What would you like to build or learn? (optional)";
    message.value = (details && details.message) || "";

    const isRequest = isNew && profile.role === "pending";
    const save = el("button", "join-submit", isRequest ? "> Send request" : "> Save");
    save.type = "submit";
    const status = el("p", "join-status");
    status.setAttribute("role", "status");

    form.append(
      field("Role", role),
      field("Program", program),
      interests,
      field("Message", message, true),
      save,
      status,
      el("p", "join-hint", "// Visible only to you and our moderators. Please don't include any patient information.")
    );

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const row = {
        training_role: role.value,
        program: program.value.trim() || null,
        interests: boxes.filter((box) => box.checked).map((box) => box.value),
        message: message.value.trim() || null,
      };

      save.disabled = true;
      status.textContent = "> SAVING...";
      status.classList.remove("is-error");

      const { error } = isNew
        ? await db.from("join_details").insert({ user_id: profile.id, ...row })
        : await db.from("join_details").update(row).eq("user_id", profile.id);

      if (error) {
        console.error(error);
        save.disabled = false;
        status.textContent = "> COULD NOT SAVE. Please try again.";
        status.classList.add("is-error");
        return;
      }

      if (isRequest) notifyOrganizers(profile, row);
      await refresh();
    });

    wrap.append(form);
    return wrap;
  }

  // Best-effort email to the organizers about a new request. The request is
  // already saved; a failure here is not shown to the person.
  function notifyOrganizers(profile, row) {
    const data = new FormData();
    data.append("_subject", "New membership request – AI Medicine Collective");
    data.append("source", "AI Medicine Collective – account page");
    data.append("name", profile.full_name || "");
    data.append("email", profile.email);
    data.append("role", row.training_role);
    data.append("program", row.program || "");
    data.append("interests", row.interests.join(", "));
    data.append("message", row.message || "");
    data.append("review", new URL("moderate.html", window.location.href).href);
    fetch(REQUEST_NOTIFY_URL, { method: "POST", body: data, headers: { Accept: "application/json" } })
      .catch(() => {});
  }

  // "Your profile": what other members see in the directory. The extra
  // fields come from migration 008; if they can't be read yet, only the
  // display name is offered.
  async function profileForm(profile, details) {
    const { data: extra, error: extraError } = await db
      .from("profiles")
      .select("program, training_level, focus_areas, bio, contact_email, link_url")
      .eq("id", profile.id)
      .maybeSingle();
    const full = !extraError && !!extra;
    const current = extra || {};
    const empty = full && !current.bio && !current.focus_areas;

    const wrap = el("details", "account-details");
    wrap.id = "profile";
    wrap.open = empty || !profile.full_name || window.location.hash === "#profile";
    wrap.append(el("summary", "account-details-summary", "// Your profile (visible to members)"));

    const form = el("form", "account-details-form");
    const field = (labelText, control, stacked) => {
      const row = el("div", stacked ? "join-row join-row--stacked" : "join-row");
      const label = el("label", "join-label", labelText);
      label.htmlFor = control.id;
      row.append(label, control);
      return row;
    };
    const textInput = (id, value, max, placeholder, type) => {
      const input = el("input", "join-input");
      input.id = id;
      input.type = type || "text";
      input.maxLength = max;
      input.value = value || "";
      if (placeholder) input.placeholder = placeholder;
      return input;
    };

    const name = textInput("account-name-input", profile.full_name, 80);
    name.required = true;
    form.append(field("Name", name));

    let program, level, focus, bio, contact, link;
    if (full) {
      program = textInput("profile-program", current.program || (details && details.program), 120, "e.g. UC Internal Medicine");
      level = textInput("profile-level", current.training_level, 40, "e.g. PGY-2, MS3, Faculty");
      focus = textInput("profile-focus", current.focus_areas, 300, "e.g. clinical workflows, medical education");
      bio = el("textarea", "join-input");
      bio.id = "profile-bio";
      bio.rows = 4;
      bio.maxLength = 1000;
      bio.value = current.bio || "";
      bio.placeholder = "A few lines about you and what you're building or learning.";
      contact = textInput("profile-contact", current.contact_email, 120, "optional: an email to show other members", "email");
      link = textInput("profile-link", current.link_url, 300, "optional: https://…", "url");
      link.pattern = "https://.+";
      form.append(
        field("Program", program),
        field("Level", level),
        field("Focus", focus),
        field("About", bio, true),
        field("Contact", contact),
        field("Link", link)
      );
    }

    const save = el("button", "join-submit", "> Save profile");
    save.type = "submit";
    const status = el("p", "join-status");
    status.setAttribute("role", "status");
    form.append(save, status);
    if (full) {
      form.append(el("p", "join-hint",
        "// Shown to approved members in the directory. Your sign-in email stays private unless you add a contact address here. No patient information."));
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const changes = { full_name: name.value.trim() };
      if (!changes.full_name) return;
      if (full) {
        Object.assign(changes, {
          program: program.value.trim() || null,
          training_level: level.value.trim() || null,
          focus_areas: focus.value.trim() || null,
          bio: bio.value.trim() || null,
          contact_email: contact.value.trim() || null,
          link_url: link.value.trim() || null,
        });
      }
      save.disabled = true;
      status.classList.remove("is-error");
      status.textContent = "> SAVING...";
      const { error } = await db.from("profiles").update(changes).eq("id", profile.id);
      save.disabled = false;
      if (error) {
        console.error(error);
        status.textContent = "> COULD NOT SAVE. Check the contact email and link, then try again.";
        status.classList.add("is-error");
        return;
      }
      status.textContent = "> SAVED";
      const shown = document.querySelector(".account-name");
      if (shown) shown.textContent = changes.full_name;
    });

    wrap.append(form);
    if (full && APPROVED_ROLES.includes(profile.role)) {
      const view = el("p");
      const viewLink = el("a", "account-mod-link", "> VIEW MY PROFILE");
      viewLink.href = `profile.html?id=${encodeURIComponent(profile.id)}`;
      view.append(viewLink);
      wrap.append(view);
    }
    return wrap;
  }

  async function refresh() {
    try {
      const { session, profile, details } = await getSessionAndProfile();
      if (session) await renderSignedIn(session, profile, details);
      else renderSignedOut();
    } catch (err) {
      console.error(err);
      show(el("p", "account-status is-error", "> COULD NOT LOAD YOUR ACCOUNT. Please refresh the page."));
    }
  }

  // Google, or an emailed sign-in link, sends people back with error details
  // (in the address after "?" or after "#") if they cancel or something fails
  const params = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (params.get("error") || hashParams.get("error")) {
    const code = params.get("error_code") || hashParams.get("error_code");
    // Emailed links work once. Some mail systems open links to scan them,
    // which uses the link up before the person clicks it.
    renderSignedOut(code === "otp_expired"
      ? "> THAT LINK HAS EXPIRED OR WAS ALREADY USED. Ask for a code below and type it in instead."
      : "> SIGN-IN WAS CANCELLED OR FAILED. Please try again.");
    history.replaceState(null, "", window.location.pathname);
    return;
  }

  show(loadingBlock("> CHECKING SESSION..."));
  refresh();

  // Re-render when sign-in completes or the session ends in another tab
  db.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(refresh, 0);
  });
}

/* ========= MODERATION PAGE ========= */

function initModerationPage() {
  const app = document.getElementById("moderate-app");
  if (!app) return;

  const show = (...nodes) => app.replaceChildren(...nodes);
  let me = null;
  let detailsById = new Map();

  function gate(text, linkText, href) {
    const p = el("p", "account-status is-error", text);
    const nodes = [p];
    if (linkText) {
      const link = el("a", null, linkText);
      link.href = href;
      const wrap = el("p");
      wrap.append(link);
      nodes.push(wrap);
    }
    show(...nodes);
  }

  async function act(statusNode, label, rpcName, args) {
    statusNode.textContent = `> ${label}...`;
    statusNode.classList.remove("is-error");
    const { error } = await db.rpc(rpcName, args);
    if (error) {
      statusNode.textContent = `> FAILED: ${error.message}`;
      statusNode.classList.add("is-error");
      return;
    }
    await load(`> DONE: ${label.toLowerCase()}`);
  }

  function personRow(person, status) {
    const row = el("li", "mod-row");
    const who = el("div", "account-who");
    who.append(
      el("span", "account-name", person.full_name || "(no name)"),
      el("span", "account-email", person.email),
      el("span", "note", `// signed up ${formatDate(person.created_at)}`)
    );
    const info = detailsById.get(person.id);
    if (info) {
      const facts = [info.training_role, info.program].filter(Boolean).join(" · ");
      who.append(el("span", "mod-detail", facts));
      if (info.interests && info.interests.length) {
        who.append(el("span", "mod-detail", `Interests: ${info.interests.join(", ")}`));
      }
      if (info.message) who.append(el("span", "mod-detail mod-message", `"${info.message}"`));
    } else if (person.role === "pending") {
      who.append(el("span", "note", "// hasn't filled in their details yet"));
    }
    const actions = el("div", "mod-actions");
    row.append(avatar(person), who, roleTag(person.role), actions);

    if (person.role === "pending" || person.role === "rejected") {
      actions.append(
        button("APPROVE", "mod-approve", () =>
          act(status, `Approving ${person.email}`, "approve_member", { target: person.id }))
      );
    }
    if (person.role === "pending") {
      actions.append(
        button("DECLINE", "mod-decline", () => {
          if (window.confirm(`Decline the request from ${person.email}?`)) {
            act(status, `Declining ${person.email}`, "reject_member", { target: person.id });
          }
        })
      );
    }

    // Admins can set any role, except their own
    if (me.role === "admin" && person.id !== me.id) {
      const select = el("select", "join-input mod-role-select");
      select.setAttribute("aria-label", `Role for ${person.email}`);
      for (const role of Object.keys(ROLE_LABELS)) {
        const option = el("option", null, ROLE_LABELS[role]);
        option.value = role;
        option.selected = role === person.role;
        select.append(option);
      }
      actions.append(
        select,
        button("SET ROLE", null, () => {
          if (select.value === person.role) return;
          if (window.confirm(`Change ${person.email} to ${ROLE_LABELS[select.value]}?`)) {
            act(status, `Setting ${person.email} to ${ROLE_LABELS[select.value]}`,
              "set_member_role", { target: person.id, new_role: select.value });
          }
        })
      );
    }
    return row;
  }

  function section(title, people, status, emptyText) {
    const wrap = el("section", "mod-section");
    wrap.append(el("h3", "subsection-title", `// ${title} (${people.length})`));
    if (!people.length) {
      wrap.append(el("p", "note", emptyText));
      return wrap;
    }
    const list = el("ul", "mod-list");
    people.forEach((person) => list.append(personRow(person, status)));
    wrap.append(list);
    return wrap;
  }

  async function load(message) {
    const { data: people, error } = await db
      .from("profiles")
      .select("id, full_name, avatar_url, role, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      gate("> COULD NOT LOAD MEMBERS. Please refresh the page.");
      return;
    }

    // Email addresses are available to moderators only, through a database
    // function that checks the caller's role. Without it, names still show.
    const emails = await db.rpc("member_emails");
    const emailById = new Map((emails.data || []).map((row) => [row.id, row.email]));
    people.forEach((person) => { person.email = emailById.get(person.id) || "(email hidden)"; });

    // "About you" details, readable by moderators. If this fails, the lists
    // still show, just without the details.
    const details = await db
      .from("join_details")
      .select("user_id, training_role, program, interests, message");
    detailsById = new Map((details.data || []).map((row) => [row.user_id, row]));

    const status = el("p", "account-status mod-status", message || "");
    status.setAttribute("role", "status");
    const by = (roles) => people.filter((p) => roles.includes(p.role));

    show(
      el("p", "note", `// Signed in as ${me.email} (${ROLE_LABELS[me.role]})`),
      status,
      section("Pending requests", by(["pending"]), status, "No requests waiting."),
      section("Members", by(APPROVED_ROLES), status, "No approved members yet."),
      section("Declined", by(["rejected"]), status, "None.")
    );
  }

  (async () => {
    show(loadingBlock("> CHECKING ACCESS..."));
    try {
      const { session, profile } = await getSessionAndProfile();
      if (!session) return gate("> SIGN IN REQUIRED", "> Go to sign in", "account.html");
      if (!profile || !["moderator", "admin"].includes(profile.role)) {
        return gate("> ACCESS DENIED. This page is for moderators.", "< Back to your account", "account.html");
      }
      me = profile;
      await load();
    } catch (err) {
      console.error(err);
      gate("> COULD NOT CHECK ACCESS. Please refresh the page.");
    }
  })();
}

document.addEventListener("DOMContentLoaded", initAccountPage);
document.addEventListener("DOMContentLoaded", initModerationPage);
