// === AI Medicine Collective - shared page behavior ===
// (Sign-in, account and moderation code lives in auth.js.)

/* ========= ALL PAGES: two looks, one site ========= */

// The site has two themes. "modern" (clean, light) is what everyone sees
// first; "terminal" is the original green-on-black design, switched on with
// the Dark mode button. The choice is remembered on this device. A one-line
// script in each page's <head> applies it before the page is drawn; this
// code adds the button and the transition. style.css is the terminal look
// and the shared layout; modern.css restyles it when <html> has class "modern".
const THEME_STORAGE_KEY = "amc-theme";

function siteTheme() {
  return document.documentElement.classList.contains("terminal") ? "terminal" : "modern";
}

function setSiteTheme(theme) {
  document.documentElement.className = theme === "terminal" ? "terminal" : "modern";
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // not remembered; the page still switches
  }
  document.querySelectorAll(".theme-toggle").forEach((btn) => {
    btn.textContent = theme === "terminal" ? "[ LIGHT MODE ]" : "Dark mode";
    btn.setAttribute("aria-pressed", String(theme === "terminal"));
  });
}

// A curtain of falling digits covers the page, the theme changes behind it,
// and the curtain fades away.
function matrixCurtain(onCovered) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !document.createElement("canvas").getContext) {
    onCovered();
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.className = "matrix-curtain";
  canvas.setAttribute("aria-hidden", "true");
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);

  const cell = width < 600 ? 14 : 18;
  const tail = 16; // glowing digits behind each column's leading edge
  ctx.font = `bold ${cell}px "Courier New", monospace`;
  ctx.textBaseline = "top";
  // Speeds scale with the window, so the curtain takes about the same time
  // (a little over a second) on a phone and on a tall monitor
  const columns = Array.from({ length: Math.ceil(width / cell) }, () => ({
    y: -Math.random() * height * 0.35,            // staggered start: a ragged curtain edge
    speed: (height * (1 + Math.random() * 0.8)) / 30,
  }));
  const digit = () => String(Math.floor(Math.random() * 10));

  let covered = false;
  let last = 0;
  function frame(now) {
    if (now - last < 28) return requestAnimationFrame(frame); // about 35 frames a second
    last = now;
    let lowest = Infinity;
    columns.forEach((column, i) => {
      const x = i * cell;
      column.y += column.speed;
      lowest = Math.min(lowest, column.y);
      // solid black above the tail, then the digits fading up from the leading edge
      ctx.fillStyle = "#000";
      ctx.fillRect(x, 0, cell, Math.max(0, column.y + cell));
      for (let k = 0; k < tail; k++) {
        const y = column.y - k * cell;
        if (y < -cell || y > height) continue;
        ctx.fillStyle = k === 0 ? "#d7ffe6" : `rgba(0, 255, 102, ${(1 - k / tail).toFixed(2)})`;
        ctx.fillText(digit(), x + 2, y);
      }
    });
    if (lowest - tail * cell > height) {
      // the whole screen is black: change the theme behind it, then lift
      if (!covered) {
        covered = true;
        onCovered();
        canvas.classList.add("is-lifting");
        setTimeout(() => canvas.remove(), 650);
      }
      return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function initThemeToggle() {
  const header = document.querySelector(".terminal-frame header");
  if (!header) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "theme-toggle";
  btn.title = "Switch between the light design and the original terminal design";
  let busy = false;
  btn.addEventListener("click", () => {
    if (busy) return;
    if (siteTheme() === "modern") {
      busy = true;
      matrixCurtain(() => {
        setSiteTheme("terminal");
        busy = false;
      });
    } else {
      // back to light: a short fade is enough
      document.documentElement.classList.add("theme-fading");
      setTimeout(() => {
        setSiteTheme("modern");
        document.documentElement.classList.remove("theme-fading");
      }, 180);
    }
  });
  header.prepend(btn);
  setSiteTheme(siteTheme());
}

document.addEventListener("DOMContentLoaded", initThemeToggle);

// The terminal voice puts "// " before captions, "> " before prompts and
// "< " before back links, and wraps the site name in "::". Those marks are
// part of the text all over the pages and scripts. This wraps each one in a
// <span class="t-only">, which the modern theme hides, so the same text
// reads naturally in both looks. It also catches text added later.
// Text that people wrote themselves (chat, comments, descriptions, blog
// posts) is never touched.
const TERMINAL_MARK = /^(\s*)(\/\/ |> |< )/;
const RAW_TEXT = ".t-only, .chat-body, .hub-description, .hub-comment-body, .request-details, .member-profile-text, " +
  ".blog-headline, .blog-intro, .blog-item-title, .blog-summary, .blog-why, .blog-archive-list a, .inbox-thread, " +
  "textarea, script, style, code, pre, [contenteditable], [contenteditable] *";

function markTerminalText(textNode) {
  const parent = textNode.parentElement;
  if (!parent || parent.closest(RAW_TEXT)) return;
  const match = TERMINAL_MARK.exec(textNode.data);
  if (!match) return;
  const mark = document.createElement("span");
  mark.className = "t-only";
  mark.textContent = match[2];
  textNode.data = textNode.data.slice(match[0].length);
  parent.insertBefore(mark, textNode);
}

function markTerminalTextIn(node) {
  if (node.nodeType === Node.TEXT_NODE) return markTerminalText(node);
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const found = [];
  while (walker.nextNode()) found.push(walker.currentNode);
  found.forEach(markTerminalText);
}

function initTerminalMarks() {
  // ":: AI MEDICINE COLLECTIVE ::" -> the name on its own in the modern look
  document.querySelectorAll(".headline a").forEach((link) => {
    const name = /^::\s*(.*?)\s*::$/.exec(link.textContent.trim());
    if (!name) return;
    const before = document.createElement("span");
    before.className = "t-only";
    before.textContent = ":: ";
    const after = before.cloneNode();
    after.textContent = " ::";
    link.replaceChildren(before, name[1], after);
  });

  markTerminalTextIn(document.body);
  new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === "characterData") markTerminalText(change.target);
      else change.addedNodes.forEach(markTerminalTextIn);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

document.addEventListener("DOMContentLoaded", initTerminalMarks);

/* ========= ALL PAGES: SIGN IN / ACCOUNT link ========= */

// Supabase keeps the signed-in session in localStorage under this key (set in
// auth.js). Pages that don't load the Supabase library just check whether it
// exists, to relabel "SIGN IN" links as "ACCOUNT". This is cosmetic only:
// access to member data is enforced by the database.
const AUTH_STORAGE_KEY = "sb-ahwnarhmuzxgjindreuz-auth-token";

// auth.js also remembers the person's role here after it loads their profile,
// so other pages can show the Members area links without a database call.
// Also cosmetic: someone who edits this value only sees links to pages that
// will still refuse them.
const MEMBER_ROLE_HINT_KEY = "amc-member-role";
const MEMBER_UNREAD_HINT_KEY = "amc-unread"; // unread inbox messages, also from auth.js

function readSignedInRole() {
  try {
    if (!localStorage.getItem(AUTH_STORAGE_KEY)) return null;
    return localStorage.getItem(MEMBER_ROLE_HINT_KEY) || "";
  } catch {
    return null; // localStorage unavailable (private mode, blocked)
  }
}

function initAccountLinks() {
  const role = readSignedInRole();

  document.querySelectorAll("[data-account-link]").forEach((link) => {
    if (!link.dataset.signedOutLabel) link.dataset.signedOutLabel = link.textContent;
    link.textContent = role === null ? link.dataset.signedOutLabel : link.dataset.accountLink;
  });

  // JOIN links are for people who haven't signed in yet
  document.querySelectorAll("[data-signed-out-only]").forEach((link) => {
    link.hidden = role !== null;
  });

  // Status strip, top right of the frame: signed in or not, and as what
  const strip = document.querySelector(".terminal-frame > .horizontal-rule:first-child");
  if (strip) {
    const labels = { member: "MEMBER", moderator: "MODERATOR", admin: "ADMIN", pending: "PENDING" };
    strip.dataset.status = role === null
      ? "[ SIGNED OUT ]"
      : labels[role] ? `[ SIGNED IN · ${labels[role]} ]` : "[ SIGNED IN ]";
    if (role === null) delete strip.dataset.signedIn;
    else strip.dataset.signedIn = "";
  }

  renderMembersBar(role);
}

// A row of links to the members-only pages, under the header on every page.
function renderMembersBar(role) {
  document.querySelectorAll(".members-bar").forEach((bar) => bar.remove());
  if (!["member", "moderator", "admin"].includes(role)) return;

  const header = document.querySelector(".terminal-frame header");
  const accountLink = document.querySelector("[data-account-link]");
  if (!header || !accountLink) return;

  // Pages in member/ link upward with "../"; reuse whatever prefix this page
  // uses. The live site rewrites "account.html" to "/account", so accept both.
  const prefix = accountLink.getAttribute("href").replace(/account(\.html)?$/, "");
  const here = window.location.pathname.split("/").pop().replace(/\.html$/, "");

  let unread = 0;
  try {
    unread = parseInt(localStorage.getItem(MEMBER_UNREAD_HINT_KEY), 10) || 0;
  } catch {
    // no count shown
  }

  // (Projects and Learning are already in the main menu.)
  const items = [
    ["chat", "CHAT"],
    ["requests", "REQUESTS"],
    ["directory", "DIRECTORY"],
    ["inbox", unread > 0 ? `INBOX (${unread})` : "INBOX"],
  ];
  if (role === "moderator" || role === "admin") items.push(["moderate", "MODERATION"]);

  const bar = document.createElement("nav");
  bar.className = "members-bar";
  bar.setAttribute("aria-label", "Members area");

  const label = document.createElement("span");
  label.className = "members-bar-label";
  label.textContent = "// MEMBERS:";
  bar.append(label);

  for (const [page, text] of items) {
    const link = document.createElement("a");
    link.href = `${prefix}${page}.html`;
    link.textContent = text;
    if (page === here) link.setAttribute("aria-current", "page");
    if (page === "inbox" && unread > 0) link.classList.add("members-bar-unread");
    bar.append(link);
  }

  // Sit just above the dashed rule that closes the header
  const rules = header.querySelectorAll(".horizontal-rule");
  const lastRule = rules[rules.length - 1];
  if (lastRule) header.insertBefore(bar, lastRule);
  else header.append(bar);
}

document.addEventListener("DOMContentLoaded", initAccountLinks);
// auth.js fires this after it learns (or clears) the role on the current page
window.addEventListener("amc-role-changed", initAccountLinks);

/* ========= ALL PAGES: mark the current page in the menu ========= */

function initCurrentNav() {
  const path = window.location.pathname;
  let here = path.split("/").pop().replace(/\.html$/, "") || "index";
  if (/\/member\/[^/]*$/.test(path)) here = "members"; // the hand-made profile pages
  if (here === "appstore") here = "tools";
  if (here === "projects") here = "hub";
  if (here === "resources") here = "learn";

  document.querySelectorAll(".nav a").forEach((link) => {
    const href = link.getAttribute("href") || "";
    if (href.split("/").pop().replace(/\.html$/, "") === here) link.setAttribute("aria-current", "page");
  });
}

document.addEventListener("DOMContentLoaded", initCurrentNav);

/* ========= ALL PAGES: collapsible menu on phones ========= */

// Adds a "> MENU" button before each .nav. CSS only collapses the nav
// (and shows the button) at phone widths; desktop is unaffected.
function initMobileNav() {
  document.querySelectorAll(".nav").forEach((nav, i) => {
    if (!nav.id) nav.id = i ? `site-nav-${i}` : "site-nav";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nav-toggle";
    btn.setAttribute("aria-controls", nav.id);
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML =
      '<span>&gt; MENU</span><span class="nav-toggle-icon" aria-hidden="true">[+]</span>';

    const icon = btn.querySelector(".nav-toggle-icon");

    function setOpen(open) {
      nav.classList.toggle("is-open", open);
      btn.setAttribute("aria-expanded", String(open));
      icon.textContent = open ? "[-]" : "[+]";
    }

    btn.addEventListener("click", () => setOpen(!nav.classList.contains("is-open")));

    // Escape closes an open menu
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && nav.classList.contains("is-open")) {
        setOpen(false);
        btn.focus();
      }
    });

    nav.classList.add("nav--collapsible");
    nav.parentNode.insertBefore(btn, nav);
  });
}

