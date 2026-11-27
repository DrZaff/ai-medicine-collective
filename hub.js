// === AI Medicine Collective: Member Creations (the projects table) + Learning Materials ===
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
// Category lists must match the CHECK constraint in migration 025 (creations)
// and 004 (materials).
const HUB_KINDS = {
  project: {
    page: "hub.html",
    name: "Member Creations",
    noun: "creation",
    plural: "creations",
    allLabel: "ALL CREATIONS",
    submitLabel: "> SHARE YOUR CREATION",
    categoryLabel: "Category",
    categories: [
      "Clinical tools & calculators", "Study tools & Anki add-ons", "Games",
      "AI assistants & GPTs", "Research tools", "Lifestyle & wellbeing",
      "Websites", "Other",
    ],
    intro: "Member Creations is where the Collective's members share what they have built.",
    titleHint: "e.g. Discharge summary helper",
    descriptionHint: "What does it do, who is it for, and how do people use it?",
    linkHint: "https://… (custom GPT, app, game, website; optional)",
    linkText: "Open",
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
    intro: "Learning is for members: the Collective's own presentations and guides, and a picked library of videos, courses and references. It's free to join.",
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

/* ========= Member Creations: categories and previews (migration 025) ========= */

// Until migration 025 has run, the database holds (and only accepts) the old
// categories, and there is no preview_path column. The page asks once which
// it is (creationsUpgraded) and works either way.
const LEGACY_CREATION_CATEGORIES = [
  "Medical education", "Patient care", "Research", "Guidelines",
  "Learning", "Lifestyle", "Productivity", "Other",
];
const LEGACY_CREATION_GROUPS = {
  "Patient care": "Clinical tools & calculators",
  Guidelines: "Clinical tools & calculators",
  "Medical education": "Study tools & Anki add-ons",
  Learning: "Study tools & Anki add-ons",
  Research: "Research tools",
  Lifestyle: "Lifestyle & wellbeing",
  Productivity: "Other",
};

// One line per category for the "what are you looking for?" row: the
// picture (a key of ICON_ART in initHubPage) and who it is for
const CREATION_INTERESTS = {
  "Clinical tools & calculators": { art: "calculator", forYou: "For bedside decisions: scores, calculators and algorithms." },
  "Study tools & Anki add-ons": { art: "cards", forYou: "For exams and boards: flashcards, Anki add-ons and study aids." },
  Games: { art: "game", forYou: "For the break room: games with a medical twist." },
  "AI assistants & GPTs": { art: "chat", forYou: "For a second pair of hands: custom GPTs and AI helpers." },
  "Research tools": { art: "research", forYou: "For papers and projects: searching, analysis and writing help." },
  "Lifestyle & wellbeing": { art: "fitness", forYou: "For you, off shift: fitness, sleep and wellbeing." },
  Websites: { art: "globe", forYou: "For browsing: sites and resources members have built." },
  Other: { art: "spark", forYou: "Everything else worth a look." },
};

const NEAPOLITAN_GPT = "https://chatgpt.com/g/g-68c8846d98948191a1bfba004e2b1dbf";

// The group a creation is shown under, whichever categories the database has
function creationGroup(project) {
  if (project.kind && project.kind !== "project") return project.category;
  let group = LEGACY_CREATION_GROUPS[project.category] || project.category;
  // As migration 025 does: the Neapolitan Personality Quiz (an ice-cream
  // personality quiz) is just for fun, so Games; other custom GPTs are assistants
  if (group === "Other" && (project.link_url || "").startsWith(NEAPOLITAN_GPT)) group = "Games";
  else if (group === "Other" && /^https:\/\/chatgpt\.com\/g\//.test(project.link_url || "")) group = "AI assistants & GPTs";
  return CREATION_INTERESTS[group] ? group : "Other";
}

// Must match the bucket in migration 025
const CREATION_PREVIEWS_BUCKET = "creation-previews";
const CREATION_PREVIEW_MAX_MB = 2;
const CREATION_PREVIEW_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

// Screenshots taken of the creations that were published on 2026-11-16,
// matched by web address (host, or host + path). A preview the author
// uploads wins over these; anything else gets drawn art.
const CREATION_SHOTS = {
  "obesityphenotypetest.netlify.app": "images/creations/obesity-phenotype.webp",
  "acid-base-calculator.netlify.app": "images/creations/acid-base-calculator.webp",
  "heart-score-calculator.netlify.app": "images/creations/heart-score-calculator.webp",
  "qtc-calc.netlify.app": "images/creations/qtc-calc.webp",
  "thyroid-cascader.netlify.app": "images/creations/thyroid-cascader.webp",
  "va-night-algorithm.netlify.app": "images/creations/va-night-algorithm.webp",
};

// Small copies of the Collective's app logos (images/applogos/*_logo_512.png
// are about 300 KB each), shown on the corner of their previews
const CREATION_BADGES = {
  "acid-base-calculator.netlify.app": "images/creations/logo-abg.webp",
  "heart-score-calculator.netlify.app": "images/creations/logo-hs.webp",
  "qtc-calc.netlify.app": "images/creations/logo-qtc.webp",
  "thyroid-cascader.netlify.app": "images/creations/logo-tc.webp",
  "va-night-algorithm.netlify.app": "images/creations/logo-nf.webp",
};

// The Collective's own games (games.html) are creations too: shown in the
// Games group with their gameplay screenshots. Add a new game here as well.
const SITE_GAMES = [
  {
    title: "Bearcat Pinball", href: "games/bearcat-pinball.html", image: "images/games/bearcat-pinball.webp",
    description: "Night shift pinball. Ride the Medevac ramp, admit to the ICU and work your way from MS1 to Attending.",
    alt: "Bearcat Pinball in play: red pop bumpers and the Bearcat mascot on the playfield",
  },
  {
    title: "Antibiose", href: "games/antibiose.html", image: "images/games/antibiose.webp",
    description: "Load an antibiotic, antiviral, antifungal or antiparasitic and hit only the microbes it really kills.",
    alt: "Antibiose in play: microbes drifting across a microscope field",
  },
  {
    title: "Hospital Kombat", href: "games/hospital-kombat.html", image: "images/games/hospital-kombat.webp",
    description: "Pick a specialty and fight. Nine fighters, five hospital stages and a Final Procedure for each.",
    alt: "Hospital Kombat in play: a cardiologist and a hospitalist trading punches in an operating room",
  },
  {
    title: "Hospital Tycoon", href: "games/hospital-tycoon.html", image: "images/games/hospital-tycoon.webp",
    description: "Build a hospital floor by floor, hire specialists, balance RVUs and patient care, and survive five years of crises.",
    alt: "Hospital Tycoon in play: a two-floor hospital with busy wards",
  },
];

// Other things the site itself offers, listed with the members' creations
const SITE_CREATIONS = [
  {
    title: "Signature Card Studio", href: "signature-card-studio.html", group: "Other", art: "document",
    description: "Design and download a business card in your browser.",
  },
  {
    title: "CSV Cleaner", href: "apps/csv-cleaner.html", group: "Research tools", art: "table",
    description: "Clean a CSV or Excel export in one click: duplicates, extra spaces, capitalization, dates and your own rules, with every change listed and missing values flagged, never filled in. Files stay in your browser.",
  },
];

let creationsUpgradeCheck = null;
// Whether migration 025 has run: asks for the new column once per page
// (before it exists, the database answers this one request with an error)
function creationsUpgraded() {
  if (!creationsUpgradeCheck) {
    creationsUpgradeCheck = db.from("projects").select("preview_path").limit(1)
      .then(({ error }) => !error, () => false);
  }
  return creationsUpgradeCheck;
}

function creationPreviewUrl(path) {
  return db.storage.from(CREATION_PREVIEWS_BUCKET).getPublicUrl(path).data.publicUrl;
}

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
  let signedIn = false; // has a session, even if not approved yet
  const isModerator = () => !!me && (me.role === "moderator" || me.role === "admin");
  // true once migration 025 has run (checked at start, Member Creations only)
  let upgraded = false;
  const withPreview = (cols) => (upgraded ? `${cols}, preview_path` : cols);
  const memberColumns = () => withPreview(PROJECT_COLUMNS);
  const columns = () => withPreview(me ? PROJECT_COLUMNS : PROJECT_PUBLIC_COLUMNS);
  // the categories the database accepts right now
  const categoryChoices = () => (isMaterial || upgraded ? kind.categories : LEGACY_CREATION_CATEGORIES);
  const shownCategory = (project) => (isMaterial ? project.category : creationGroup(project));

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
          ["submit", isMaterial ? "> SIGN IN TO SUBMIT OR COMMENT" : "> SIGN IN TO SHARE OR COMMENT", "account.html"],
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
    head.append(el("span", "project-title", project.title), el("span", "member-tag hub-cat", shownCategory(project)));
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

    // Visitors to Member Creations get the invitation in the hero instead
    const nodes = isMaterial || me ? [toolbar("all")] : [];
    if (message) nodes.push(el("p", "account-status hub-status", message));

    if (isMaterial) {
      // On the Learning page the folders sit below the outside library, in
      // their own container
      const shelfNodes = await folderNodes(projects);
      const shelves = document.getElementById("learning-shelves");
      if (shelves) {
        shelves.replaceChildren(...shelfNodes);
        shelves.hidden = false;
      } else {
        nodes.push(...shelfNodes);
      }
    } else {
      // The site's own games are always there, so this list is never empty
      nodes.unshift(creationsHero());
      nodes.push(...creationsNodes(projects));
    }
    show(...nodes);
  }

  /* ---- Member Creations: links, recently opened, drawn icons ---- */

  // A tool's link, if it is one that can be opened from here
  function toolUrl(project) {
    try {
      const url = new URL(project.link_url || "");
      return url.protocol === "https:" ? url : null;
    } catch {
      return null;
    }
  }

  // Opening a tool is remembered on this device (script.js's keys): it fills
  // the "Recently opened" row and ticks "Try a tool" on the account page
  const recentKey = typeof TOOL_RECENT_KEY === "string" ? TOOL_RECENT_KEY : "amc-recent-tools";
  const usedKey = typeof TOOL_USED_KEY === "string" ? TOOL_USED_KEY : "amc-tool-used";
  function recentTools() {
    try {
      const ids = JSON.parse(localStorage.getItem(recentKey) || "[]");
      return Array.isArray(ids) ? ids : [];
    } catch {
      return [];
    }
  }
  function rememberTool(id) {
    try {
      localStorage.setItem(recentKey, JSON.stringify([id, ...recentTools().filter((x) => x !== id)].slice(0, 4)));
      localStorage.setItem(usedKey, "1");
    } catch {
      // nothing remembered; the page still works
    }
  }

  function openLink(project, url, label, className) {
    const link = el("a", className, label);
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.addEventListener("click", () => rememberTool(project.id));
    return link;
  }

  // Tools without their own icon get one drawn for them, in the same line-art
  // style as the Games page: a picture chosen from the tool's name and
  // description (a calculator, a heart, flash cards...), else from its category
  const ICON_ART = {
    calculator: '<rect class="a soft" x="16" y="8" width="32" height="48" rx="4" stroke-width="3"/>' +
      '<rect class="b" x="22" y="14" width="20" height="9" rx="2" stroke-width="3"/>' +
      '<circle class="fa" cx="24" cy="33" r="2.5"/><circle class="fa" cx="32" cy="33" r="2.5"/><circle class="fa" cx="40" cy="33" r="2.5"/>' +
      '<circle class="fa" cx="24" cy="41" r="2.5"/><circle class="fa" cx="32" cy="41" r="2.5"/><circle class="fa" cx="40" cy="41" r="2.5"/>' +
      '<circle class="fa" cx="24" cy="49" r="2.5"/><circle class="fa" cx="32" cy="49" r="2.5"/><path class="b" d="M40 46v6" stroke-width="3"/>',
    heart: '<path class="a soft" d="M32 54C14 42 8 32 8 23a11 11 0 0 1 24-6 11 11 0 0 1 24 6c0 9-6 19-24 31z" stroke-width="3"/>' +
      '<path class="b" d="M12 31h10l4-8 6 15 4-7h16" stroke-width="3"/>',
    education: '<path class="a soft" d="M4 26 32 14l28 12-28 12z" stroke-width="3"/>' +
      '<path class="a" d="M16 32v11c8 7 24 7 32 0V32" stroke-width="3"/><path class="b" d="M60 26v15" stroke-width="3"/>',
    cards: '<rect class="a soft" x="9" y="17" width="28" height="36" rx="3" transform="rotate(-10 23 35)" stroke-width="3"/>' +
      '<rect class="a soft" x="25" y="10" width="30" height="38" rx="3" stroke-width="3"/>' +
      '<path class="b" d="M32 22h16M32 30h12" stroke-width="3"/><circle class="fa" cx="44" cy="40" r="2.5"/>',
    document: '<path class="a soft" d="M16 6h22l12 12v40H16z" stroke-width="3"/><path class="a" d="M38 6v12h12" stroke-width="3"/>' +
      '<path class="b" d="M22 30h20M22 38h20M22 46h12" stroke-width="3"/>',
    fitness: '<path class="a" d="M15 20v24M8 25v14M49 20v24M56 25v14" stroke-width="4"/><path class="b" d="M15 32h34" stroke-width="4"/>',
    research: '<circle class="a soft" cx="27" cy="27" r="16" stroke-width="3"/><path class="b" d="M39 39l15 15" stroke-width="4"/>' +
      '<path class="a" d="M20 30l5-6 4 4 6-8" stroke-width="2.5"/>',
    chat: '<path class="a soft" d="M8 12h48v30H30l-12 11V42H8z" stroke-width="3"/>' +
      '<circle class="fa" cx="21" cy="27" r="2.5"/><circle class="fa" cx="32" cy="27" r="2.5"/><circle class="fa" cx="43" cy="27" r="2.5"/>' +
      '<path class="b" d="M52 4v6M49 7h6" stroke-width="2.5"/>',
    checklist: '<rect class="a soft" x="14" y="10" width="36" height="46" rx="3" stroke-width="3"/>' +
      '<rect class="b" x="24" y="6" width="16" height="8" rx="2" stroke-width="3"/>' +
      '<path class="b" d="M20 27l3 3 6-6M20 41l3 3 6-6" stroke-width="3"/><path class="a" d="M34 28h10M34 42h10" stroke-width="3"/>',
    spark: '<path class="a soft" d="M32 6l6 18 18 8-18 8-6 18-6-18-18-8 18-8z" stroke-width="3"/>' +
      '<path class="b" d="M52 6v8M48 10h8M12 48v8M8 52h8" stroke-width="2.5"/>',
    game: '<path class="a soft" d="M18 20h28c7 0 12 6 13 14l2 12c1 6-6 9-10 4l-6-7H19l-6 7c-4 5-11 2-10-4l2-12c1-8 6-14 13-14z" stroke-width="3"/>' +
      '<path class="b" d="M20 27v10M15 32h10" stroke-width="3"/><circle class="fa" cx="42" cy="29" r="2.5"/><circle class="fa" cx="48" cy="35" r="2.5"/>',
    table: '<rect class="a soft" x="6" y="14" width="40" height="42" rx="4" stroke-width="3"/>' +
      '<path class="a" d="M6 26h40M6 37h40M6 48h40M19 14v42" stroke-width="2.5"/>' +
      '<path class="b" d="M51 28l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" stroke-width="2.5"/><path class="b" d="M55 8v8M51 12h8" stroke-width="2.5"/>',
    globe: '<circle class="a soft" cx="32" cy="32" r="24" stroke-width="3"/>' +
      '<path class="b" d="M8 32h48M32 8c-8 8-8 40 0 48M32 8c8 8 8 40 0 48" stroke-width="2.5"/>',
  };
  // First match wins: words in the name or description, then the category
  const ICON_WORDS = [
    [/calculat|score|\bcalc\b|dose|dosing|formula/, "calculator"],
    [/algorithm|guideline|protocol|checklist|workup|pathway/, "checklist"],
    [/anki|flashcard|quiz|question bank|\bqbank\b/, "cards"],
    [/workout|fitness|exercise|trainer|gym/, "fitness"],
    [/heart|cardi|\becg\b|\bekg\b|\bqtc?\b/, "heart"],
    [/writ|statement|summar|\bnote|letter|discharge|document/, "document"],
    [/meeting|\bchat\b|assistant|tutor|coach/, "chat"],
    [/\bcsv\b|spreadsheet|excel|data clean/, "table"],
    [/research|evidence|literature|paper|search/, "research"],
    [/educat|learn|teach|study|board|exam|curricul/, "education"],
    [/reflect|introspect|wellness|well-being|wellbeing|mindful|alignment/, "spark"],
  ];
  const ICON_CATEGORIES = {
    "Medical education": "education", Learning: "education", "Patient care": "heart", Research: "research",
    Guidelines: "checklist", Lifestyle: "fitness", Productivity: "document",
  };

  function generatedIcon(project) {
    // The name decides first; then the description, minus the stock note
    // every custom GPT carries
    const title = project.title.toLowerCase();
    const about = String(project.description || "").toLowerCase().replace(/custom gpt[^.]*\.?/g, "");
    const found = ICON_WORDS.find(([pattern]) => pattern.test(title)) || ICON_WORDS.find(([pattern]) => pattern.test(about));
    const art = found ? found[1]
      : ICON_CATEGORIES[project.category] || (CREATION_INTERESTS[creationGroup(project)] || {}).art || "spark";
    return artIcon(art, "tool-icon tool-icon--made game-icon");
  }

  // One of the ICON_ART drawings in a tile
  function artIcon(art, className) {
    const icon = el("span", className);
    icon.setAttribute("aria-hidden", "true");
    // the drawing is our own fixed markup, never text from the tool
    icon.innerHTML = `<svg viewBox="0 0 64 64">${ICON_ART[art] || ICON_ART.spark}</svg>`;
    return icon;
  }

  /* ---- Member Creations: by interest, with a preview of each ---- */

  // The invitation at the top: what this is, and how to add yours
  function creationsHero() {
    const hero = el("section", "creations-hero");
    hero.append(
      el("h3", "creations-hero-title", "Built by clinicians, for clinicians"),
      el("p", "creations-hero-text",
        "Calculators, study aids, custom GPTs and games that members made for their own work. Free to use in your browser.")
    );
    const actions = el("div", "creations-cta");
    if (me) {
      actions.append(hubLink("> Share your creation", `${kind.page}?view=submit`, "btn btn--primary"),
        el("span", "note", "// A moderator checks each one before it appears here."));
    } else if (signedIn) {
      actions.append(hubLink("> Check your membership", "account.html", "btn btn--primary"),
        el("span", "note", "// You can share your own once a moderator approves your membership."));
    } else {
      const join = hubLink("> Join to share yours", "join.html", "btn btn--primary");
      join.setAttribute("data-signed-out-only", "");
      actions.append(join, hubLink("> Sign in", "account.html", "btn"));
    }
    hero.append(actions);
    return hero;
  }

  // A published creation, in the shape the cards use
  function creationItem(project) {
    const url = toolUrl(project);
    let image = null;
    if (project.preview_path) {
      image = creationPreviewUrl(project.preview_path);
    } else if (url) {
      image = CREATION_SHOTS[url.hostname + url.pathname.replace(/\/$/, "")] || CREATION_SHOTS[url.hostname] || null;
    }
    return {
      project,
      title: project.title,
      description: project.description,
      group: creationGroup(project),
      author: authorName(project),
      details: `${kind.page}?project=${encodeURIComponent(project.id)}`,
      url,
      // one line on what it is and where it works
      sort: !url || /\.(xlsx|docx|pptx|pdf)$/i.test(url.pathname) ? "File · download to use"
        : url.hostname === "chatgpt.com" ? "Custom GPT · opens in ChatGPT"
        : "Web app · phone or computer",
      image,
      alt: `${project.title}: preview`,
      badge: url ? CREATION_BADGES[url.hostname] || null : null,
    };
  }

  function gameItem(game) {
    return {
      project: null,
      title: game.title,
      description: game.description,
      group: "Games",
      author: "AI Medicine Collective",
      details: "games.html",
      play: game.href,
      playLabel: "> PLAY",
      sort: "Game · plays in your browser",
      image: game.image,
      alt: game.alt,
    };
  }

  function siteItem(entry) {
    return {
      project: null,
      title: entry.title,
      description: entry.description,
      group: entry.group,
      author: "AI Medicine Collective",
      play: entry.href,
      playLabel: "> OPEN",
      sort: "On this site · phone or computer",
      image: null,
      art: entry.art,
    };
  }

  // The drawn picture used when a creation has no screenshot
  function creationArt(item) {
    const art = el("span", "creation-art");
    art.append(item.project ? generatedIcon(item.project)
      : artIcon(item.art || CREATION_INTERESTS[item.group].art, "tool-icon tool-icon--made game-icon"));
    return art;
  }

  // Preview picture (16:10), title, one line on what it does, who made it,
  // and Open (or Play) + Details
  function creationCard(item) {
    const card = el("article", "creation-card");
    const pic = el("a", "creation-preview");
    pic.href = item.play || item.details;
    pic.tabIndex = -1; // the title link below is the keyboard stop
    if (item.image) {
      const img = el("img", "creation-shot");
      img.src = item.image;
      img.alt = item.alt;
      img.width = 720;
      img.height = 450;
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("error", () => img.replaceWith(creationArt(item)), { once: true });
      pic.append(img);
    } else {
      pic.setAttribute("aria-label", item.title);
      pic.append(creationArt(item));
    }
    if (item.badge) {
      const badge = el("img", "creation-badge");
      badge.src = item.badge;
      badge.alt = "";
      badge.width = 40;
      badge.height = 40;
      badge.loading = "lazy";
      pic.append(badge);
    }

    const body = el("div", "creation-body");
    body.append(el("span", "member-tag hub-cat creation-sort", item.sort));
    const title = el("h4", "creation-title");
    title.append(hubLink(item.title, item.play || item.details, "creation-title-link"));
    body.append(title, el("p", "creation-desc", String(item.description || "").replace(/\s+/g, " ").trim()));
    body.append(el("span", "hub-card-meta creation-by", `// by ${item.author}`));

    const actions = el("div", "creation-actions");
    if (item.play) actions.append(hubLink(item.playLabel, item.play, "btn btn--primary"));
    else if (item.url) actions.append(openLink(item.project, item.url, "> OPEN", "btn btn--primary"));
    if (item.details) actions.append(hubLink(item.play ? "> ALL GAMES" : "> DETAILS", item.details, "btn"));
    body.append(actions);

    card.append(pic, body);
    card.dataset.group = item.group;
    card.dataset.search = `${item.title} ${item.description} ${item.group} ${item.sort} ${item.author}`.toLowerCase();
    return card;
  }

  const creationSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  // Interest cards with counts, a search box, then one section per category
  function creationsNodes(projects) {
    const items = [...SITE_GAMES.map(gameItem), ...projects.map(creationItem), ...SITE_CREATIONS.map(siteItem)];
    const groups = HUB_KINDS.project.categories;
    const plural = (n) => `${n} creation${n === 1 ? "" : "s"}`;

    // one section per category that has something in it
    const sectionsWrap = el("div", "creations-sections");
    const sections = [];
    const cards = [];
    for (const group of groups) {
      const inGroup = items.filter((item) => item.group === group);
      if (!inGroup.length) continue;
      const section = el("section", "creations-section");
      section.id = `creations-${creationSlug(group)}`;
      const head = el("div", "creations-section-head");
      head.append(artIcon(CREATION_INTERESTS[group].art, "game-icon creations-section-icon"),
        el("h3", "creations-section-title", group),
        el("span", "creations-count", plural(inGroup.length)));
      const grid = el("div", "creations-grid");
      const groupCards = inGroup.map(creationCard);
      grid.append(...groupCards);
      cards.push(...groupCards);
      section.append(head, el("p", "note creations-for", CREATION_INTERESTS[group].forYou), grid);
      sections.push([section, groupCards]);
      sectionsWrap.append(section);
    }

    const search = el("input", "join-input directory-search creations-search");
    search.type = "search";
    search.placeholder = "Search creations";
    search.setAttribute("aria-label", "Search creations by name, description or author");
    const shown = el("p", "roster-stats");
    shown.setAttribute("role", "status");
    const none = el("p", "note", "// Nothing matches that. Try a different word or interest.");

    let chosen = "All";
    const chips = [];
    const apply = () => {
      const term = search.value.trim().toLowerCase();
      let visible = 0;
      cards.forEach((card) => {
        card.hidden = (chosen !== "All" && card.dataset.group !== chosen) || (!!term && !card.dataset.search.includes(term));
        if (!card.hidden) visible++;
      });
      sections.forEach(([section, groupCards]) => { section.hidden = groupCards.every((card) => card.hidden); });
      chips.forEach((chip) => chip.setAttribute("aria-pressed", String(chip.dataset.group === chosen)));
      shown.textContent = visible === cards.length ? `> ${plural(cards.length)}` : `> ${visible} of ${plural(cards.length)}`;
      none.hidden = visible > 0;
    };

    // "What are you looking for?": one card per interest, with its count
    const interests = el("div", "creations-interests");
    interests.setAttribute("role", "group");
    interests.setAttribute("aria-label", "Browse creations by interest");
    const choose = (group) => {
      chosen = chosen === group ? "All" : group;
      apply();
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      search.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    };
    for (const group of ["All", ...groups]) {
      const n = group === "All" ? items.length : items.filter((item) => item.group === group).length;
      const info = CREATION_INTERESTS[group] || { art: "spark", forYou: "Everything members have shared." };
      let chip;
      if (n) {
        chip = button("", "creation-interest", () => choose(group));
        chip.dataset.group = group;
        chips.push(chip);
      } else {
        // nothing here yet: an invitation to add the first one
        chip = hubLink("", me ? `${kind.page}?view=submit` : signedIn ? "account.html" : "join.html", "creation-interest is-empty");
      }
      const words = el("span", "creation-interest-words");
      words.append(
        el("span", "creation-interest-name", group === "All" ? "Everything" : group),
        el("span", "creation-interest-for", info.forYou),
        el("span", "creation-interest-count", n ? plural(n) : "None yet: share the first")
      );
      chip.append(artIcon(info.art, "game-icon creation-interest-icon"), words);
      interests.append(chip);
    }

    search.addEventListener("input", apply);
    apply();
    const recent = recentRow(projects);
    return [
      el("h3", "creations-ask", "What are you looking for?"),
      interests,
      ...(recent ? [recent] : []),
      search,
      shown,
      sectionsWrap,
      none,
    ];
  }

  // The creations this device opened last, as a row of quick buttons
  function recentRow(projects) {
    const recent = recentTools().map((id) => projects.find((p) => p.id === id)).filter((p) => p && toolUrl(p));
    if (!recent.length) return null;
    const row = el("div", "toolbox-recent");
    row.append(el("span", "note", "// Recently opened:"));
    recent.forEach((project) => row.append(openLink(project, toolUrl(project), project.title, "hub-tab")));
    return row;
  }

  let foldersOpen = false; // whether the folders fold is open

  async function folderNodes(projects) {
    let folders;
    try {
      folders = await loadFolders();
    } catch (err) {
      console.error(err);
      return [el("p", "account-status is-error", "> COULD NOT LOAD FOLDERS. Please refresh the page.")];
    }

    // Every folder lives inside one fold, closed until asked for, so the
    // page stays short. It remembers being open while the page is redrawn.
    const nodes = [];
    const shelf = el("details", "resource-group hub-shelf");
    shelf.open = foldersOpen;
    shelf.addEventListener("toggle", () => { foldersOpen = shelf.open; });
    const filed = projects.filter((p) => folders.some((f) => f.name === p.folder)).length;
    shelf.append(el("summary", "resource-summary",
      `// Members' library by topic (${folders.length} folder${folders.length === 1 ? "" : "s"}, ${filed} item${filed === 1 ? "" : "s"})`));
    const shelfBody = el("div", "resource-body");
    shelf.append(shelfBody);

    const accordion = el("section", "resource-accordion hub-folders");
    for (const folder of folders) {
      const items = projects.filter((p) => p.folder === folder.name);
      const group = el("details", "resource-group hub-folder");
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
    shelfBody.append(accordion);
    nodes.push(shelf);

    if (isModerator()) {
      shelfBody.append(button("+ NEW FOLDER", "hub-new-folder", async () => {
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
      .select(memberColumns())
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
    // A creation's preview picture leads its page
    if (!isMaterial) {
      const item = creationItem(project);
      const figure = el("div", "creation-detail-preview");
      if (item.image) {
        const img = el("img", "creation-shot");
        img.src = item.image;
        img.alt = item.alt;
        img.width = 720;
        img.height = 450;
        img.addEventListener("error", () => img.replaceWith(creationArt(item)), { once: true });
        figure.append(img);
      } else {
        figure.append(creationArt(item));
      }
      article.append(figure);
    }
    const head = el("div", "hub-card-head");
    head.append(el("h3", "hub-title", project.title));
    if (project.folder) head.append(el("span", "member-tag hub-cat", project.folder));
    head.append(el("span", "member-tag hub-cat", shownCategory(project)));
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
    // Signed-in members can report someone else's item to the moderators
    if (me && project.author && project.author.id !== me.id) {
      article.append(reportButton("project", project.id, "Report this item"));
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
      if (!isMaterial && upgraded) article.append(moderatorPreviewControl(project, status));
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
      if (author.id && author.id !== me.id) who.append(reportButton("comment", comment.id));
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

  /* ---- preview pictures (creations only, once migration 025 has run) ---- */

  function previewInput() {
    const input = el("input", "join-input");
    input.id = "project-preview";
    input.type = "file";
    input.accept = Object.keys(CREATION_PREVIEW_TYPES).join(",");
    return input;
  }

  // A reason the picture can't be used, or null
  function previewProblem(file) {
    if (!CREATION_PREVIEW_TYPES[file.type]) return "> THE PREVIEW MUST BE A PNG, JPEG OR WEBP PICTURE.";
    if (file.size > CREATION_PREVIEW_MAX_MB * 1024 * 1024) return `> THE PREVIEW PICTURE IS LARGER THAN ${CREATION_PREVIEW_MAX_MB} MB.`;
    return null;
  }

  // Uploads into the person's own folder; returns the new path, or null
  async function uploadPreview(file) {
    const path = `${me.id}/${crypto.randomUUID()}.${CREATION_PREVIEW_TYPES[file.type]}`;
    const { error } = await db.storage
      .from(CREATION_PREVIEWS_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) {
      console.error(error);
      return null;
    }
    return path;
  }

  // Removing an old picture is a courtesy: the database rules decide (a
  // member's own folder, or a moderator) and a failure changes nothing
  function removePreviewFile(path) {
    if (path) db.storage.from(CREATION_PREVIEWS_BUCKET).remove([path]).catch(() => {});
  }

  // Moderators can change the picture of any creation, published or not
  function moderatorPreviewControl(project, statusNode) {
    const wrap = el("div", "mod-actions creation-preview-mod");
    const label = el("label", "note", "// Preview picture:");
    const input = previewInput();
    input.id = "mod-preview";
    label.htmlFor = input.id;
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      const problem = previewProblem(file);
      statusNode.classList.toggle("is-error", !!problem);
      if (problem) {
        statusNode.textContent = problem;
        return;
      }
      statusNode.textContent = "> UPLOADING PICTURE...";
      const path = await uploadPreview(file);
      const { error } = path
        ? await db.rpc("set_project_preview", { target: project.id, new_path: path })
        : { error: { message: "upload failed" } };
      if (error) {
        statusNode.textContent = `> FAILED: ${error.message}`;
        statusNode.classList.add("is-error");
        return;
      }
      removePreviewFile(project.preview_path);
      renderProject(project.id);
    });
    wrap.append(label, input);
    if (project.preview_path) {
      wrap.append(button("REMOVE PICTURE", "mod-decline", async () => {
        const { error } = await db.rpc("set_project_preview", { target: project.id, new_path: null });
        if (error) {
          statusNode.textContent = `> FAILED: ${error.message}`;
          statusNode.classList.add("is-error");
          return;
        }
        removePreviewFile(project.preview_path);
        renderProject(project.id);
      }));
    }
    return wrap;
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
    const category = picker("project-category", categoryChoices());
    // Creations can carry a preview picture once migration 025 has run
    const preview = !isMaterial && upgraded ? previewInput() : null;
    let dropPreview = null;
    if (preview && existing && existing.preview_path) {
      dropPreview = el("input");
      dropPreview.type = "checkbox";
      dropPreview.id = "project-preview-remove";
    }

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
      // an item saved under an old category shows its new group (after 025)
      category.value = categoryChoices().includes(existing.category) ? existing.category
        : categoryChoices().includes(creationGroup(existing)) ? creationGroup(existing) : "";
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
        : `// Optional file, up to ${PROJECT_FILE_MAX_MB} MB: PDF, image, Word, PowerPoint, Excel or text.`)
    );
    if (preview) {
      form.append(
        field("Preview image", preview),
        el("p", "join-hint", existing && existing.preview_path
          ? `// This has a preview picture. Choose a new one only to replace it (PNG, JPEG or WebP, up to ${CREATION_PREVIEW_MAX_MB} MB).`
          : `// Optional picture shown on its card: a screenshot works well, wide rather than tall (16:10). PNG, JPEG or WebP, up to ${CREATION_PREVIEW_MAX_MB} MB. No patient information.`)
      );
      if (dropPreview) {
        const removeRow = el("label", "hub-confirm");
        removeRow.append(dropPreview, " Remove the current preview picture");
        form.append(removeRow);
      }
    }
    form.append(
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
      const picture = preview ? preview.files[0] || null : null;
      if (picture && previewProblem(picture)) return setError(previewProblem(picture));

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

      // the preview picture (the column exists only after migration 025)
      const oldPreview = existing ? existing.preview_path || null : null;
      if (preview) {
        row.preview_path = dropPreview && dropPreview.checked ? null : oldPreview;
        if (picture) {
          status.textContent = "> UPLOADING PREVIEW PICTURE...";
          row.preview_path = await uploadPreview(picture);
          if (!row.preview_path) return setError("> COULD NOT UPLOAD THE PREVIEW PICTURE. Check its type and size, then try again.");
        }
      }

      if (existing) {
        status.textContent = "> SAVING...";
        // author_id and kind can't change; the database only accepts these columns
        const { title: t, category: c, description: d, link_url, file_path, file_name } = row;
        const changes = { title: t, category: c, description: d, link_url, file_path, file_name };
        if (isMaterial) changes.folder = row.folder;
        if (preview) changes.preview_path = row.preview_path;
        const { error: updateError } = await db.from("projects").update(changes).eq("id", existing.id);
        if (updateError) {
          console.error(updateError);
          return setError("> COULD NOT SAVE. Please try again.");
        }
        if (preview && oldPreview && oldPreview !== row.preview_path) removePreviewFile(oldPreview);
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
      .from("projects").select(memberColumns()).eq("id", id).maybeSingle();
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
      // the list view fills and shows this; every other view keeps it hidden
      const shelves = document.getElementById("learning-shelves");
      if (shelves) shelves.hidden = true;

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
      signedIn = !!session;
      if (!isMaterial) upgraded = await creationsUpgraded();

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
      hubLink("> Open Member Creations", HUB_KINDS.project.page, "account-mod-link"),
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
