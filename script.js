// === AI Medicine Collective - shared page behavior ===
// (Sign-in, account and moderation code lives in auth.js.)

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

  renderMembersBar(role);
}

// A row of links to the members-only pages, under the header on every page.
function renderMembersBar(role) {
  document.querySelectorAll(".members-bar").forEach((bar) => bar.remove());
  if (!["member", "moderator", "admin"].includes(role)) return;

  const header = document.querySelector(".terminal-frame header");
  const accountLink = document.querySelector("[data-account-link]");
  if (!header || !accountLink) return;

  // Pages in member/ link upward with "../"; reuse whatever prefix this page uses
  const prefix = accountLink.getAttribute("href").replace(/account\.html$/, "");
  const here = window.location.pathname.split("/").pop().replace(/\.html$/, "");

  let unread = 0;
  try {
    unread = parseInt(localStorage.getItem(MEMBER_UNREAD_HINT_KEY), 10) || 0;
  } catch {
    // no count shown
  }

  // (The Projects hub is public and already in the main menu as PROJECTS.)
  const items = [
    ["learn", "LEARNING"],
    ["chat", "CHAT"],
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
      const head = el("div", "blog-item-head");
      head.append(el("span", "blog-cat", item.category));

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

      li.append(
        head,
        el("p", "blog-source", `${item.source} · ${item.published}`),
        el("p", "blog-summary", item.summary),
        el("p", "blog-why", `> Why it matters: ${item.why_it_matters}`)
      );
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

/* ========= RESOURCES PAGE: flyer lightbox ========= */

function initFlyerLightbox() {
  const thumbs = document.querySelectorAll(".resource-thumb img");
  if (!thumbs.length) return; // not on resources page

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