document.addEventListener("DOMContentLoaded", initMobileNav);

/* ========= HOME PAGE: live panels ========= */

// The same public address and publishable key as auth.js (public by design).
// The home page doesn't load the Supabase library; it asks for the newest
// published projects, which anyone may read, with a plain request.
const PUBLIC_API_URL = "https://ahwnarhmuzxgjindreuz.supabase.co/rest/v1";
const PUBLIC_API_KEY = "sb_publishable_3C4xXn0j3GiunX-t6cd0HQ_ze_yTErT";

// Fills "Latest briefing" and "New in the hub". If either request fails the
// panel keeps the plain text already in index.html. Text only, never HTML.
function initHome() {
  const briefing = document.getElementById("home-briefing");
  const projects = document.getElementById("home-projects");
  if (!briefing || !projects) return; // not on the home page

  const node = (tag, className, text) => {
    const made = document.createElement(tag);
    if (className) made.className = className;
    if (text !== undefined) made.textContent = text;
    return made;
  };

  (async () => {
    try {
      const response = await fetch("blog/index.json", { cache: "no-cache" });
      const index = response.ok ? await response.json() : [];
      const entry = Array.isArray(index) ? index[0] : null;
      if (!entry || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return;

      const link = node("a", "home-headline", entry.headline);
      link.href = `blog.html?date=${entry.date}`;
      const nodes = [node("p", "home-list-meta", `// ${entry.date}`), link];

      try {
        const post = await (await fetch(`blog/posts/${entry.date}.json`)).json();
        const intro = String(post.intro || "");
        if (intro) nodes.push(node("p", "home-panel-text", intro.length > 170 ? `${intro.slice(0, 170).trimEnd()}…` : intro));
      } catch {
        // headline alone is fine
      }
      briefing.replaceChildren(...nodes);
    } catch {
      // keep the plain text
    }
  })();

  (async () => {
    try {
      const response = await fetch(
        `${PUBLIC_API_URL}/projects?select=id,title,category&kind=eq.project&status=eq.published&order=created_at.desc,title.asc&limit=4`,
        { headers: { apikey: PUBLIC_API_KEY, Prefer: "count=exact" } }
      );
      if (!response.ok) return;
      const rows = await response.json();
      if (!Array.isArray(rows) || !rows.length) return;

      const list = node("ul", "home-list");
      for (const row of rows) {
        const item = node("li");
        const link = node("a", "home-list-title", row.title);
        link.href = `hub.html?project=${encodeURIComponent(row.id)}`;
        item.append(link, node("span", "home-list-meta", row.category));
        list.append(item);
      }
      projects.replaceChildren(list);

      // "0-3/16": the part after the slash is the total
      const total = parseInt((response.headers.get("content-range") || "").split("/")[1], 10);
      const counter = document.getElementById("home-project-count");
      if (counter && total > 0) counter.textContent = String(total);
    } catch {
      // keep the plain text
    }
  })();
}

document.addEventListener("DOMContentLoaded", initHome);

// Elements marked data-reveal rise into view as the page is scrolled
// (light design only: the styling lives in modern.css). Without this
// script, or for people who ask for reduced motion, they are simply visible.
function initReveal() {
  const marked = document.querySelectorAll("[data-reveal]");
  if (!marked.length || !("IntersectionObserver" in window)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.body.classList.add("reveal-ready");
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-in");
      watcher.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -8% 0px" });
  marked.forEach((item) => watcher.observe(item));
}

document.addEventListener("DOMContentLoaded", initReveal);

/* ========= TOOLS PAGE: launcher ========= */

// Icons for the Collective's own apps, by web address. Everything else gets
// a lettered tile. `desktop` adds the apps' "use on computer" layout link.
const TOOL_ICONS = {
  "acid-base-calculator.netlify.app": { icon: "images/applogos/ABG_logo_512.png", desktop: true },
  "heart-score-calculator.netlify.app": { icon: "images/applogos/HS_logo_512.png", desktop: true },
  "qtc-calc.netlify.app": { icon: "images/applogos/QTc_logo_512.png", desktop: true },
  "thyroid-cascader.netlify.app": { icon: "images/applogos/TC_logo_512.png", desktop: true },
  "va-night-algorithm.netlify.app": { icon: "images/applogos/NF_logo_512.png", desktop: true },
};
const TOOL_RECENT_KEY = "amc-recent-tools"; // ids of the last few tools opened, this device only
const TOOL_USED_KEY = "amc-tool-used";      // auth.js ticks "Try a tool" when this is set

// Every published project that has a link is a tool. Anyone may read those
// (migration 007), so this is a plain request like the home page's. If it
// fails, the page keeps the five apps already in tools.html.
function initTools() {
  const app = document.getElementById("tools-app");
  if (!app) return; // not on the tools page

  const node = (tag, className, text) => {
    const made = document.createElement(tag);
    if (className) made.className = className;
    if (text !== undefined) made.textContent = text;
    return made;
  };
  const readRecent = () => {
    try {
      const ids = JSON.parse(localStorage.getItem(TOOL_RECENT_KEY) || "[]");
      return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
    } catch {
      return [];
    }
  };
  const remember = (id) => {
    try {
      localStorage.setItem(TOOL_RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, 4)));
      localStorage.setItem(TOOL_USED_KEY, "1");
    } catch {
      // nothing remembered; the launcher still works
    }
  };

  function toolCard(tool) {
    let url;
    try {
      url = new URL(tool.link_url);
    } catch {
      return null;
    }
    if (url.protocol !== "https:") return null;
    const known = TOOL_ICONS[url.hostname];

    const card = node("div", "tool-card");
    const launch = node("a", "tool-launch");
    launch.href = url.href;
    launch.target = "_blank";
    launch.rel = "noopener noreferrer";
    launch.addEventListener("click", () => remember(tool.id));

    if (known) {
      const img = node("img", "tool-icon");
      img.src = known.icon;
      img.alt = "";
      img.loading = "lazy";
      launch.append(img);
    } else {
      const letters = tool.title.split(/\s+/).filter((word) => /^[A-Za-z0-9]/.test(word))
        .map((word) => word[0]).join("").slice(0, 2).toUpperCase();
      launch.append(node("span", "tool-icon tool-icon--text", letters || "?"));
    }
    launch.append(node("span", "tool-name", tool.title));
    card.append(launch);

    const links = node("div", "tool-links");
    const details = node("a", null, "details");
    details.href = `hub.html?project=${encodeURIComponent(tool.id)}`;
    links.append(details);
    if (url.hostname === "chatgpt.com") links.append(node("span", "tool-kind", "custom GPT"));
    if (known && known.desktop) {
      const desktop = node("a", null, "use on computer");
      const wide = new URL(url.href);
      wide.searchParams.set("desktop", "1");
      desktop.href = wide.href;
      desktop.target = "_blank";
      desktop.rel = "noopener noreferrer";
      desktop.addEventListener("click", () => remember(tool.id));
      links.append(desktop);
    }
    card.append(links);
    card.dataset.category = tool.category;
    card.dataset.search = `${tool.title} ${tool.description} ${tool.category}`.toLowerCase();
    return card;
  }

  (async () => {
    let tools;
    try {
      const response = await fetch(
        `${PUBLIC_API_URL}/projects?select=id,title,category,description,link_url&kind=eq.project&status=eq.published&link_url=not.is.null&order=title.asc`,
        { headers: { apikey: PUBLIC_API_KEY } }
      );
      if (!response.ok) return;
      tools = await response.json();
    } catch {
      return; // keep the built-in list
    }
    if (!Array.isArray(tools) || !tools.length) return;

    const grid = node("div", "tool-grid");
    const cards = [];
    for (const tool of tools) {
      const card = toolCard(tool);
      if (!card) continue;
      cards.push(card);
      grid.append(card);
    }
    if (!cards.length) return;

    const search = node("input", "join-input directory-search");
    search.type = "search";
    search.placeholder = "Search tools";
    search.setAttribute("aria-label", "Search tools by name or description");

    const filter = node("div", "filter-bar");
    filter.setAttribute("role", "group");
    filter.setAttribute("aria-label", "Filter tools by category");
    const shown = node("p", "roster-stats");
    shown.setAttribute("role", "status");
    const none = node("p", "note", "// No tools match that.");

    let category = "All";
    const apply = () => {
      const term = search.value.trim().toLowerCase();
      let visible = 0;
      cards.forEach((card) => {
        card.hidden = (category !== "All" && card.dataset.category !== category)
          || (!!term && !card.dataset.search.includes(term));
        if (!card.hidden) visible++;
      });
      shown.textContent = visible === cards.length ? `> ${cards.length} tools` : `> ${visible} of ${cards.length} tools`;
      none.hidden = visible > 0;
    };

    const categories = [...new Set(cards.map((card) => card.dataset.category))].sort();
    const buttons = ["All", ...categories].map((name) => {
      const btn = node("button", "filter-btn", name.toUpperCase());
      btn.type = "button";
      btn.setAttribute("aria-pressed", String(name === "All"));
      btn.addEventListener("click", () => {
        category = name;
        buttons.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
        apply();
      });
      filter.append(btn);
      return btn;
    });
    search.addEventListener("input", apply);

    // The last few tools opened on this device, for one-tap repeat use
    const nodes = [];
    const recent = readRecent().map((id) => tools.find((tool) => tool.id === id)).filter(Boolean);
    if (recent.length) {
      const row = node("div", "tool-grid tool-grid--recent");
      recent.forEach((tool) => {
        const card = toolCard(tool);
        if (card) row.append(card);
      });
      nodes.push(node("h3", "subsection-title", "// Recently used"), row, node("h3", "subsection-title", "// All tools"));
    }

    apply();
    app.classList.remove("app-store-page");
    app.replaceChildren(...nodes, search, filter, shown, grid, none);
  })();
}

