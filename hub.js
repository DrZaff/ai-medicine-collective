// === AI Medicine Collective: Projects hub + Learning Materials ===
//
// Loaded on hub.html, learn.html and moderate.html, after the Supabase
// library and auth.js (it uses db, el, button, avatar, formatDate,
// getSessionAndProfile and REQUEST_NOTIFY_URL from there; all three scripts
// share one global scope, so top-level names here must not repeat names in
// auth.js/script.js).
//
// Projects and learning materials are the same thing underneath: rows in
// public.projects with kind 'project' or 'material', going through the same
// submit -> moderator review -> publish flow. Materials also have a folder.
//
// Who can see or change what is enforced by the database
// (supabase/migrations/003_projects_hub.sql and 004_learning_materials.sql),
// not by this file.

// The page says which kind it shows: <div id="hub-app" data-kind="material">.
// Category lists must match the CHECK constraint in migration 004.
const HUB_KINDS = {
  project: {
    page: "hub.html",
    name: "Projects hub",
    noun: "project",
    plural: "projects",
    allLabel: "ALL PROJECTS",
    submitLabel: "> SUBMIT A PROJECT",
    categoryLabel: "Category",
    categories: [
      "Medical education", "Patient care", "Research", "Guidelines",
      "Learning", "Lifestyle", "Productivity", "Other",
    ],
    intro: "The Projects hub is where members share and discuss their AI projects.",
    titleHint: "e.g. Discharge summary helper",
    descriptionHint: "What does it do, who is it for, and how do people use it?",
    linkHint: "https://… (custom GPT, app, repo; optional)",
    linkText: "Launch",
  },
  material: {
    page: "learn.html",
    name: "Learning",
    noun: "material",
    plural: "materials",
    allLabel: "ALL MATERIALS",
    submitLabel: "> ADD A MATERIAL",
    categoryLabel: "Type",
    categories: ["Presentation", "Module", "Guide", "Video", "Other"],
    intro: "Learning is for members: a core path, the Collective's own presentations and guides, and a picked library of videos, courses and references. It's free to join.",
    titleHint: "e.g. Prompting basics for clinicians",
    descriptionHint: "What will people learn, who is it for, and how long does it take?",
    linkHint: "https://… (slides, video, course page; optional)",
    linkText: "Open",
  },
};

// Must match the storage bucket settings in migrations 003/004.
const PROJECT_FILES_BUCKET = "project-files";
const PROJECT_FILE_MAX_MB = 25;
const PROJECT_FILE_ACCEPT = ".pdf,.png,.jpg,.jpeg,.txt,.md,.docx,.pptx,.xlsx";

const PROJECT_STATUS_LABELS = { pending: "IN REVIEW", published: "PUBLISHED", rejected: "NOT APPROVED" };

const PROJECT_COLUMNS =
  "id, kind, folder, title, category, description, link_url, doc_url, file_path, file_name, status, review_note, created_at, " +
  "author:profiles!projects_author_id_fkey(id, full_name, avatar_url)";

// Published projects are public (migration 007). Signed-out visitors are
// granted only these columns, so asking for more would be refused.
const PROJECT_PUBLIC_COLUMNS =
  "id, kind, folder, title, category, description, link_url, doc_url, file_path, file_name, status, created_at, " +
  "author:profiles!projects_author_id_fkey(id, full_name, avatar_url)";

/* ========= shared pieces ========= */

function hubLink(text, href, className) {
  const link = el("a", className, text);
  link.href = href;
  return link;
}

function hubKind(project) {
  return HUB_KINDS[project.kind] || HUB_KINDS.project;
}

function projectStatusTag(status) {
  return el("span", `member-tag status-tag status-${status}`, PROJECT_STATUS_LABELS[status] || status);
}

function httpsUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function authorName(project) {
  return (project.author && project.author.full_name) || "Member";
}

// Private files have no public address: ask for a short-lived link, then open it.
async function openProjectFile(project, statusNode) {
  statusNode.textContent = "> PREPARING DOWNLOAD...";
  statusNode.classList.remove("is-error");
  const { data, error } = await db.storage
    .from(PROJECT_FILES_BUCKET)
    .createSignedUrl(project.file_path, 300, { download: project.file_name || true });
  if (error || !data) {
    statusNode.textContent = "> COULD NOT OPEN THE FILE.";
    statusNode.classList.add("is-error");
    return;
  }
  statusNode.textContent = "";
  window.open(data.signedUrl, "_blank", "noopener");
}

