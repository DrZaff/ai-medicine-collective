// === AI Medicine Collective - shared page behavior ===
// (Sign-in, account and moderation code lives in auth.js.)

// "2026-10-07" -> "Oct 7, 2026". Anything that isn't a plain date comes back unchanged.
function niceDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return iso;
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US",
    { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}

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

  // On phones the menu is folded away, so every page but the home page gets
  // a Home button beside it (hidden on wider screens, where the menu has one)
  const brand = header.querySelector(".headline a");
  const onHome = /(^|\/)(index(\.html)?)?$/.test(window.location.pathname);
  if (brand && !onHome && !header.querySelector(".home-button")) {
    const home = document.createElement("a");
    home.className = "home-button";
    home.href = brand.getAttribute("href");
    home.setAttribute("aria-label", "Home");
    home.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>' +
      "<span>[ HOME ]</span>";
    header.prepend(home);
  }
  setSiteTheme(siteTheme());
}

document.addEventListener("DOMContentLoaded", initThemeToggle);

// The footer repeats the menu (the header's own links, so the paths are right
// on every page), with the Collective's name and Instagram in the light design
function initFooterNav() {
  const footer = document.querySelector(".terminal-frame .footer");
  const links = [...document.querySelectorAll(".terminal-frame header .nav a")]
    .filter((link) => !link.matches(".nav-cta, .nav-account"));
  if (!footer || !links.length || footer.querySelector(".footer-nav")) return;
  const nav = document.createElement("nav");
  nav.className = "footer-nav";
  nav.setAttribute("aria-label", "Site");
  const brand = document.querySelector(".terminal-frame .headline a");
  if (brand) {
    const name = document.createElement("a");
    name.className = "footer-brand m-only";
    name.href = brand.getAttribute("href");
    name.textContent = "AI Medicine Collective";
    nav.append(name);
  }
  const row = document.createElement("div");
  row.className = "footer-links";
  links.forEach((link) => {
    const href = link.getAttribute("href") || "";
    const group = MENU_GROUPS.find((g) => g.menu === pageOf(href));
    if (group) {
      row.append(...groupLinks(group, href.replace(/[^/]*$/, ""), "as-written"));
      return;
    }
    const copy = document.createElement("a");
    copy.href = href;
    copy.textContent = link.textContent.trim();
    if (link.hasAttribute("data-vision")) copy.setAttribute("data-vision", "");
    row.append(copy);
  });
  const instagram = document.createElement("a");
  instagram.className = "m-only";
  instagram.href = "https://www.instagram.com/aimedicinecollective/";
  instagram.target = "_blank";
  instagram.rel = "noopener noreferrer";
  instagram.textContent = "Instagram";
  row.append(instagram);
  nav.append(row);
  footer.prepend(nav);

  // The independence note and disclaimer sit at the very bottom, inside the footer
  const note = document.querySelector(".terminal-frame .site-note");
  if (note) footer.append(note);
}

document.addEventListener("DOMContentLoaded", initFooterNav);

// "Our vision": a pop-up opened by any link marked data-vision (the home
// page's hero and the menu on every page), or by arriving at #vision
const VISION = {
  title: "Our vision",
  paragraphs: [
    "Medical education has always been shaped from the ground up. Many of the tools a generation of physicians " +
      "learned from, like Anki, Pathoma, Sketchy and Boards and Beyond, started with one learner or a small group, " +
      "not a large company.",
    "That's no accident. Physicians are curious by nature, and when we find a better way to learn or work, we want " +
      "to share it.",
    "What held most good ideas back was never the idea. It was time and money. AI has changed that: a resident with " +
      "a clear idea can now build in a weekend what once took a team and a budget.",
    "What's missing now is organization: a place to bring this work together, share what we build, learn from each " +
      "other, and turn scattered side projects into tools people rely on.",
    "That's why we built the AI Medicine Collective, a home for clinicians who create. Share a tool, borrow an idea, " +
      "find a collaborator, and see what the evidence says about AI in medicine.",
    "If this vision speaks to you, join us. Let's build something remarkable.",
  ],
  signoff: "Built by clinicians, for clinicians.",
};

