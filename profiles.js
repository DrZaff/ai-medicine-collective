// === AI Medicine Collective: member directory and profile pages ===
//
// Loaded on directory.html and profile.html, after the Supabase library and
// auth.js (it uses db, el, avatar, roleTag, formatDate and
// getSessionAndProfile from there; the scripts share one global scope, so
// top-level names here must not repeat names in the other scripts).
//
// Profiles are visible to approved members only. That is enforced by the
// database (migrations 001, 006 and 008), not by this file. A member's
// sign-in email is never read here; contact_email is an address they chose
// to show.

const MEMBER_PROFILE_COLUMNS =
  "id, full_name, avatar_url, role, created_at, program, training_level, focus_areas, bio, contact_email, link_url";

const MEMBER_CARD_COLUMNS = "id, full_name, avatar_url, role, created_at, program, training_level, focus_areas";

// Members who joined in the last two weeks get a NEW tag in the directory
const MEMBER_NEW_DAYS = 14;

function memberSubtitle(person) {
  return [person.program, person.training_level].filter(Boolean).join(" · ");
}

// Shared gate: resolves to the signed-in member's profile, or shows why not
async function requireMember(app, signedOutText) {
  const { session, profile } = await getSessionAndProfile();
  const gate = (text, linkText) => {
    const link = el("a", "account-mod-link", linkText);
    link.href = "account.html";
    app.replaceChildren(el("p", "account-status", "> MEMBERS ONLY"), el("p", null, text), link);
    return null;
  };
  if (!session) return gate(signedOutText, "> SIGN IN OR REQUEST MEMBERSHIP");
  if (!profile || !["member", "moderator", "admin"].includes(profile.role)) {
    return gate("Your membership isn't active yet. This opens once a moderator approves your request.", "> CHECK YOUR STATUS");
  }
  return profile;
}

/* ========= DIRECTORY ========= */