function projectLinks(project, statusNode) {
  const actions = el("div", "project-actions");
  const href = project.link_url && httpsUrl(project.link_url);
  if (href) {
    const launch = hubLink(hubKind(project).linkText, href, "project-launch-btn");
    launch.target = "_blank";
    launch.rel = "noopener noreferrer";
    actions.append(launch);
  }
  const docHref = project.doc_url && httpsUrl(project.doc_url);
  if (docHref) {
    const doc = hubLink("Instructions", docHref, "project-doc-link");
    doc.target = "_blank";
    doc.rel = "noopener noreferrer";
    actions.append(doc);
  }
  if (project.file_path) {
    const file = hubLink(`File: ${project.file_name || "download"}`, "#", "project-doc-link");
    file.addEventListener("click", (e) => {
      e.preventDefault();
      openProjectFile(project, statusNode);
    });
    actions.append(file);
  }
  return actions;
}

async function deleteProject(project) {
  if (project.file_path) {
    await db.storage.from(PROJECT_FILES_BUCKET).remove([project.file_path]);
  }
  return db.from("projects").delete().eq("id", project.id);
}

function notifyOrganizersOfProject(profile, project) {
  const kind = hubKind(project);
  const data = new FormData();
  data.append("_subject", `New ${kind.noun} submission – AI Medicine Collective`);
  data.append("source", `AI Medicine Collective – ${kind.name}`);
  data.append("name", profile.full_name || "");
  data.append("email", profile.email);
  data.append("title", project.title);
  data.append("category", project.folder ? `${project.folder} / ${project.category}` : project.category);
  data.append("review", new URL("moderate.html", window.location.href).href);
  fetch(REQUEST_NOTIFY_URL, { method: "POST", body: data, headers: { Accept: "application/json" } })
    .catch(() => {});
}

/* ========= HUB PAGE (hub.html and learn.html) ========= */