function initVision() {
  let dialog = null;

  function build() {
    const make = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    // Links to other pages: relative to where this page sits
    const prefix = /\/member\/[^/]*$/.test(window.location.pathname) ? "../" : "";
    dialog = make("dialog", "vision-dialog");
    dialog.setAttribute("aria-labelledby", "vision-title");
    const close = make("button", "vision-close", "\u00d7");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => dialog.close());
    const body = make("div", "vision-body");
    const title = make("h2", "vision-title", VISION.title);
    title.id = "vision-title";
    body.append(make("p", "vision-kicker", "// AI Medicine Collective"), title);
    VISION.paragraphs.forEach((text) => body.append(make("p", "vision-text", text)));
    body.append(make("p", "vision-signoff", VISION.signoff));
    const actions = make("div", "vision-actions");
    const join = make("a", "btn btn--primary", "> Join the Collective");
    join.href = `${prefix}join.html`;
    join.hidden = readSignedInRole() !== null;   // members don't need asking
    const tools = make("a", "btn", "> Browse the tools");
    tools.href = `${prefix}hub.html`;
    actions.append(join, tools);
    body.append(actions);
    dialog.append(close, body);
    // a click on the backdrop (outside the box) closes it
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      if (window.location.hash === "#vision") history.replaceState(null, "", window.location.pathname + window.location.search);
    });
    document.body.append(dialog);   // initTerminalMarks' observer handles its "// " and "> "
  }

  function open(event) {
    if (event) event.preventDefault();
    if (!dialog) build();
    if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-vision]");
    if (!link) return;
    // On another page the menu link goes to the home page's #vision; open it here instead
    open(event);
  });
  if (window.location.hash === "#vision") open();
}

