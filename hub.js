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
    name: "Learning Materials",
    noun: "material",
    plural: "materials",
    allLabel: "ALL MATERIALS",
    submitLabel: "> ADD A MATERIAL",
    categoryLabel: "Type",
    categories: ["Presentation", "Module", "Guide", "Video", "Other"],
    intro: "Learning Materials is the members' library of presentations, modules and guides for building AI skills.",
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
  "id, kind, folder, title, category, description, link_url, file_path, file_name, status, review_note, created_at, " +
  "author:profiles!projects_author_id_fkey(id, full_name, email, avatar_url)";

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
  return (project.author && (project.author.full_name || project.author.email)) || "Unknown member";
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
  let me = null;
  const isModerator = () => me.role === "moderator" || me.role === "admin";

  function fail(text) {
    show(el("p", "account-status is-error", text));
  }

  function toolbar(current) {
    const bar = el("div", "hub-toolbar");
    const items = [
      ["all", kind.allLabel, kind.page],
      ["mine", "MY SUBMISSIONS", `${kind.page}?view=mine`],
      ["submit", kind.submitLabel, `${kind.page}?view=submit`],
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
      .select(PROJECT_COLUMNS)
      .eq("kind", kindKey)
      .eq("status", "published")
      .order("created_at", { ascending: false });
    if (error) return fail(`> COULD NOT LOAD ${kind.plural.toUpperCase()}. Please refresh the page.`);

    const nodes = [toolbar("all")];
    if (message) nodes.push(el("p", "account-status hub-status", message));

    if (isMaterial) {
      nodes.push(...(await folderNodes(projects)));
    } else if (!projects.length) {
      nodes.push(el("p", "note", "// No projects published yet. Be the first to submit one."));
    } else {
      nodes.push(...categoryNodes(projects));
    }
    show(...nodes);
  }

  // Projects: one list with category filter buttons
  function categoryNodes(projects) {
    const list = el("div", "projects-list");
    const cards = projects.map((project) => {
      const card = projectCard(project, false);
      card.dataset.category = project.category;
      list.append(card);
      return card;
    });

    const used = kind.categories.filter((c) => projects.some((p) => p.category === c));
    const filter = el("div", "filter-bar");
    filter.setAttribute("role", "group");
    filter.setAttribute("aria-label", "Filter projects by category");
    const buttons = ["All", ...used].map((category) => {
      const count = category === "All" ? projects.length : projects.filter((p) => p.category === category).length;
      const btn = button(`${category.toUpperCase()} (${count})`, "filter-btn", () => {
        buttons.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
        cards.forEach((card) => { card.hidden = category !== "All" && card.dataset.category !== category; });
      });
      btn.setAttribute("aria-pressed", String(category === "All"));
      filter.append(btn);
      return btn;
    });
    return [filter, list];
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
      nodes.push(el("p", "note", `// You haven't submitted a ${kind.noun} yet.`));
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
      .from("projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle();
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
    who.append(el("span", "account-name", authorName(project)),
      el("span", "note", `// submitted ${formatDate(project.created_at)}`));
    byline.append(avatar(project.author || {}), who);
    article.append(byline, el("p", "hub-description", project.description), projectLinks(project, status));

    // Contact the author: the email is shown only on request, to signed-in members
    if (project.author && project.author.email) {
      const contact = el("div", "hub-contact");
      contact.append(button("CONTACT THE AUTHOR", "hub-contact-btn", () => {
        const mail = hubLink(project.author.email,
          `mailto:${project.author.email}?subject=${encodeURIComponent(`AI Medicine Collective: ${project.title}`)}`);
        contact.replaceChildren(el("span", null, "Email: "), mail,
          el("span", "note", " // for questions, suggestions or collaboration"));
      }));
      article.append(contact);
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
    if (project.status === "published") nodes.push(await commentsSection(project));
    show(...nodes);
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
      .select("id, body, created_at, author:profiles!project_comments_author_id_fkey(id, full_name, email, avatar_url)")
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
        el("span", "account-name", author.full_name || author.email || "Member"),
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

  async function renderSubmit() {
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

    const submit = el("button", "join-submit", "> Submit for review");
    submit.type = "submit";
    const status = el("p", "join-status");
    status.setAttribute("role", "status");

    form.append(field("Title", title));
    if (folder) form.append(field("Folder", folder));
    form.append(
      field(kind.categoryLabel, category),
      field("Description", description, true),
      field("Link", link),
      field("File", file),
      el("p", "join-hint", `// Optional file, up to ${PROJECT_FILE_MAX_MB} MB: PDF, image, Word, PowerPoint, Excel or text.`),
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
        file_path: null,
        file_name: null,
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

    show(toolbar("submit"), form);
  }

  /* ---- start ---- */

  (async () => {
    show(el("p", "account-status", "> CHECKING ACCESS..."));
    try {
      const { session, profile } = await getSessionAndProfile();
      if (!session) {
        show(el("p", "account-status", "> MEMBERS ONLY"),
          el("p", null, kind.intro),
          hubLink("> SIGN IN OR REQUEST MEMBERSHIP", "account.html", "account-mod-link"));
        return;
      }
      if (!profile || !["member", "moderator", "admin"].includes(profile.role)) {
        show(el("p", "account-status", "> MEMBERS ONLY"),
          el("p", null, `Your membership isn't active yet. ${kind.name} opens once a moderator approves your request.`),
          hubLink("> CHECK YOUR STATUS", "account.html", "account-mod-link"));
        return;
      }
      me = profile;

      if (params.get("project")) await renderProject(params.get("project"));
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
