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

// === JOIN PAGE: copy email to clipboard (overlapping squares icon) ===

const copyEmailBtn = document.getElementById("copy-email-btn");
const joinEmailSpan = document.getElementById("join-email");

if (copyEmailBtn && joinEmailSpan && navigator.clipboard) {
  copyEmailBtn.addEventListener("click", () => {
    const email = joinEmailSpan.textContent.trim();

    navigator.clipboard.writeText(email).then(() => {
      // Add a brief glow/flash effect on the icon
      copyEmailBtn.classList.add("copied");
      setTimeout(() => {
        copyEmailBtn.classList.remove("copied");
      }, 700);
    }).catch((err) => {
      console.error("Failed to copy email:", err);
    });
  });
}

// === MEMBERS PAGE: copy member email when clicking a member card ===

const memberCards = document.querySelectorAll(".member-card");

if (memberCards.length && navigator.clipboard) {
  memberCards.forEach((card) => {
    // Make it feel clickable
    card.style.cursor = "pointer";

    card.addEventListener("click", () => {
      const email = card.dataset.email;
      if (!email) return;

      navigator.clipboard.writeText(email).then(() => {
        const nameEl = card.querySelector(".member-name");
        if (!nameEl) return;

        // Preserve original text the first time
        if (!nameEl.dataset.originalText) {
          nameEl.dataset.originalText = nameEl.textContent;
        }

        // Terminal-style feedback
        nameEl.textContent = `Copied: ${email}`;
        card.classList.add("member-copied");

        setTimeout(() => {
          nameEl.textContent = nameEl.dataset.originalText;
          card.classList.remove("member-copied");
        }, 1200);
      }).catch((err) => {
        console.error("Failed to copy member email:", err);
      });
    });
  });
}