document.addEventListener("DOMContentLoaded", initVision);

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
  ".review-title, .review-summary, .review-text, .review-list, .review-study-title, " +
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
  // ...and a few things only make sense once someone has
  document.querySelectorAll("[data-signed-in-only]").forEach((item) => {
    item.hidden = role === null;
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

  // The member's own shortcuts. (Requests, the member list and meetings are
  // under Community in the main menu.)
  const items = [
    ["chat", "CHAT"],
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

// The menu has five destinations. Two of them are groups of pages:
// "Evidence" and "Community". A page inside a group shows a row of tabs for
// the group's pages (drawn here, so the pages themselves need no markup),
// and the group's menu item is marked as the current one.
const MENU_GROUPS = [
  {
    menu: "blog",
    label: "Evidence",
    tabs: [["blog", "BRIEFINGS", "Briefings"], ["ai-vs-physician", "AI VS PHYSICIAN", "AI vs Physician"]],
    also: [],
  },
  {
    menu: "members",
    label: "Community",
    tabs: [["members", "MEMBERS", "Members"], ["schedule", "MEETINGS", "Meetings"], ["chat", "CHAT", "Chat"],
      ["requests", "REQUESTS", "Requests"]],
    also: ["directory", "profile", "inbox"],   // pages that belong here without a tab of their own
  },
];

// A group's pages as links, named as written ("AI vs Physician"); prefix is
// "../" on the pages in member/
// (Pages in MEMBERS_ONLY_PAGES are marked "(members only)".)
const MEMBERS_ONLY_PAGES = new Set(["schedule", "chat", "requests"]);

function groupLinks(group, prefix, className) {
  return group.tabs.map(([page, , name]) => {
    const link = document.createElement("a");
    link.className = className;
    link.href = `${prefix}${page}.html`;
    link.textContent = name;
    if (MEMBERS_ONLY_PAGES.has(page)) {
      const tag = document.createElement("span");
      tag.className = "nav-members-tag";
      tag.textContent = "(members only)";
      link.append(" ", tag);
    }
    return link;
  });
}

const pageOf = (href) => (href || "").split("/").pop().replace(/\.html$/, "");

function initCurrentNav() {
  const path = window.location.pathname;
  let here = path.split("/").pop().replace(/\.html$/, "") || "index";
  const inMemberFolder = /\/member\/[^/]*$/.test(path);
  if (inMemberFolder) here = "members"; // the hand-made profile pages
  if (here === "appstore" || here === "projects" || here === "tools") here = "hub";
  if (here === "resources") here = "learn";
  if (here === "ai-vs-human") here = "ai-vs-physician";

  const group = MENU_GROUPS.find((g) => g.tabs.some(([page]) => page === here) || g.also.includes(here));
  const menuPage = group ? group.menu : here;

  // Evidence and Community open a drop-down of their pages (on phones the
  // folded menu lists those pages instead of the group's name)
  document.querySelectorAll(".terminal-frame header .nav > a").forEach((link) => {
    const owner = MENU_GROUPS.find((g) => g.menu === pageOf(link.getAttribute("href")));
    if (!owner) return;
    const wrap = document.createElement("span");
    wrap.className = "nav-group";
    const drop = document.createElement("span");
    drop.className = "nav-drop";
    const prefix = (link.getAttribute("href") || "").replace(/[^/]*$/, "");
    groupLinks(owner, prefix, "nav-sub").forEach((sub) => {
      if (pageOf(sub.getAttribute("href")) === here) sub.setAttribute("aria-current", "page");
      drop.append(sub);
    });
    link.classList.add("nav-group-link");
    link.replaceWith(wrap);
    wrap.append(link, drop);
  });

  document.querySelectorAll(".nav > a, .nav-group > a").forEach((link) => {
    if (pageOf(link.getAttribute("href")) === menuPage) link.setAttribute("aria-current", "page");
  });

  // The group's tabs, at the top of the page
  const main = document.querySelector(".terminal-frame main");
  if (!group || !main || main.querySelector(".section-tabs")) return;
  const prefix = inMemberFolder ? "../" : "";
  const tabs = document.createElement("nav");
  tabs.className = "section-tabs";
  tabs.setAttribute("aria-label", group.label);
  for (const [page, text] of group.tabs) {
    const link = document.createElement("a");
    link.className = "hub-tab";
    link.href = `${prefix}${page}.html`;
    link.textContent = text;
    if (page === here) link.setAttribute("aria-current", "page");
    tabs.append(link);
  }
  main.prepend(tabs);
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

// Fills "Latest briefing" and "Newest tools". If either request fails the
// panel keeps the plain text already in index.html. Text only, never HTML.
function initHome() {
  const briefing = document.getElementById("home-briefing");
  if (!briefing) return; // not on the home page

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
      const nodes = [node("p", "home-list-meta", `// ${niceDate(entry.date)}`), link];

      try {
        const post = await (await fetch(`blog/posts/${entry.date}.json`)).json();
        const intro = String(post.intro || "");
        if (intro) nodes.push(node("p", "home-panel-text", intro.length > 170 ? `${intro.slice(0, 170).trimEnd()}…` : intro));
      } catch {
        // headline alone is fine
      }
      // ...and the three before it
      const earlier = index.slice(1, 4).filter((older) => /^\d{4}-\d{2}-\d{2}$/.test(older.date));
      if (earlier.length) {
        const list = node("ul", "home-list home-earlier");
        for (const older of earlier) {
          const item = node("li");
          const title = node("a", "home-list-title", older.headline);
          title.href = `blog.html?date=${older.date}`;
          item.append(title, node("span", "home-list-meta", niceDate(older.date)));
          list.append(item);
        }
        nodes.push(node("p", "home-earlier-label", "// Earlier"), list);
      }
      briefing.replaceChildren(...nodes);
    } catch {
      // keep the plain text
    }
  })();

  (async () => {
    try {
      const response = await fetch(
        `${PUBLIC_API_URL}/projects?select=id&kind=eq.project&status=eq.published&limit=1`,
        { headers: { apikey: PUBLIC_API_KEY, Prefer: "count=exact" } }
      );
      if (!response.ok) return;

      // "0-0/16": the part after the slash is the number of tools
      const total = parseInt((response.headers.get("content-range") || "").split("/")[1], 10);
      const counter = document.getElementById("home-project-count");
      if (counter && total > 0) counter.textContent = String(total);
      // The Tools panel shows five icons and "+N" for the rest
      const more = document.getElementById("home-more-tools");
      if (more && total > 5) more.textContent = `+${total - 5}`;
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

// The home hero's backdrop: points drifting slowly, joined by faint lines
// when they come close, and drawn towards the pointer. The colour comes from
// the canvas's CSS colour, so each theme sets its own. It only runs while
// the hero is on screen, and holds still for people who ask for less motion.
function initHeroNet() {
  const canvas = document.querySelector(".hero-net");
  if (!canvas || !canvas.getContext) return;
  const hero = canvas.parentElement;
  const context = canvas.getContext("2d");
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let width = 0;
  let height = 0;
  let points = [];
  let pointer = null;
  let running = false;
  let frame = 0;
  let colour = "110 231 183";

  function readColour() {
    const match = /(\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(canvas).color);
    if (match) colour = `${match[1]} ${match[2]} ${match[3]}`;
  }

  function size() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = hero.clientWidth;
    height = hero.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = Math.round(Math.min(90, Math.max(28, (width * height) / 11000)));
    points = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      dx: (Math.random() - 0.5) * 0.28,
      dy: (Math.random() - 0.5) * 0.28,
      r: 1 + Math.random() * 1.6,
    }));
  }

  function draw() {
    if (frame++ % 60 === 0) readColour();
    context.clearRect(0, 0, width, height);
    const reach = 130;
    for (const point of points) {
      if (!still) {
        point.x += point.dx;
        point.y += point.dy;
        if (point.x < 0 || point.x > width) point.dx *= -1;
        if (point.y < 0 || point.y > height) point.dy *= -1;
        if (pointer) {
          const px = pointer.x - point.x;
          const py = pointer.y - point.y;
          const far = Math.hypot(px, py);
          if (far < 160 && far > 1) {
            point.x += (px / far) * 0.25;
            point.y += (py / far) * 0.25;
          }
        }
      }
    }
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      for (let j = i + 1; j < points.length; j++) {
        const b = points[j];
        const far = Math.hypot(a.x - b.x, a.y - b.y);
        if (far > reach) continue;
        context.strokeStyle = `rgb(${colour} / ${(1 - far / reach) * 0.35})`;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      }
      if (pointer) {
        const far = Math.hypot(a.x - pointer.x, a.y - pointer.y);
        if (far < 160) {
          context.strokeStyle = `rgb(${colour} / ${(1 - far / 160) * 0.5})`;
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(pointer.x, pointer.y);
          context.stroke();
        }
      }
      context.fillStyle = `rgb(${colour} / 0.75)`;
      context.beginPath();
      context.arc(a.x, a.y, a.r, 0, Math.PI * 2);
      context.fill();
    }
    if (running && !still) requestAnimationFrame(draw);
  }

  function start() {
    if (running) return;
    running = true;
    requestAnimationFrame(draw);
  }

  size();
  readColour();
  draw();
  window.addEventListener("resize", () => {
    size();
    if (still) draw();
  });
  hero.addEventListener("pointermove", (event) => {
    const box = hero.getBoundingClientRect();
    pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
  });
  hero.addEventListener("pointerleave", () => {
    pointer = null;
  });
  // the theme button changes the colour: redraw at once when it does
  new MutationObserver(() => {
    readColour();
    if (still) draw();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  if (still) return;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      if (visible) start();
      else running = false;
    }).observe(hero);
  } else {
    start();
  }
}