document.addEventListener("DOMContentLoaded", initTools);

/* ========= MEMBERS PAGE: program filter ========= */

// Builds ALL / IM / MED-PEDS / EM buttons from the cards' data-program
// values. Without JavaScript the full roster simply shows.
function initRosterFilter() {
  const bar = document.querySelector(".filter-bar[data-filter-for]");
  if (!bar) return; // not on members page

  const grid = document.getElementById(bar.dataset.filterFor);
  if (!grid) return;

  const cards = [...grid.querySelectorAll("[data-program]")];
  const labels = { all: "ALL", im: "IM", medpeds: "MED/PEDS", em: "EM" };
  const programs = ["all", ...new Set(cards.map((c) => c.dataset.program))];

  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Filter members by program");

  const buttons = programs.map((program) => {
    const count =
      program === "all"
        ? cards.length
        : cards.filter((c) => c.dataset.program === program).length;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-btn";
    btn.dataset.program = program;
    btn.textContent = `${labels[program] || program.toUpperCase()} (${count})`;
    btn.setAttribute("aria-pressed", String(program === "all"));
    bar.appendChild(btn);
    return btn;
  });

  bar.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;

    const program = btn.dataset.program;
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    cards.forEach((card) => {
      card.hidden = program !== "all" && card.dataset.program !== program;
    });
  });

  bar.hidden = false;
}