function initHubPage() {
  const app = document.getElementById("hub-app");
  if (!app) return;

  const kindKey = app.dataset.kind === "material" ? "material" : "project";
  const kind = HUB_KINDS[kindKey];
  const isMaterial = kindKey === "material";

  const show = (...nodes) => app.replaceChildren(...nodes);
  const params = new URLSearchParams(window.location.search);
  // `me` stays null for visitors who aren't approved members. On the
  // Projects hub they get a read-only view of published projects.
  let me = null;
  const isModerator = () => !!me && (me.role === "moderator" || me.role === "admin");
  const columns = () => (me ? PROJECT_COLUMNS : PROJECT_PUBLIC_COLUMNS);

  function fail(text) {
    show(el("p", "account-status is-error", text));
  }

  function toolbar(current) {
    const bar = el("div", "hub-toolbar");
    const items = me
      ? [
          ["all", kind.allLabel, kind.page],
          ["mine", "MY SUBMISSIONS", `${kind.page}?view=mine`],
          ["submit", kind.submitLabel, `${kind.page}?view=submit`],
        ]
      : [
          ["all", kind.allLabel, kind.page],
          ["submit", "> SIGN IN TO SUBMIT OR COMMENT", "account.html"],
        ];
    for (const [key, label, href] of items) {
      const link = hubLink(label, href, key === "submit" ? "hub-tab hub-tab--submit" : "hub-tab");
      if (key === current) link.setAttribute("aria-current", "page");
      bar.append(link);
    }
    return bar;
  }

  function projectCard(project, showStatus) {
    const card = hubLink("", `${kind.page}?project=${encodeURIComponent(project.id)}`, "project-item hub-card");
    const head = el("span", "hub-card-head");
    head.append(el("span", "project-title", project.title), el("span", "member-tag hub-cat", project.category));
    if (showStatus && project.folder) head.append(el("span", "member-tag hub-cat", project.folder));
    if (showStatus) head.append(projectStatusTag(project.status));
    const text = project.description.length > 180 ? `${project.description.slice(0, 180).trimEnd()}…` : project.description;
    card.append(
      head,
      el("span", "project-desc", text),
      el("span", "hub-card-meta", `// ${authorName(project)} · ${formatDate(project.created_at)}`)
    );
    return card;
  }

  async function loadFolders() {
    const { data, error } = await db
      .from("material_folders")
      .select("name, position")
      .order("position", { ascending: true });
    if (error) throw error;
    return data;
  }

  /* ---- list of published items ---- */

  async function renderList(message) {
    const { data: projects, error } = await db
      .from("projects")
      .select(columns())
      .eq("kind", kindKey)
      .eq("status", "published")
      .order("created_at", { ascending: false });
    if (error) return fail(`> COULD NOT LOAD ${kind.plural.toUpperCase()}. Please refresh the page.`);

    const nodes = [toolbar("all")];
    if (message) nodes.push(el("p", "account-status hub-status", message));

    if (isMaterial) {
      nodes.push(...(await pathNodes(projects)), ...(await folderNodes(projects)));
    } else if (!projects.length) {
      nodes.push(emptyState("// No projects published yet", "Be the first to share one.",
        me ? kind.submitLabel : "> SIGN IN TO SUBMIT", me ? `${kind.page}?view=submit` : "account.html"));
    } else {
      nodes.push(...categoryNodes(projects));
    }
    show(...nodes);
  }

  // Projects: a search box, category filter buttons with counts, and a
  // compact grid of cards
  function categoryNodes(projects) {
    const list = el("div", "projects-list hub-grid");
    const cards = projects.map((project) => {
      const card = projectCard(project, false);
      card.dataset.category = project.category;
      card.dataset.search = `${project.title} ${project.description} ${project.category} ${authorName(project)}`.toLowerCase();
      list.append(card);
      return card;
    });

    const search = el("input", "join-input directory-search");
    search.type = "search";
    search.placeholder = "Search projects";
    search.setAttribute("aria-label", "Search projects by name, description or author");

    const shown = el("p", "roster-stats");
    shown.setAttribute("role", "status");
    const none = el("p", "note", "// No projects match that. Try a different word or category.");

    let category = "All";
    const apply = () => {
      const term = search.value.trim().toLowerCase();
      let visible = 0;
      cards.forEach((card) => {
        card.hidden = (category !== "All" && card.dataset.category !== category)
          || (!!term && !card.dataset.search.includes(term));
        if (!card.hidden) visible++;
      });
      shown.textContent = visible === cards.length
        ? `> ${cards.length} project${cards.length === 1 ? "" : "s"}`
        : `> ${visible} of ${cards.length} projects`;
      none.hidden = visible > 0;
    };

    const used = kind.categories.filter((c) => projects.some((p) => p.category === c));
    const filter = el("div", "filter-bar");
    filter.setAttribute("role", "group");
    filter.setAttribute("aria-label", "Filter projects by category");
    const buttons = ["All", ...used].map((name) => {
      const count = name === "All" ? projects.length : projects.filter((p) => p.category === name).length;
      const btn = button(`${name.toUpperCase()} (${count})`, "filter-btn", () => {
        category = name;
        buttons.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
        apply();
      });
      btn.setAttribute("aria-pressed", String(name === "All"));
      filter.append(btn);
      return btn;
    });

    search.addEventListener("input", apply);
    apply();
    return [search, filter, shown, list, none];
  }

  /* ---- core path (materials only): a short ordered list picked by moderators ---- */

  // Resolves to null when the path isn't available (before migration 009)
  async function loadPath() {
    const [items, done] = await Promise.all([
      db.from("learning_path_items").select("project_id, position").order("position", { ascending: true }),
      db.from("learning_progress").select("project_id").eq("user_id", me.id),
    ]);
    if (items.error || done.error) return null;
    return { items: items.data, done: new Set(done.data.map((row) => row.project_id)) };
  }

  // "MARK DONE" / "DONE" toggle for one material
  function doneButton(projectId, isDone, after) {
    const btn = button(isDone ? "✓ DONE" : "MARK DONE", "hub-tab path-done", async (e) => {
      e.preventDefault();
      btn.disabled = true;
      const { error } = isDone
        ? await db.from("learning_progress").delete().eq("user_id", me.id).eq("project_id", projectId)
        : await db.from("learning_progress").insert({ user_id: me.id, project_id: projectId });
      if (error) {
        console.error(error);
        btn.disabled = false;
        return;
      }
      after();
    });
    btn.setAttribute("aria-pressed", String(isDone));
    return btn;
  }

  async function pathNodes(projects) {
    const path = await loadPath();
    if (!path) return [];
    const steps = path.items.map((item) => projects.find((p) => p.id === item.project_id)).filter(Boolean);

    const section = el("section", "path");
    section.append(el("h3", "subsection-title", "// Core path: AI for clinicians"));
    if (!steps.length) {
      if (!isModerator()) return [];
      section.append(el("p", "note",
        "// No steps yet. Open a published material and choose ADD TO CORE PATH. Aim for five or six, in the order a beginner should take them."));
      return [section];
    }

    const finished = steps.filter((p) => path.done.has(p.id)).length;
    const summary = el("p", "roster-stats", finished === steps.length
      ? `> COMPLETE: all ${steps.length} steps done. It shows on your profile.`
      : `> ${finished} of ${steps.length} steps done`);
    summary.setAttribute("role", "status");
    const bar = el("div", "path-bar");
    bar.setAttribute("aria-hidden", "true");
    const fillBar = el("span");
    fillBar.style.width = `${Math.round((finished / steps.length) * 100)}%`;
    bar.append(fillBar);

    const list = el("ol", "path-list");
    for (const project of steps) {
      const li = el("li", path.done.has(project.id) ? "is-done" : null);
      const text = el("span", "path-step");
      text.append(
        hubLink(project.title, `${kind.page}?project=${encodeURIComponent(project.id)}`),
        el("span", "hub-card-meta", `// ${project.category} · ${authorName(project)}`)
      );
      li.append(text, doneButton(project.id, path.done.has(project.id), () => renderList()));
      list.append(li);
    }
    section.append(summary, bar, list, el("p", "note",
      "// Start here. Moderators pick these steps from the library below, so anything a member contributes can be chosen."));
    return [section];
  }

  // On one material's page: mark it done, and (moderators) add or remove it
  async function pathControls(project) {
    const wrap = el("div", "hub-contact path-controls");
    const path = await loadPath();
    if (!path) return wrap;
    const inPath = path.items.some((item) => item.project_id === project.id);
    const again = () => renderProject(project.id);

    if (inPath) {
      wrap.append(el("span", "note", "// A step in the core path."), doneButton(project.id, path.done.has(project.id), again));
    }
    if (isModerator()) {
      wrap.append(inPath
        ? button("Remove from core path", "hub-tab", async () => {
            await db.from("learning_path_items").delete().eq("project_id", project.id);
            again();
          })
        : button("+ Add to core path", "hub-tab", async () => {
            const position = Math.max(0, ...path.items.map((item) => item.position)) + 10;
            const { error } = await db.from("learning_path_items")
              .insert({ project_id: project.id, position, added_by: me.id });
            if (error) console.error(error);
            again();
          }));
    }
    return wrap;
  }

  // Materials: one fold-out section per folder
  async function folderNodes(projects) {
    let folders;
    try {
      folders = await loadFolders();
    } catch (err) {
      console.error(err);
      return [el("p", "account-status is-error", "> COULD NOT LOAD FOLDERS. Please refresh the page.")];
    }

    const nodes = [];
    const accordion = el("section", "resource-accordion");
    for (const folder of folders) {
      const items = projects.filter((p) => p.folder === folder.name);
      const group = el("details", "resource-group hub-folder");
      group.open = items.length > 0;
      group.append(el("summary", "resource-summary", `// ${folder.name} (${items.length})`));
      const body = el("div", "resource-body");
      if (items.length) {
        const list = el("div", "projects-list hub-folder-list");
        items.forEach((project) => list.append(projectCard(project, false)));
        body.append(list);
      } else {
        body.append(el("p", "note", "Nothing here yet."));
      }
      group.append(body);
      accordion.append(group);
    }
    nodes.push(accordion);

    if (isModerator()) {
      nodes.push(button("+ NEW FOLDER", "hub-new-folder", async () => {
        const name = (window.prompt("Name of the new folder:", "") || "").trim();
        if (!name) return;
        const position = Math.max(0, ...folders.filter((f) => f.position < 900).map((f) => f.position)) + 10;
        const { error } = await db.from("material_folders").insert({ name, position });
        renderList(error ? `> COULD NOT ADD THE FOLDER: ${error.message}` : `> FOLDER ADDED: ${name}`);
      }));
    }
    return nodes;
  }

  /* ---- my submissions ---- */

  async function renderMine() {
    const { data: projects, error } = await db
      .from("projects")
      .select(PROJECT_COLUMNS)
      .eq("kind", kindKey)
      .eq("author_id", me.id)
      .order("created_at", { ascending: false });
    if (error) return fail("> COULD NOT LOAD YOUR SUBMISSIONS. Please refresh the page.");

    const nodes = [toolbar("mine")];
    if (!projects.length) {
      nodes.push(emptyState(`// No submissions yet`, `You haven't submitted a ${kind.noun}. A moderator reviews each one before it's published.`,
        kind.submitLabel, `${kind.page}?view=submit`));
    } else {
      const list = el("div", "projects-list");
      for (const project of projects) {
        list.append(projectCard(project, true));
        if (project.status === "rejected" && project.review_note) {
          list.append(el("p", "note hub-review-note", `// Moderator note: ${project.review_note}`));
        }
      }
      nodes.push(list);
    }
    show(...nodes);
  }

  /* ---- one item, with contact + comments ---- */

  async function renderProject(id) {
    const { data: project, error } = await db
      .from("projects").select(columns()).eq("id", id).maybeSingle();
    if (error) return fail(`> COULD NOT LOAD THIS ${kind.noun.toUpperCase()}. Please refresh the page.`);
    if (!project) {
      show(toolbar(null), el("p", "account-status is-error", "> NOT FOUND"),
        el("p", "note", "// It may have been removed, or it isn't published yet."));
      return;
    }
    // Opened on the wrong page (e.g. a material's id on hub.html): send it home
    if (project.kind !== kindKey) {
      window.location.replace(`${hubKind(project).page}?project=${encodeURIComponent(project.id)}`);
      return;
    }

    const status = el("p", "account-status hub-status");
    status.setAttribute("role", "status");

    const article = el("article", "hub-detail");
    const head = el("div", "hub-card-head");
    head.append(el("h3", "hub-title", project.title));
    if (project.folder) head.append(el("span", "member-tag hub-cat", project.folder));
    head.append(el("span", "member-tag hub-cat", project.category));
    if (project.status !== "published") head.append(projectStatusTag(project.status));
    article.append(head);

    if (project.status === "rejected" && project.review_note) {
      article.append(el("p", "note", `// Moderator note: ${project.review_note}`));
    }

    const byline = el("div", "account-head hub-byline");
    const who = el("div", "account-who");
    // Members can open the author's profile; visitors just see the name
    who.append(
      me && project.author
        ? hubLink(authorName(project), `profile.html?id=${encodeURIComponent(project.author.id)}`, "account-name")
        : el("span", "account-name", authorName(project)),
      el("span", "note", `// submitted ${formatDate(project.created_at)}`));
    byline.append(avatar(project.author || {}), who);
    article.append(byline, el("p", "hub-description", project.description), projectLinks(project, status));

    if (isMaterial && me && project.status === "published") article.append(await pathControls(project));

    // Published work is citable: one line to paste into a CV
    if (project.status === "published") {
      const cite = el("details", "account-details hub-cite");
      cite.append(el("summary", "account-details-summary", "// Cite this (for a CV)"));
      const text = citationFor(project, project.author && project.author.full_name);
      cite.append(el("p", "hub-cite-text", text), copyButton("COPY CITATION", () => text));
      if (isMaterial) cite.append(el("p", "note", "// The link opens for members only."));
      article.append(cite);
    }

    // Contact the author: a private message to their inbox on this site.
    // No email address is shown to either side.
    if (!me) {
      const invite = el("div", "hub-contact");
      invite.append(el("span", "note", "// Members can comment and message the author. "),
        hubLink("Sign in or request membership", "account.html"), el("span", "note", "."));
      article.append(invite);
    } else if (project.author && project.author.id === me.id) {
      const own = el("div", "hub-contact");
      own.append(el("span", "note", "// This is yours. Messages from members arrive in your "),
        hubLink("inbox", "inbox.html"), el("span", "note", "."));
      article.append(own);
    } else if (project.author && project.status === "published") {
      article.append(contactForm(project));
    }

    // Authors can fix an item that isn't published yet
    if (me && project.author && project.author.id === me.id && project.status !== "published") {
      const edit = el("p", "hub-edit");
      edit.append(hubLink(project.status === "rejected" ? "> EDIT AND RESUBMIT" : "> EDIT",
        `${kind.page}?view=edit&project=${encodeURIComponent(project.id)}`, "account-mod-link"));
      article.append(edit);
    }

    if (isModerator()) {
      const mod = el("div", "mod-actions hub-mod-actions");
      mod.append(el("span", "note", "// Moderator:"));
      if (project.status !== "published") {
        mod.append(button("PUBLISH", "mod-approve", () => review(project, "published", null, status)));
      }
      if (project.status !== "rejected") {
        mod.append(button(project.status === "published" ? "UNPUBLISH" : "REJECT", "mod-decline", () => {
          const note = window.prompt("Note for the author (optional):", "");
          if (note !== null) review(project, "rejected", note, status);
        }));
      }
      mod.append(button("DELETE", "mod-decline", async () => {
        if (!window.confirm(`Permanently delete "${project.title}" and its comments?`)) return;
        const { error: deleteError } = await deleteProject(project);
        if (deleteError) {
          status.textContent = `> FAILED: ${deleteError.message}`;
          status.classList.add("is-error");
        } else {
          window.location.href = kind.page;
        }
      }));
      article.append(mod);
    }

    article.append(status);
    const nodes = [toolbar(null), article];
    if (me && project.status === "published") nodes.push(await commentsSection(project));
    show(...nodes);
  }

  function contactForm(project) {
    const wrap = el("div", "hub-contact");
    wrap.append(button("CONTACT THE AUTHOR", "hub-contact-btn", () => {
      const form = el("form", "hub-comment-form hub-contact-form");
      const label = el("label", "join-label", `Private message to ${authorName(project)}`);
      label.htmlFor = "hub-contact-input";
      const input = el("textarea", "join-input");
      input.id = "hub-contact-input";
      input.rows = 4;
      input.maxLength = 2000;
      input.required = true;
      input.placeholder = "Questions, suggestions, or an idea to collaborate on.";
      const send = el("button", "join-submit", "> Send message");
      send.type = "submit";
      const formStatus = el("p", "join-status");
      formStatus.setAttribute("role", "status");
      form.append(label, input, send, formStatus,
        el("p", "join-hint", "// Only the author sees this, in their inbox on this site. No email addresses are shared. No patient information."));

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = input.value.trim();
        if (!body) return;
        send.disabled = true;
        const { error } = await db.from("project_messages").insert({
          project_id: project.id, sender_id: me.id, recipient_id: project.author.id, body,
        });
        if (error) {
          console.error(error);
          send.disabled = false;
          formStatus.textContent = "> COULD NOT SEND. Please try again.";
          formStatus.classList.add("is-error");
          return;
        }
        wrap.replaceChildren(el("span", "account-status", "> MESSAGE SENT. "),
          el("span", "note", "Replies will arrive in your "), hubLink("inbox", "inbox.html"), el("span", "note", "."));
      });
      wrap.replaceChildren(form);
      input.focus();
    }));
    return wrap;
  }

  async function review(project, newStatus, note, statusNode) {
    statusNode.textContent = "> SAVING...";
    statusNode.classList.remove("is-error");
    const { error } = await db.rpc("review_project", { target: project.id, new_status: newStatus, note });
    if (error) {
      statusNode.textContent = `> FAILED: ${error.message}`;
      statusNode.classList.add("is-error");
      return;
    }
    renderProject(project.id);
  }

  async function commentsSection(project) {
    const section = el("section", "hub-comments");
    const { data: comments, error } = await db
      .from("project_comments")
      .select("id, body, created_at, author:profiles!project_comments_author_id_fkey(id, full_name, avatar_url)")
      .eq("project_id", project.id)
      .order("created_at", { ascending: true });

    section.append(el("h3", "subsection-title", `// Questions & comments (${error ? "?" : comments.length})`));
    if (error) {
      section.append(el("p", "account-status is-error", "> COULD NOT LOAD COMMENTS."));
      return section;
    }

    const list = el("ul", "mod-list");
    for (const comment of comments) {
      const item = el("li", "mod-row hub-comment");
      const who = el("div", "account-who");
      const author = comment.author || {};
      who.append(
        el("span", "account-name", author.full_name || "Member"),
        el("span", "note", `// ${formatDate(comment.created_at)}`),
        el("span", "hub-comment-body", comment.body)
      );
      item.append(avatar(author), who);
      if (isModerator() || author.id === me.id) {
        item.append(button("DELETE", "mod-decline", async () => {
          if (!window.confirm("Delete this comment?")) return;
          const { error: deleteError } = await db.from("project_comments").delete().eq("id", comment.id);
          if (!deleteError) renderProject(project.id);
        }));
      }
      list.append(item);
    }
    if (comments.length) section.append(list);
    else section.append(el("p", "note", "// No comments yet. Ask the first question."));

    const form = el("form", "hub-comment-form");
    const label = el("label", "join-label", "Add a comment");
    label.htmlFor = "hub-comment-input";
    const input = el("textarea", "join-input");
    input.id = "hub-comment-input";
    input.rows = 3;
    input.maxLength = 2000;
    input.required = true;
    input.placeholder = "Ask a question or share feedback. No patient information.";
    const post = el("button", "join-submit", "> Post comment");
    post.type = "submit";
    const formStatus = el("p", "join-status");
    formStatus.setAttribute("role", "status");
    form.append(label, input, post, formStatus);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body) return;
      post.disabled = true;
      const { error: insertError } = await db
        .from("project_comments")
        .insert({ project_id: project.id, author_id: me.id, body });
      if (insertError) {
        post.disabled = false;
        formStatus.textContent = "> COULD NOT POST. Please try again.";
        formStatus.classList.add("is-error");
        return;
      }
      renderProject(project.id);
    });
    section.append(form);
    return section;
  }

  /* ---- submit form ---- */

  // With `existing`, the same form edits an unpublished item instead.
  async function renderSubmit(existing) {
    let folders = [];
    if (isMaterial) {
      try {
        folders = await loadFolders();
      } catch (err) {
        console.error(err);
        return fail("> COULD NOT LOAD FOLDERS. Please refresh the page.");
      }
    }

    const form = el("form", "account-panel hub-submit-form");
    const field = (labelText, control, stacked) => {
      const row = el("div", stacked ? "join-row join-row--stacked" : "join-row");
      const label = el("label", "join-label", labelText);
      label.htmlFor = control.id;
      row.append(label, control);
      return row;
    };
    const picker = (id, options) => {
      const select = el("select", "join-input");
      select.id = id;
      select.required = true;
      const blank = el("option", null, "Select one");
      blank.value = "";
      blank.disabled = true;
      blank.selected = true;
      select.append(blank, ...options.map((value) => el("option", null, value)));
      return select;
    };

    const title = el("input", "join-input");
    title.id = "project-title";
    title.type = "text";
    title.required = true;
    title.minLength = 3;
    title.maxLength = 120;
    title.placeholder = kind.titleHint;

    const folder = isMaterial ? picker("project-folder", folders.map((f) => f.name)) : null;
    const category = picker("project-category", kind.categories);

    const description = el("textarea", "join-input");
    description.id = "project-description";
    description.rows = 6;
    description.required = true;
    description.minLength = 20;
    description.maxLength = 4000;
    description.placeholder = kind.descriptionHint;

    const link = el("input", "join-input");
    link.id = "project-link";
    link.type = "url";
    link.maxLength = 500;
    link.pattern = "https://.+";
    link.placeholder = kind.linkHint;

    const file = el("input", "join-input");
    file.id = "project-file";
    file.type = "file";
    file.accept = PROJECT_FILE_ACCEPT;

    const confirmRow = el("label", "hub-confirm");
    const confirmBox = el("input");
    confirmBox.type = "checkbox";
    confirmBox.required = true;
    confirmRow.append(confirmBox, " I confirm this contains no patient information of any kind.");

    const submit = el("button", "join-submit",
      !existing ? "> Submit for review" : existing.status === "rejected" ? "> Save and resubmit" : "> Save changes");
    submit.type = "submit";
    const status = el("p", "join-status");
    status.setAttribute("role", "status");

    if (existing) {
      title.value = existing.title;
      category.value = existing.category;
      if (folder) folder.value = existing.folder || "";
      description.value = existing.description;
      link.value = existing.link_url || "";
      form.prepend(el("p", "account-status", `> EDITING: ${existing.title}`));
    }

    form.append(field("Title", title));
    if (folder) form.append(field("Folder", folder));
    form.append(
      field(kind.categoryLabel, category),
      field("Description", description, true),
      field("Link", link),
      field("File", file),
      el("p", "join-hint", existing && existing.file_name
        ? `// Current file: ${existing.file_name}. Choose a new one only to replace it (up to ${PROJECT_FILE_MAX_MB} MB).`
        : `// Optional file, up to ${PROJECT_FILE_MAX_MB} MB: PDF, image, Word, PowerPoint, Excel or text.`),
      confirmRow,
      submit,
      status,
      el("p", "join-hint", "// A moderator reviews every submission before members can see it.")
    );

    const setError = (text) => {
      status.textContent = text;
      status.classList.add("is-error");
      submit.disabled = false;
    };

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      status.classList.remove("is-error");
      submit.disabled = true;

      const chosen = file.files[0] || null;
      if (chosen && chosen.size > PROJECT_FILE_MAX_MB * 1024 * 1024) {
        return setError(`> THAT FILE IS LARGER THAN ${PROJECT_FILE_MAX_MB} MB.`);
      }

      const row = {
        author_id: me.id,
        kind: kindKey,
        folder: folder ? folder.value : null,
        title: title.value.trim(),
        category: category.value,
        description: description.value.trim(),
        link_url: link.value.trim() || null,
        file_path: existing ? existing.file_path : null,
        file_name: existing ? existing.file_name : null,
      };
      if (row.description.length < 20) return setError("> PLEASE WRITE A LONGER DESCRIPTION (20+ CHARACTERS).");

      if (chosen) {
        status.textContent = "> UPLOADING FILE...";
        const safeName = chosen.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-100);
        const path = `${me.id}/${crypto.randomUUID()}-${safeName}`;
        const { error: uploadError } = await db.storage
          .from(PROJECT_FILES_BUCKET)
          .upload(path, chosen, { contentType: chosen.type || undefined, upsert: false });
        if (uploadError) {
          console.error(uploadError);
          return setError("> COULD NOT UPLOAD THE FILE. Check its type and size, then try again.");
        }
        row.file_path = path;
        row.file_name = chosen.name.slice(0, 150);
      }

      if (existing) {
        status.textContent = "> SAVING...";
        // author_id and kind can't change; the database only accepts these columns
        const { title: t, category: c, description: d, link_url, file_path, file_name } = row;
        const changes = { title: t, category: c, description: d, link_url, file_path, file_name };
        if (isMaterial) changes.folder = row.folder;
        const { error: updateError } = await db.from("projects").update(changes).eq("id", existing.id);
        if (updateError) {
          console.error(updateError);
          return setError("> COULD NOT SAVE. Please try again.");
        }
        if (existing.status === "rejected") {
          const { error: resubmitError } = await db.rpc("resubmit_project", { target: existing.id });
          if (resubmitError) {
            console.error(resubmitError);
            return setError("> SAVED, BUT COULD NOT RESUBMIT. Please try again.");
          }
          notifyOrganizersOfProject(me, row);
        }
        window.location.href = `${kind.page}?project=${encodeURIComponent(existing.id)}`;
        return;
      }

      status.textContent = "> SUBMITTING...";
      const { error } = await db.from("projects").insert(row);
      if (error) {
        console.error(error);
        return setError("> COULD NOT SUBMIT. Please try again.");
      }

      notifyOrganizersOfProject(me, row);
      const done = el("div", "account-panel");
      done.append(
        el("p", "account-status", "> SUBMITTED FOR REVIEW"),
        el("p", null, `Thanks! A moderator will review your ${kind.noun}. You can follow its status under My submissions.`),
        hubLink("> MY SUBMISSIONS", `${kind.page}?view=mine`, "account-mod-link")
      );
      show(toolbar("submit"), done);
    });

    show(toolbar(existing ? null : "submit"), form);
  }

  // Open the edit form for one of the person's own unpublished items
  async function renderEdit(id) {
    const { data: project, error } = await db
      .from("projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle();
    if (error) return fail(`> COULD NOT LOAD THIS ${kind.noun.toUpperCase()}. Please refresh the page.`);
    if (!project || !project.author || project.author.id !== me.id || project.status === "published" || project.kind !== kindKey) {
      show(toolbar(null), el("p", "account-status is-error", "> THIS CAN'T BE EDITED"),
        el("p", "note", "// You can edit your own submissions until they're published. To change a published one, ask a moderator."));
      return;
    }
    await renderSubmit(project);
  }

  /* ---- start ---- */

  (async () => {
    show(loadingBlock());
    try {
      const { session, profile } = await getSessionAndProfile();
      const approved = !!profile && ["member", "moderator", "admin"].includes(profile.role);

      // The outside library on learn.html (static, hidden until now)
      const library = document.getElementById("learning-library");
      if (library) library.hidden = !approved || !!params.get("project") || !!params.get("view");

      if (approved) {
        me = profile;
      } else if (isMaterial || ["submit", "mine", "edit"].includes(params.get("view"))) {
        // Learning Materials, and submitting or managing your own items, need membership
        show(el("p", "account-status", "> MEMBERS ONLY"),
          el("p", null, !session ? kind.intro
            : `Your membership isn't active yet. This opens once a moderator approves your request.`),
          hubLink(!session ? "> SIGN IN OR REQUEST MEMBERSHIP" : "> CHECK YOUR STATUS", "account.html", "account-mod-link"));
        return;
      }
      // Otherwise: a visitor browsing published projects, read-only (me stays null)

      if (params.get("view") === "edit" && params.get("project")) await renderEdit(params.get("project"));
      else if (params.get("project")) await renderProject(params.get("project"));
      else if (params.get("view") === "submit") await renderSubmit();
      else if (params.get("view") === "mine") await renderMine();
      else await renderList();
    } catch (err) {
      console.error(err);
      fail(`> COULD NOT LOAD ${kind.name.toUpperCase()}. Please refresh the page.`);
    }
  })();
}