document.addEventListener("DOMContentLoaded", initHeroNet);

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

// (The Tools page itself is drawn by hub.js, which uses the three constants above.)

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

  const VERDICT_NAMES = {
    ai_ahead: "AI outperformed physicians", humans_ahead: "Physicians outperformed AI", comparable: "Comparable",
    mixed: "Mixed results",
    ai_help_improved: "AI helped improve", ai_help_no_benefit: "AI help: no difference", ai_help_harmed: "AI help made it worse",
  };

  function renderPost(post) {
    const article = el("article", "blog-post");
    article.append(
      el("p", "blog-date", `// ${niceDate(post.date)}`),
      el("h3", "blog-headline", post.headline),
      el("p", "blog-intro", post.intro)
    );

    const list = el("ol", "blog-items");
    for (const item of post.items || []) {
      const li = el("li", "blog-item");
      // Newer posts have two reviews, each labelled by section; older ones
      // carry only a category.
      const SECTION_NAMES = { med_ed: "Med-ed review", ai_vs_human: "AI vs physician" };
      const head = el("div", "blog-item-head");
      const labels = el("div", "blog-item-labels");
      labels.append(el("span", "blog-cat", SECTION_NAMES[item.section] || item.category));
      if (VERDICT_NAMES[item.verdict]) {
        labels.append(el("span", `blog-cat blog-verdict blog-verdict--${item.verdict}`, VERDICT_NAMES[item.verdict]));
      }
      // What was compared, so the verdict can't be misread
      const compared = /^ai_help_/.test(item.verdict) ? "Physicians with vs without AI"
        : ["ai_ahead", "humans_ahead", "comparable"].includes(item.verdict) ? "AI alone vs physicians" : "";
      if (compared) labels.append(el("span", "blog-compare", compared));
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

      li.append(head, el("p", "blog-source", `${item.source} · ${niceDate(item.published)}`), why, more);
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

  // The archive is a grid of small covers (drawn in CSS, in the style of the
  // Instagram covers), grouped by month, each with its head-to-head verdict
  function renderArchive(index, currentDate) {
    const section = el("section", "blog-archive");
    section.append(el("h3", "subsection-title", "// Archive"));
    let month = "";
    let list = null;
    for (const entry of index.slice(0, 60)) {
      const name = new Date(`${entry.date}T12:00:00Z`).toLocaleDateString("en-US",
        { timeZone: "UTC", year: "numeric", month: "long" });
      if (name !== month) {
        month = name;
        list = el("ul", "blog-archive-list");
        section.append(el("p", "blog-archive-month", `// ${month}`), list);
      }
      const li = el("li");
      const link = el("a", "archive-card");
      link.href = `blog.html?date=${encodeURIComponent(entry.date)}`;
      if (entry.date === currentDate) link.setAttribute("aria-current", "page");
      const cover = el("span", "archive-cover");
      cover.append(el("span", "archive-kicker", niceDate(entry.date)), el("span", "archive-headline", entry.headline));
      link.append(cover);
      const verdicts = (entry.verdicts || []).filter((verdict) => VERDICT_NAMES[verdict]);
      if (verdicts.length) {
        const labels = el("span", "archive-labels");
        verdicts.forEach((verdict) => labels.append(el("span", `blog-cat blog-verdict blog-verdict--${verdict}`, VERDICT_NAMES[verdict])));
        link.append(labels);
      }
      li.append(link);
      list.append(li);
    }
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

/* ========= AI VS PHYSICIAN: the living review ========= */

// Draws evidence/ai-vs-human.json: a paper rewritten each month by the
// "Living review" job from a register of studies, and approved by a person
// before it is published. Everything is written with textContent, because the
// text comes from an AI draft. Also fills the teaser on the Learning page.
function initLivingReview() {
  const app = document.getElementById("review-app");
  const feature = document.getElementById("home-review");   // the home page's featured card
  if (!app && !feature) return;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  };
  const VERDICTS = {
    ai_ahead: "AI outperformed physicians", humans_ahead: "Physicians outperformed AI", comparable: "Comparable",
    ai_help_improved: "AI helped improve", ai_help_no_benefit: "AI help: no difference",
    ai_help_harmed: "AI help made it worse", mixed: "Mixed results",
  };
  const DOMAINS = {
    diagnosis: "Diagnosis", imaging: "Imaging", management: "Management", documentation: "Documentation",
    communication: "Communication", education: "Education", procedures: "Procedures",
  };
  const longDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US",
    { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });

  // One dot per study, in two rows (one per kind of comparison), coloured by
  // which way the result went; each dot links to the study in the paper.
  // Under each row, the verdicts in words with their counts.
  const DIRECTION = {
    ai_help_improved: "up", ai_ahead: "up", ai_help_no_benefit: "even", comparable: "even",
    ai_help_harmed: "down", humans_ahead: "down", mixed: "mixed",
  };
  function verdictChart(studies) {
    const ROWS = [
      ["Physicians with vs without AI", ["ai_help_improved", "ai_help_no_benefit", "ai_help_harmed", "mixed"]],
      ["AI alone vs physicians", ["ai_ahead", "comparable", "humans_ahead", "mixed"]],
    ];
    const alone = (study) => ["ai_ahead", "humans_ahead", "comparable"].includes(study.verdict) ||
      (study.verdict === "mixed" && study.comparison === "ai_alone");
    const figure = el("figure", "verdict-chart");
    let n = 0;
    ROWS.forEach(([heading, order], row) => {
      const mine = studies.filter((study) => VERDICTS[study.verdict] && alone(study) === (row === 1));
      if (!mine.length) return;
      const block = el("div", "verdict-row");
      const dots = el("div", "verdict-dots");
      const legend = el("p", "verdict-legend");
      order.forEach((verdict) => {
        const these = mine.filter((study) => study.verdict === verdict);
        these.forEach((study) => {
          const dot = el("a", `verdict-dot verdict-dot--${DIRECTION[verdict]}`);
          dot.href = `ai-vs-physician.html#study-${encodeURIComponent(study.id)}`;
          dot.title = `${study.title} (${VERDICTS[verdict]})`;
          dot.setAttribute("aria-label", dot.title);
          dot.style.setProperty("--i", String(n++));
          dots.append(dot);
        });
        if (these.length) {
          const key = el("span", "verdict-key");
          key.append(el("i", `verdict-dot verdict-dot--${DIRECTION[verdict]}`), `${VERDICTS[verdict]} `, el("b", null, String(these.length)));
          legend.append(key);
        }
      });
      block.append(el("p", "verdict-row-label", heading), dots, legend);
      figure.append(block);
    });
    return figure;
  }

  fetch("evidence/ai-vs-human.json", { cache: "no-cache" })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null)
    .then((review) => {
      const ready = review && Array.isArray(review.studies) && Array.isArray(review.sections) && review.sections.length;
      if (feature && ready) {
        const plain = (text) => String(text).replace(/\s*\[S\d+\]/g, "");
        const meta = el("p", "home-list-meta",
          `// Edition ${review.edition} · ${review.studies.length} studies · updated ${longDate(review.updated)}`);
        const title = el("a", "home-headline", "How AI is changing what physicians can do");
        title.href = "ai-vs-physician.html";
        const summary = el("p", "home-panel-text", plain(review.summary).split(/(?<=\.)\s+/).slice(0, 2).join(" "));
        const findings = el("ul", "home-findings");
        (review.key_findings || []).slice(0, 1).forEach((finding) => findings.append(el("li", null, plain(finding))));
        feature.replaceChildren(meta, title, summary, verdictChart(review.studies), findings);
      }
      if (!app) return;
      if (!ready) {
        const empty = el("div", "empty-state");
        empty.append(
          el("p", "empty-state-title", "> THE FIRST EDITION IS BEING PREPARED"),
          el("p", "empty-state-text", "This page will hold a paper that weighs the published evidence on AI and physician performance, with every claim tied to its source. It is drafted by an AI agent, checked by the Collective, and rewritten every month.")
        );
        app.replaceChildren(empty);
        return;
      }

      // Studies are numbered in the order they are listed: newest first
      const studies = [...review.studies].sort((a, b) => String(b.published).localeCompare(String(a.published)));
      const number = new Map(studies.map((study, i) => [study.id, i + 1]));

      // "... performance [S4][S9]." -> text with numbered links to the study list
      const cited = (tag, className, text) => {
        const node = el(tag, className);
        String(text).split(/(\[S\d+\])/).forEach((part) => {
          const id = /^\[(S\d+)\]$/.exec(part);
          if (!id) return node.append(part);
          if (!number.has(id[1])) return;
          const link = el("a", "review-cite", `[${number.get(id[1])}]`);
          link.href = `#study-${id[1]}`;
          node.append(link);
        });
        return node;
      };

      const article = el("article", "review");
      article.append(
        el("p", "review-meta", `// Edition ${review.edition} · Updated ${longDate(review.updated)} · ${studies.length} studies`),
        el("h3", "review-title", review.title),
        cited("p", "review-summary", review.summary)
      );

      // How the studies came out: one dot per study, a row per kind of study
      const count = (...verdicts) => studies.filter((study) => verdicts.includes(study.verdict)).length;
      const tallies = verdictChart(studies);
      const mixed = count("mixed");
      article.append(tallies, el("p", "note", `// ${mixed ? `Mixed results: ${mixed} ${mixed === 1 ? "study" : "studies"}. ` : ""}` +
        "A count of studies, not a score: they differ in size, design and how close they are to real practice."));

      if (review.key_findings && review.key_findings.length) {
        const box = el("section", "review-findings");
        box.append(el("h4", "review-heading", "Key findings"));
        const list = el("ol", "review-list");
        review.key_findings.forEach((finding) => list.append(cited("li", null, finding)));
        box.append(list);
        article.append(box);
      }

      review.sections.forEach((section) => {
        const block = el("section", "review-section");
        block.append(el("h4", "review-heading", section.heading));
        (section.paragraphs || []).forEach((paragraph) => block.append(cited("p", "review-text", paragraph)));
        article.append(block);
      });

      if (review.open_questions && review.open_questions.length) {
        const block = el("section", "review-section");
        block.append(el("h4", "review-heading", "What the evidence cannot tell us yet"));
        const list = el("ul", "review-list");
        review.open_questions.forEach((question) => list.append(cited("li", null, question)));
        block.append(list);
        article.append(block);
      }

      // The register: every study the paper draws on
      const register = el("section", "review-section");
      register.append(el("h4", "review-heading", `The studies (${studies.length})`));
      const list = el("ol", "review-studies");
      studies.forEach((study) => {
        const item = el("li", "review-study");
        item.id = `study-${study.id}`;
        let safe = null;
        try {
          const url = new URL(study.url);
          if (url.protocol === "https:" || url.protocol === "http:") safe = url.href;
        } catch {
          // no link
        }
        const title = el(safe ? "a" : "span", "review-study-title", study.title);
        if (safe) {
          title.href = safe;
          title.target = "_blank";
          title.rel = "noopener noreferrer";
        }
        const labels = el("div", "review-study-labels");
        if (VERDICTS[study.verdict]) labels.append(el("span", `blog-cat review-verdict review-verdict--${study.verdict}`, VERDICTS[study.verdict]));
        const COMPARED = { ai_alone: "AI alone vs physicians", clinician_with_ai: "Physicians with vs without AI", both: "Both comparisons" };
        if (COMPARED[study.comparison]) labels.append(el("span", "blog-compare", COMPARED[study.comparison]));
        if (DOMAINS[study.domain]) labels.append(el("span", "blog-cat", DOMAINS[study.domain]));
        item.append(title, el("p", "blog-source", [study.source, niceDate(study.published), study.design].filter(Boolean).join(" · ")), labels);
        const who = [study.ai_system && `AI: ${study.ai_system}`, study.humans && `Humans: ${study.humans}`].filter(Boolean).join(" · ");
        if (who) item.append(el("p", "review-study-who", who));
        item.append(el("p", "review-text", study.finding));
        if (study.limitation) {
          const limit = el("p", "review-study-limit");
          limit.append(el("span", "blog-why-label", "The catch"), study.limitation);
          item.append(limit);
        }
        list.append(item);
      });
      register.append(list);
      article.append(register);

      if (review.changes && review.changes.length) {
        const block = el("section", "review-section");
        block.append(el("h4", "review-heading", "What changed"));
        const log = el("ul", "review-list review-log");
        review.changes.slice(0, 12).forEach((change) => {
          const added = (change.added || []).length;
          log.append(el("li", null, `Edition ${change.edition}, ${longDate(change.date)}: ${change.text}` +
            (added ? ` (${added} ${added === 1 ? "study" : "studies"} added)` : "")));
        });
        block.append(log);
        article.append(block);
      }

      article.append(el("p", "note", "// Drafted by an AI agent from the studies listed above and reviewed by the Collective before publishing. It is a summary of research, not clinical guidance: read the original paper before relying on any result."));
      app.replaceChildren(article);
    });
}

document.addEventListener("DOMContentLoaded", initLivingReview);

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