function initDirectoryPage() {
  const app = document.getElementById("directory-app");
  if (!app) return;

  (async () => {
    app.replaceChildren(loadingBlock("> CHECKING ACCESS..."));
    try {
      const me = await requireMember(app, "The directory lists the Collective's members and what they work on.");
      if (!me) return;

      const { data: people, error } = await db
        .from("profiles")
        .select(MEMBER_CARD_COLUMNS)
        .in("role", ["member", "moderator", "admin"])
        .order("full_name", { ascending: true });

      if (error) {
        console.error(error);
        app.replaceChildren(el("p", "account-status is-error", "> THE DIRECTORY ISN'T AVAILABLE YET. Please try again later."));
        return;
      }

      // Institutions (migration 012), asked for separately so the directory
      // still loads before that column exists
      const institutionOf = new Map();
      const { data: places } = await db.from("profiles").select("id, institution")
        .in("role", ["member", "moderator", "admin"]);
      (places || []).forEach((row) => { if (row.institution) institutionOf.set(row.id, row.institution); });

      const total = `${people.length} member${people.length === 1 ? "" : "s"}`;
      const count = el("p", "roster-stats", `> ${total}`);
      count.setAttribute("role", "status");
      const newSince = Date.now() - MEMBER_NEW_DAYS * 24 * 60 * 60 * 1000;

      const search = el("input", "join-input directory-search");
      search.type = "search";
      search.placeholder = "Search by name, program or focus";
      search.setAttribute("aria-label", "Search members by name, program or focus area");

      const grid = el("div", "roster-grid");
      const cards = people.map((person) => {
        const card = el("a", "roster-card");
        card.href = `profile.html?id=${encodeURIComponent(person.id)}`;
        const text = el("span", "roster-text");
        text.append(el("span", "roster-name", person.full_name || "Member"));
        const subtitle = memberSubtitle(person);
        if (subtitle) text.append(el("span", "roster-meta", subtitle));
        const institution = institutionOf.get(person.id) || "";
        if (institution) text.append(el("span", "roster-meta", institution));
        // What they work on, so the directory helps you find collaborators
        if (person.focus_areas) {
          const focus = person.focus_areas.length > 70 ? `${person.focus_areas.slice(0, 70).trimEnd()}…` : person.focus_areas;
          text.append(el("span", "roster-focus", `// ${focus}`));
        }
        const isNew = new Date(person.created_at).getTime() > newSince;
        if (person.role !== "member" || person.id === me.id || isNew) {
          const tags = el("span", "roster-tags");
          if (person.role !== "member") tags.append(roleTag(person.role));
          if (isNew) tags.append(el("span", "member-tag member-tag--new", "NEW"));
          if (person.id === me.id) tags.append(el("span", "roster-role", "You"));
          text.append(tags);
        }
        const go = el("span", "roster-go", ">");
        go.setAttribute("aria-hidden", "true");
        card.append(avatar(person), text, go);
        card.dataset.search = `${person.full_name || ""} ${person.program || ""} ${person.training_level || ""} ${person.focus_areas || ""} ${institution}`.toLowerCase();
        card.dataset.institution = institution;
        grid.append(card);
        return card;
      });

      const none = el("p", "note", "// No members match that.");
      none.hidden = true;
      let place = "All";
      const apply = () => {
        const term = search.value.trim().toLowerCase();
        let shown = 0;
        cards.forEach((card) => {
          card.hidden = (!!term && !card.dataset.search.includes(term))
            || (place !== "All" && card.dataset.institution !== place);
          if (!card.hidden) shown++;
        });
        count.textContent = shown === cards.length ? `> ${total}` : `> ${shown} of ${total}`;
        none.hidden = shown > 0;
      };
      search.addEventListener("input", apply);

      // Institution filter, when there is more than one to choose from
      const filter = el("div", "filter-bar");
      filter.setAttribute("role", "group");
      filter.setAttribute("aria-label", "Filter members by institution");
      const institutions = [...new Set(institutionOf.values())].sort((a, b) => a.localeCompare(b));
      if (institutions.length > 1) {
        const buttons = ["All", ...institutions].map((name) => {
          const btn = button(name.toUpperCase(), "filter-btn", () => {
            place = name;
            buttons.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
            apply();
          });
          btn.setAttribute("aria-pressed", String(name === "All"));
          filter.append(btn);
          return btn;
        });
      } else {
        filter.hidden = true;
      }

      app.replaceChildren(count, search, filter, grid, none);
    } catch (err) {
      console.error(err);
      app.replaceChildren(el("p", "account-status is-error", "> COULD NOT LOAD THE DIRECTORY. Please refresh the page."));
    }
  })();
}

/* ========= ONE PROFILE ========= */