/* ========= MODERATION PAGE: project and material submissions ========= */

function initProjectModeration() {
  const app = document.getElementById("moderate-projects");
  if (!app) return;

  async function load(message) {
    const { data: projects, error } = await db
      .from("projects")
      .select(PROJECT_COLUMNS)
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    const status = el("p", "account-status mod-status", message || "");
    status.setAttribute("role", "status");
    const section = el("section", "mod-section");
    section.append(el("h3", "subsection-title", `// Submissions to review (${error ? "?" : projects.length})`), status);

    if (error) {
      section.append(el("p", "account-status is-error", "> COULD NOT LOAD SUBMISSIONS."));
    } else if (!projects.length) {
      section.append(el("p", "note", "No projects or learning materials waiting for review."));
    } else {
      const list = el("ul", "mod-list");
      for (const project of projects) {
        const kind = hubKind(project);
        const where = project.folder ? `${project.folder} / ${project.category}` : project.category;
        const row = el("li", "mod-row hub-review-row");
        const who = el("div", "account-who");
        who.append(
          hubLink(project.title, `${kind.page}?project=${encodeURIComponent(project.id)}`, "account-name"),
          el("span", "mod-detail", `${kind.noun.toUpperCase()} · ${where} · by ${authorName(project)} · ${formatDate(project.created_at)}`),
          el("span", "mod-detail hub-description", project.description),
          projectLinks(project, status)
        );
        const actions = el("div", "mod-actions");
        const act = async (label, newStatus, note) => {
          status.textContent = `> ${label}...`;
          status.classList.remove("is-error");
          const { error: rpcError } = await db.rpc("review_project", { target: project.id, new_status: newStatus, note });
          if (rpcError) {
            status.textContent = `> FAILED: ${rpcError.message}`;
            status.classList.add("is-error");
            return;
          }
          load(`> DONE: ${label}`);
        };
        actions.append(
          button("PUBLISH", "mod-approve", () => act(`Publishing "${project.title}"`, "published", null)),
          button("REJECT", "mod-decline", () => {
            const note = window.prompt("Note for the author (optional):", "");
            if (note !== null) act(`Rejecting "${project.title}"`, "rejected", note);
          }),
          button("DELETE", "mod-decline", async () => {
            if (!window.confirm(`Permanently delete "${project.title}"?`)) return;
            const { error: deleteError } = await deleteProject(project);
            if (deleteError) {
              status.textContent = `> FAILED: ${deleteError.message}`;
              status.classList.add("is-error");
            } else {
              load(`> DONE: deleted "${project.title}"`);
            }
          })
        );
        row.append(who, actions);
        list.append(row);
      }
      section.append(list);
    }
    const links = el("p", "hub-mod-links");
    links.append(
      hubLink("> Open the Projects hub", HUB_KINDS.project.page, "account-mod-link"),
      hubLink("> Open Learning Materials", HUB_KINDS.material.page, "account-mod-link")
    );
    section.append(links);
    app.replaceChildren(section);
  }

  (async () => {
    try {
      const { profile } = await getSessionAndProfile();
      if (profile && ["moderator", "admin"].includes(profile.role)) await load();
    } catch (err) {
      console.error(err);
    }
  })();
}

document.addEventListener("DOMContentLoaded", initHubPage);
document.addEventListener("DOMContentLoaded", initProjectModeration);
