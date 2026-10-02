// === AI Medicine Collective - soft gate + session memory + UI polish ===

// Change this if you want a different password:
const CLUB_PASSWORD = "collective";

const header = document.getElementById("site-header");
const gate = document.getElementById("gate");
const main = document.getElementById("site-content");
const form = document.getElementById("password-form");
const errorMsg = document.getElementById("error-message");
const input = document.getElementById("password-input");

// Create logout button (top-right), works on all pages once authenticated
function createLogoutButton() {
  if (document.getElementById("logout-btn")) return;

  const btn = document.createElement("button");
  btn.id = "logout-btn";
  btn.className = "logout-btn";
  btn.textContent = "LOGOUT";

  btn.addEventListener("click", () => {
    sessionStorage.removeItem("amc-auth");
    // Reload index page and show the gate again
    window.location.href = "index.html";
  });

  document.body.appendChild(btn);
}

// Minimal auth banner
function showAuthBanner() {
  const banner = document.createElement("div");
  banner.className = "auth-banner";
  banner.textContent = "AUTHENTICATION ACCEPTED";
  document.body.appendChild(banner);

  setTimeout(() => {
    if (banner && banner.parentNode) {
      banner.remove();
    }
  }, 1800);
}

// Unlock the site UI
function unlockSite(withAnimation = true) {
  if (gate) gate.classList.add("hidden");
  if (header) header.classList.remove("hidden");
  if (main) {
    main.classList.remove("hidden");
    main.classList.add("fade-in");
  }

  // Show logout button on any page once authenticated
  createLogoutButton();

  // Only show banner when just authenticated
  if (withAnimation) {
    showAuthBanner();
  }
}

// If already authenticated in this tab, skip the gate
if (sessionStorage.getItem("amc-auth") === "true") {
  unlockSite(false); // no banner/animation on refresh/back
}

// Handle password form submission (index.html only)
if (form) {
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    const value = input.value.trim();

    if (value === CLUB_PASSWORD) {
      sessionStorage.setItem("amc-auth", "true");

      if (errorMsg) errorMsg.classList.add("hidden");
      unlockSite(true);
      input.value = "";

      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      if (errorMsg) errorMsg.classList.remove("hidden");
      input.value = "";
      input.focus();
    }
  });
}

/* ========= PROJECTS PAGE BEHAVIOR (category → detail toggle) ========= */

function initProjectsPage() {
  const typesContainer = document.getElementById("project-types");
  const detailsContainer = document.getElementById("project-details");
  const typeLabel = document.getElementById("projects-current-type-label");
  const typeLinks = document.querySelectorAll(".project-type");
  const backLink = document.querySelector(".back-link");

  if (!typesContainer || !detailsContainer || !typeLabel) return; // not on projects page

  function labelForType(type) {
    switch (type) {
      case "clinical":
        return "// Clinical tools";
      case "education":
        return "// Education";
      case "lifestyle":
        return "// Lifestyle";
      case "productivity":
        return "// Productivity";
      case "misc":
        return "// Miscellaneous";
      default:
        return "// Projects";
    }
  }

  function showTypesGrid() {
    typesContainer.classList.remove("hidden");
    detailsContainer.classList.add("hidden");
    typeLabel.classList.add("hidden");
  }

  function showDetailsForType(type) {
    typesContainer.classList.add("hidden");
    detailsContainer.classList.remove("hidden");

    typeLabel.textContent = labelForType(type);
    typeLabel.classList.remove("hidden");

    const cards = detailsContainer.querySelectorAll(".project-detail-card");
    cards.forEach((card) => {
      if (card.dataset.type === type) {
        card.classList.remove("hidden");
      } else {
        card.classList.add("hidden");
      }
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Default state: grid only
  showTypesGrid();

  // Clicking a type shows its details
  typeLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const type = link.dataset.type;
      if (!type) return;
      showDetailsForType(type);
    });
  });

  // Global "< Back" link: if details are visible, go back to grid
  if (backLink) {
    backLink.addEventListener("click", (e) => {
      if (!typesContainer.classList.contains("hidden")) {
        return; // already in grid mode → let normal link behavior occur
      }
      e.preventDefault();
      showTypesGrid();
    });
  }
}

// Initialize projects behavior once DOM is ready
document.addEventListener("DOMContentLoaded", initProjectsPage);

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