function initProfilePage() {
  const app = document.getElementById("profile-app");
  if (!app) return;

  const httpsLink = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" ? parsed.href : null;
    } catch {
      return null;
    }
  };

  (async () => {
    app.replaceChildren(loadingBlock("> CHECKING ACCESS..."));
    try {
      const me = await requireMember(app, "Member profiles are visible to the Collective's members.");
      if (!me) return;

      const id = new URLSearchParams(window.location.search).get("id") || me.id;
      const { data: person, error } = await db
        .from("profiles").select(MEMBER_PROFILE_COLUMNS).eq("id", id).maybeSingle();

      if (error) {
        console.error(error);
        app.replaceChildren(el("p", "account-status is-error", "> PROFILES AREN'T AVAILABLE YET. Please try again later."));
        return;
      }
      if (!person || !["member", "moderator", "admin"].includes(person.role)) {
        app.replaceChildren(el("p", "account-status is-error", "> MEMBER NOT FOUND"));
        return;
      }

      const isMe = person.id === me.id;
      const panel = el("article", "account-panel member-profile");

      const head = el("div", "account-head");
      const who = el("div", "account-who");
      who.append(el("h3", "profile-name", person.full_name || "Member"));
      const subtitle = memberSubtitle(person);
      if (subtitle) who.append(el("span", "profile-role", subtitle));
      head.append(avatar(person), who);
      if (person.role !== "member") head.append(roleTag(person.role));

      // Finished every step of the core learning path (migration 009)?
      const [pathSteps, pathDone] = await Promise.all([
        db.from("learning_path_items").select("project_id"),
        db.from("learning_progress").select("project_id").eq("user_id", person.id),
      ]);
      if (!pathSteps.error && !pathDone.error && pathSteps.data.length) {
        const finished = new Set(pathDone.data.map((row) => row.project_id));
        if (pathSteps.data.every((step) => finished.has(step.project_id))) {
          head.append(el("span", "member-tag member-tag--path", "CORE PATH COMPLETE"));
        }
      }
      panel.append(head);

      const fields = el("dl", "profile-fields");
      const addField = (label, node) => { fields.append(el("dt", null, label), node); };

      const { data: where } = await db.from("profiles").select("institution").eq("id", person.id).maybeSingle();
      if (where && where.institution) addField("Institution", el("dd", "member-profile-text", where.institution));
      if (person.focus_areas) addField("Focus areas", el("dd", "member-profile-text", person.focus_areas));
      if (person.bio) addField("About", el("dd", "member-profile-text", person.bio));
      if (person.contact_email) {
        const dd = el("dd");
        const mail = el("a", null, person.contact_email);
        mail.href = `mailto:${person.contact_email}`;
        dd.append(mail);
        addField("Contact", dd);
      }
      const link = person.link_url && httpsLink(person.link_url);
      if (link) {
        const dd = el("dd", "member-profile-text");
        const anchor = el("a", null, person.link_url.replace(/^https:\/\//, ""));
        anchor.href = link;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        dd.append(anchor);
        addField("Link", dd);
      }
      addField("Member since", el("dd", null, formatDate(person.created_at)));
      panel.append(fields);

      if (!person.focus_areas && !person.bio) {
        panel.append(el("p", "note", isMe
          ? "// Your profile is empty. Add a few lines so other members know what you work on."
          : "// This member hasn't filled in their profile yet."));
      }

      if (isMe) {
        const edit = el("p");
        const editLink = el("a", "account-mod-link", "> EDIT MY PROFILE");
        editLink.href = "account.html#profile";
        edit.append(editLink);
        panel.append(edit);
      }

      // What they've shared
      const nodes = [panel];
      const { data: items } = await db
        .from("projects")
        .select("id, kind, title, category, folder, created_at")
        .eq("author_id", person.id)
        .eq("status", "published")
        .order("created_at", { ascending: false });
      if (items && items.length) {
        const section = el("section", "member-profile-items");
        section.append(el("h3", "subsection-title", `// Shared by ${isMe ? "you" : person.full_name || "this member"} (${items.length})`));
        const list = el("ul", "blog-archive-list");
        for (const item of items) {
          const li = el("li");
          const anchor = el("a", null, item.title);
          anchor.href = `${item.kind === "material" ? "learn.html" : "hub.html"}?project=${encodeURIComponent(item.id)}`;
          li.append(anchor, el("span", "note", ` // ${item.kind === "material" ? `${item.folder} · ${item.category}` : item.category}`));
          list.append(li);
        }
        section.append(list);
        if (isMe) {
          section.append(copyButton("COPY ALL FOR MY CV",
            () => items.map((item) => citationFor(item, person.full_name)).join("\n")));
        }
        nodes.push(section);
      }

      const back = el("p");
      const backLink = el("a", null, "< All members");
      backLink.href = "directory.html";
      back.append(backLink);
      nodes.push(back);

      app.replaceChildren(...nodes);
      if (person.full_name) document.title = `${person.full_name} – AI Medicine Collective`;
    } catch (err) {
      console.error(err);
      app.replaceChildren(el("p", "account-status is-error", "> COULD NOT LOAD THIS PROFILE. Please refresh the page."));
    }
  })();
}

document.addEventListener("DOMContentLoaded", initDirectoryPage);
document.addEventListener("DOMContentLoaded", initProfilePage);