document.addEventListener("DOMContentLoaded", initRosterFilter);

/* ========= BLOG PAGE: briefings ========= */

// Reads blog/index.json (built on deploy by scripts/blog_agent/build_index.py)
// and renders one post from blog/posts/<date>.json. Post text comes from an
// AI draft, so everything is inserted as text, never as HTML.
function initBlog() {
  const app = document.getElementById("blog-app");
  if (!app) return; // not on blog page

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const safeHref = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
    } catch {
      return null;
    }
  };

  const showStatus = (text) => {
    app.replaceChildren(el("p", "blog-status", text));
  };

  function renderPost(post) {
    const article = el("article", "blog-post");
    article.append(
      el("p", "blog-date", `// ${post.date}`),
      el("h3", "blog-headline", post.headline),
      el("p", "blog-intro", post.intro)
    );

    const list = el("ol", "blog-items");
    for (const item of post.items || []) {
      const li = el("li", "blog-item");
      // Newer posts have two reviews, each labelled by section; older ones
      // carry only a category.
      const SECTION_NAMES = { med_ed: "Med-ed review", ai_vs_human: "AI vs human" };
      const VERDICT_NAMES = {
        ai_ahead: "AI ahead", humans_ahead: "Humans ahead", comparable: "Comparable", mixed: "Mixed results",
      };
      const head = el("div", "blog-item-head");
      const labels = el("div", "blog-item-labels");
      labels.append(el("span", "blog-cat", SECTION_NAMES[item.section] || item.category));
      if (VERDICT_NAMES[item.verdict]) {
        labels.append(el("span", `blog-cat blog-verdict blog-verdict--${item.verdict}`, VERDICT_NAMES[item.verdict]));
      }
      head.append(labels);
      if (item.section === "ai_vs_human") li.classList.add("blog-item--versus");

      const href = safeHref(item.url);
      if (href) {
        const link = el("a", "blog-item-title", item.title);
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        head.append(link);
      } else {
        head.append(el("span", "blog-item-title", item.title));
      }

      // Takeaway first; the fuller summary folds away so the feed can be skimmed
      const why = el("p", "blog-why");
      why.append(el("span", "blog-why-label", "Why it matters"), item.why_it_matters);
      const more = el("details", "blog-more");
      more.append(el("summary", null, "Read the summary"), el("p", "blog-summary", item.summary));

      li.append(head, el("p", "blog-source", `${item.source} · ${item.published}`), why, more);
      list.append(li);
    }
    article.append(list);

    if (post.tags && post.tags.length) {
      const tags = el("div", "blog-tags");
      post.tags.forEach((tag) => tags.append(el("span", "blog-tag", tag)));
      article.append(tags);
    }
    return article;
  }

  function renderArchive(index, currentDate) {
    const section = el("section", "blog-archive");
    section.append(el("h3", "subsection-title", "// Archive"));
    const list = el("ul", "blog-archive-list");
    for (const entry of index.slice(0, 60)) {
      const li = el("li");
      li.append(el("span", "blog-archive-date", entry.date));
      const link = el("a", null, entry.headline);
      link.href = `blog.html?date=${encodeURIComponent(entry.date)}`;
      if (entry.date === currentDate) link.setAttribute("aria-current", "page");
      li.append(link);
      list.append(li);
    }
    section.append(list);
    return section;
  }

  (async () => {
    let index;
    try {
      const response = await fetch("blog/index.json", { cache: "no-cache" });
      index = response.ok ? await response.json() : [];
    } catch {
      index = [];
    }

    if (!Array.isArray(index) || index.length === 0) {
      showStatus("> No briefings yet. The first one is on its way.");
      return;
    }

    const requested = new URLSearchParams(location.search).get("date");
    const entry = index.find((e) => e.date === requested) || index[0];

    try {
      const response = await fetch(`blog/posts/${encodeURIComponent(entry.date)}.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const post = await response.json();
      app.replaceChildren(renderPost(post), renderArchive(index, entry.date));
      document.title = `${post.headline} – AI Medicine Collective`;
    } catch {
      showStatus("> Couldn't load this briefing. Please try again later.");
    }
  })();
}

document.addEventListener("DOMContentLoaded", initBlog);

/* ========= MEMBER PROFILE: copy email button ========= */

// Copy text to the clipboard; falls back to a hidden textarea where the
// Clipboard API is unavailable (e.g. pages opened over plain http).
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }

  return new Promise((resolve, reject) => {
    const temp = document.createElement("textarea");
    temp.value = text;
    temp.setAttribute("readonly", "");
    temp.style.position = "fixed";
    temp.style.opacity = "0";
    document.body.appendChild(temp);
    temp.select();
    const ok = document.execCommand("copy");
    temp.remove();
    ok ? resolve() : reject(new Error("Copy command failed"));
  });
}

function initCopyEmailButton() {
  const btn = document.querySelector(".copy-email-btn");
  const emailSpan = document.querySelector(".profile-email-address");

  if (!btn || !emailSpan) return; // not on a member profile

  const originalText = btn.textContent;

  btn.addEventListener("click", () => {
    const email = emailSpan.textContent.trim();
    if (!email) return;

    copyText(email)
      .then(() => {
        btn.textContent = "COPIED!";
        btn.classList.add("copied");
      })
      .catch(() => {
        btn.textContent = "COPY FAILED";
      })
      .finally(() => {
        setTimeout(() => {
          btn.textContent = originalText;
          btn.classList.remove("copied");
        }, 1200);
      });
  });
}

document.addEventListener("DOMContentLoaded", initCopyEmailButton);

/* ========= LEARNING PAGE: videos ========= */

// Nothing is loaded from YouTube until someone presses "Play here"; then the
// button's card gets the player (YouTube's no-cookie address). Without
// JavaScript the "Open on YouTube" link still works.
function initVideoCards() {
  document.addEventListener("click", (e) => {
    const button = e.target.closest(".video-play");
    if (!button) return;
    const card = button.closest(".video-card");
    const id = card && card.dataset.video;
    if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id) || card.querySelector("iframe")) return;

    const frame = document.createElement("iframe");
    frame.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
    frame.title = (card.querySelector(".video-title") || {}).textContent || "Video";
    frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    const holder = document.createElement("div");
    holder.className = "video-frame";
    holder.append(frame);
    card.append(holder);
    button.remove();
    frame.focus();
  });
}

document.addEventListener("DOMContentLoaded", initVideoCards);

/* ========= ABOUT PAGE: flyer lightbox ========= */

function initFlyerLightbox() {
  const thumbs = document.querySelectorAll(".resource-thumb img");
  if (!thumbs.length) return; // no flyers on this page

  // Create overlay once
  const overlay = document.createElement("div");
  overlay.className = "lightbox-overlay hidden";
  overlay.innerHTML = `
    <div class="lightbox-inner">
      <button type="button" class="lightbox-close" aria-label="Close image">CLOSE</button>
      <img class="lightbox-img" src="" alt="" />
    </div>
  `;
  document.body.appendChild(overlay);

  const imgEl = overlay.querySelector(".lightbox-img");
  const closeBtn = overlay.querySelector(".lightbox-close");
  let lastThumb = null;

  function openLightbox(thumb) {
    lastThumb = thumb;
    imgEl.src = thumb.dataset.full || thumb.src;
    imgEl.alt = thumb.alt;
    overlay.classList.remove("hidden");
    closeBtn.focus();
  }

  function closeLightbox() {
    overlay.classList.add("hidden");
    imgEl.src = "";
    if (lastThumb) lastThumb.focus();
  }

  thumbs.forEach((thumb) => {
    // Make thumbnails reachable and openable from the keyboard
    thumb.tabIndex = 0;
    thumb.setAttribute("role", "button");

    thumb.addEventListener("click", () => openLightbox(thumb));
    thumb.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openLightbox(thumb);
      }
    });
  });

  // Close when clicking outside the image
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeLightbox();
  });

  closeBtn.addEventListener("click", closeLightbox);

  // Escape key closes lightbox
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) {
      closeLightbox();
    }
  });
}

document.addEventListener("DOMContentLoaded", initFlyerLightbox);

/* ========= ABOUT PAGE: guide avatar (idle loop <-> intro) ========= */

function initGuideAvatar() {
  const guide = document.querySelector(".guide");
  const idle = document.getElementById("guide-idle");
  const intro = document.getElementById("guide-intro");
  const playBtn = document.getElementById("guide-play");
  const stopBtn = document.getElementById("guide-stop");
  const ccBtn = document.getElementById("guide-cc");
  const statusText = document.getElementById("guide-status-text");

  if (!guide || !idle || !intro || !playBtn) return; // not on about page

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function setStatus(text) {
    if (statusText) statusText.textContent = "> " + text;
  }

  function startIdle() {
    if (reduceMotion.matches) {
      idle.pause(); // show the still poster frame instead
      return;
    }
    idle.play().catch(() => {}); // autoplay may be blocked; poster still shows
  }

  function showIdle() {
    intro.pause();
    guide.classList.remove("is-playing");
    playBtn.innerHTML = "&#9654; PLAY INTRO";
    stopBtn.classList.add("hidden");
    setStatus("GUIDE ONLINE");
    startIdle();
  }

  function playIntro() {
    guide.classList.add("is-playing");
    idle.pause();
    intro.play().catch(() => showIdle());
    playBtn.innerHTML = "&#10074;&#10074; PAUSE";
    stopBtn.classList.remove("hidden");
    setStatus("TRANSMITTING INTRO");
  }

  function pauseIntro() {
    intro.pause();
    playBtn.innerHTML = "&#9654; RESUME";
    setStatus("INTRO PAUSED");
  }

  playBtn.addEventListener("click", () => {
    if (!guide.classList.contains("is-playing")) {
      intro.currentTime = 0;
      playIntro();
    } else if (intro.paused) {
      playIntro();
    } else {
      pauseIntro();
    }
  });

  stopBtn.addEventListener("click", () => {
    showIdle();
    intro.currentTime = 0;
    playBtn.focus();
  });

  intro.addEventListener("ended", () => {
    showIdle();
    intro.currentTime = 0;
  });

  // Captions on/off
  if (ccBtn && intro.textTracks.length) {
    const track = intro.textTracks[0];
    track.mode = "showing";

    ccBtn.addEventListener("click", () => {
      const on = track.mode !== "showing";
      track.mode = on ? "showing" : "hidden";
      ccBtn.textContent = on ? "CC: ON" : "CC: OFF";
      ccBtn.setAttribute("aria-pressed", String(on));
    });
  } else if (ccBtn) {
    ccBtn.classList.add("hidden");
  }

  reduceMotion.addEventListener("change", () => {
    if (!guide.classList.contains("is-playing")) startIdle();
  });

  startIdle();
}

document.addEventListener("DOMContentLoaded", initGuideAvatar);
