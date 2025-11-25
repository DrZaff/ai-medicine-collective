// === AI Medicine Collective - soft gate + session memory + UI polish ===

const CLUB_PASSWORD = "collective";

const header = document.getElementById("site-header");
const gate = document.getElementById("gate");
const main = document.getElementById("site-content");
const form = document.getElementById("password-form");
const errorMsg = document.getElementById("error-message");
const input = document.getElementById("password-input");

// ------- Auth / gate -------

function createLogoutButton() {
  if (document.getElementById("logout-btn")) return;

  const btn = document.createElement("button");
  btn.id = "logout-btn";
  btn.className = "logout-btn";
  btn.textContent = "LOGOUT";

  btn.addEventListener("click", () => {
    sessionStorage.removeItem("amc-auth");
    window.location.href = "index.html";
  });

  document.body.appendChild(btn);
}

function showAuthBanner() {
  const banner = document.createElement("div");
  banner.className = "auth-banner";
  banner.textContent = "AUTHENTICATION ACCEPTED";
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 1800);
}

function unlockSite(withAnimation = true) {
  if (gate) gate.classList.add("hidden");
  if (header) header.classList.remove("hidden");
  if (main) {
    main.classList.remove("hidden");
    main.classList.add("fade-in");
  }

  createLogoutButton();
  if (withAnimation) showAuthBanner();
}

// Already authenticated in this tab?
if (sessionStorage.getItem("amc-auth") === "true") {
  unlockSite(false);
}

// Handle password form on index.html
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

// === JOIN PAGE: copy main contact email ===

const copyEmailBtn = document.getElementById("copy-email-btn");
const joinEmailSpan = document.getElementById("join-email");

if (copyEmailBtn && joinEmailSpan && navigator.clipboard) {
  copyEmailBtn.addEventListener("click", () => {
    const email = joinEmailSpan.textContent.trim();

    navigator.clipboard.writeText(email).then(() => {
      copyEmailBtn.classList.add("copied");
      setTimeout(() => copyEmailBtn.classList.remove("copied"), 700);
    });
  });
}

// === MEMBERS PAGE: (legacy) copy by clicking card =======================
// Safe no-op on pages without data-email attributes.

const memberCards = document.querySelectorAll(".member-card");

if (memberCards.length && navigator.clipboard) {
  memberCards.forEach((card) => {
    // Only treat as clickable if it actually has an email attached
    if (!card.dataset.email) return;

    card.style.cursor = "pointer";

    card.addEventListener("click", () => {
      const email = card.dataset.email;
      if (!email) return;

      navigator.clipboard.writeText(email).then(() => {
        const nameEl = card.querySelector(".member-name");
        if (!nameEl) return;

        if (!nameEl.dataset.originalText) {
          nameEl.dataset.originalText = nameEl.textContent;
        }

        nameEl.textContent = `Copied: ${email}`;
        card.classList.add("member-copied");

        setTimeout(() => {
          nameEl.textContent = nameEl.dataset.originalText;
          card.classList.remove("member-copied");
        }, 1200);
      });
    });
  });
}

// === MEMBER PROFILE PAGE: "Copy my email" button =======================

const profileCopyBtn = document.querySelector(".copy-email-btn");
const profileEmailSpan = document.querySelector(".profile-email");

if (profileCopyBtn && profileEmailSpan && navigator.clipboard) {
  profileCopyBtn.addEventListener("click", () => {
    const email = profileEmailSpan.textContent.trim();
    if (!email) return;

    navigator.clipboard.writeText(email).then(() => {
      profileCopyBtn.classList.add("copied");
      const statusEl = document.querySelector(".copy-status");
      if (statusEl) statusEl.textContent = "Copied!";
      setTimeout(() => {
        profileCopyBtn.classList.remove("copied");
        if (statusEl) statusEl.textContent = "";
      }, 1000);
    });
  });
}

// === PROJECTS PAGE: type -> detail switching ===========================

(function () {
  const typesContainer = document.getElementById("project-types");
  const detailsContainer = document.getElementById("project-details");
  if (!typesContainer || !detailsContainer) return; // not on projects page

  const backWrapper = document.getElementById("projects-back-types");
  const typeLabel = document.getElementById("projects-current-type-label");
  const detailCards = detailsContainer.querySelectorAll(".project-detail-card");

  const typeNames = {
    clinical: "Clinical tools",
    education: "Education",
    lifestyle: "Lifestyle",
    productivity: "Productivity",
    misc: "Miscellaneous",
  };

  // Ensure correct initial state on load
  detailsContainer.classList.add("hidden");
  if (backWrapper) backWrapper.classList.add("hidden");
  if (typeLabel) typeLabel.classList.add("hidden");

  // When a project type is clicked
  typesContainer.querySelectorAll(".project-type").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();

      const type = link.dataset.type;
      if (!type) return;

      // Label for the detail section, e.g. "// Clinical tools"
      if (typeLabel) {
        typeLabel.textContent = `// ${typeNames[type] || "Projects"}`;
        typeLabel.classList.remove("hidden");
      }

      // Show only detail cards for that type
      detailCards.forEach((card) => {
        card.style.display = card.dataset.type === type ? "block" : "none";
      });

      // Fade out the grid, then hide it and show the details
      typesContainer.classList.add("projects-fade-out");

      setTimeout(() => {
        typesContainer.classList.add("hidden");
        typesContainer.classList.remove("projects-fade-out");

        detailsContainer.classList.remove("hidden");
        detailsContainer.classList.add("projects-fade-in");

        if (backWrapper) backWrapper.classList.remove("hidden");

        setTimeout(() => {
          detailsContainer.classList.remove("projects-fade-in");
        }, 350);
      }, 220);
    });
  });

  // Back to project types
  if (backWrapper) {
    const backLink = backWrapper.querySelector(".project-back-link");
    if (!backLink) return;

    backLink.addEventListener("click", (e) => {
      e.preventDefault();

      detailsContainer.classList.add("projects-fade-out");

      setTimeout(() => {
        detailsContainer.classList.add("hidden");
        detailsContainer.classList.remove("projects-fade-out");

        typesContainer.classList.remove("hidden");
        typesContainer.classList.add("projects-fade-in");

        backWrapper.classList.add("hidden");
        if (typeLabel) typeLabel.classList.add("hidden");

        setTimeout(() => {
          typesContainer.classList.remove("projects-fade-in");
        }, 350);
      }, 220);
    });
  }
})();
