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

async function getSessionAndProfile() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return { session: null, profile: null };

  const { data: profile, error } = await db
    .from("profiles")
    .select("id, email, full_name, avatar_url, role, created_at")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error) throw error;

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
      el("p", null, "Members sign in with their Google account. No new password to remember."),
      button("> SIGN IN WITH GOOGLE", "signin-btn", async (e) => {
        e.currentTarget.disabled = true;
        const { error } = await signInWithGoogle();
        if (error) renderSignedOut("> SIGN-IN FAILED. Please try again.");
      })
    );
    const note = el("p", "note");
    note.append(
      "// First time here? Signing in sends a membership request to our moderators. " +
      "We receive only your name, email and profile picture from Google. See the "
    );
    const link = el("a", null, "privacy policy");
    link.href = "privacy.html";
    note.append(link, ".");
    panel.append(note);
    show(panel);
  }

  function renderSignedIn(session, profile, details) {
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
        panel.append(
          el("p", "account-status", "> ACCESS GRANTED"),
          el("p", null, "You're an approved member. Learning Materials and Chat will appear here as they launch.")
        );
        const hub = el("p");
        const hubLinkNode = el("a", "account-mod-link", "> OPEN PROJECTS HUB");
        hubLinkNode.href = "hub.html";
        hub.append(hubLinkNode);
        panel.append(hub);
        if (profile.role === "moderator" || profile.role === "admin") {
          const mod = el("p");
          const link = el("a", "account-mod-link", "> OPEN MODERATION");
          link.href = "moderate.html";
          mod.append(link);
          panel.append(mod);
        }
      }

      if (profile.role !== "rejected") {
        if (details !== undefined) panel.append(detailsForm(profile, details));
        panel.append(nameForm(profile));
      }
    }

    panel.append(
      button("SIGN OUT", "account-signout", async () => {
        await db.auth.signOut();
        renderSignedOut();
      })
    );
    show(panel);
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

  function nameForm(profile) {
    const form = el("form", "account-name-form");
    const label = el("label", "join-label", "Display name");
    label.htmlFor = "account-name-input";
    const input = el("input", "join-input");
    input.id = "account-name-input";
    input.type = "text";
    input.maxLength = 80;
    input.required = true;
    input.value = profile.full_name || "";
    const save = el("button", null, "SAVE");
    save.type = "submit";
    const status = el("span", "account-form-status");
    status.setAttribute("role", "status");
    form.append(label, input, save, status);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      save.disabled = true;
      const { error } = await db.from("profiles").update({ full_name: name }).eq("id", profile.id);
      save.disabled = false;
      status.textContent = error ? "> COULD NOT SAVE" : "> SAVED";
      status.classList.toggle("is-error", !!error);
      if (!error) {
        const shown = document.querySelector(".account-name");
        if (shown) shown.textContent = name;
      }
    });
    return form;
  }

  async function refresh() {
    try {
      const { session, profile, details } = await getSessionAndProfile();
      if (session) renderSignedIn(session, profile, details);
      else renderSignedOut();
    } catch (err) {
      console.error(err);
      show(el("p", "account-status is-error", "> COULD NOT LOAD YOUR ACCOUNT. Please refresh the page."));
    }
  }

  // Google sends people back with ?error=... if they cancel or something fails
  const params = new URLSearchParams(window.location.search);
  if (params.get("error")) {
    renderSignedOut("> SIGN-IN WAS CANCELLED OR FAILED. Please try again.");
    history.replaceState(null, "", window.location.pathname);
    return;
  }

  show(el("p", "account-status", "> CHECKING SESSION..."));
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
      .select("id, email, full_name, avatar_url, role, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      gate("> COULD NOT LOAD MEMBERS. Please refresh the page.");
      return;
    }

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
    show(el("p", "account-status", "> CHECKING ACCESS..."));
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
