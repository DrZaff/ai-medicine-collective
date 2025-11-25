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

    navigator.clipboard
      .writeText(email)
      .then(() => {
        // Add a brief glow/flash effect on the icon
        copyEmailBtn.classList.add("copied");
        setTimeout(() => {
          copyEmailBtn.classList.remove("copied");
        }, 700);
      })
      .catch((err) => {
        console.error("Failed to copy email:", err);
      });
  });
}

// === MEMBER PROFILE PAGE: copy email button =========================

const profileCopyBtn = document.getElementById("profile-copy-btn");
const profileEmailSpan = document.getElementById("profile-email");

if (profileCopyBtn && profileEmailSpan && navigator.clipboard) {
  profileCopyBtn.addEventListener("click", () => {
    const email = profileEmailSpan.textContent.trim();

    navigator.clipboard
      .writeText(email)
      .then(() => {
        profileCopyBtn.classList.add("copied");
        const status = document.getElementById("profile-copy-status");
        if (status) status.textContent = "Copied!";
        setTimeout(() => {
          profileCopyBtn.classList.remove("copied");
          if (status) status.textContent = "";
        }, 1000);
      })
      .catch((err) => {
        console.error("Failed to copy profile email:", err);
      });
  });
}

// === PROJECTS PAGE: category -> detail view switch ==================

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

  // When a project type is clicked
  typesContainer.querySelectorAll(".project-type").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const type = link.dataset.type;
      if (!type) return;

      // Update label
      if (typeLabel) {
        typeLabel.textContent = `// ${typeNames[type] || "Projects"}`;
      }

      // Show only cards for that type
      detailCards.forEach((card) => {
        card.style.display = card.dataset.type === type ? "block" : "none";
      });

      // Fade out type grid, fade in detail list
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

  // Back to project type selection
  if (backWrapper) {
    const backLink = backWrapper.querySelector(".project-back-link");
    if (backLink) {
      backLink.addEventListener("click", (e) => {
        e.preventDefault();

        detailsContainer.classList.add("projects-fade-out");
        setTimeout(() => {
          detailsContainer.classList.add("hidden");
          detailsContainer.classList.remove("projects-fade-out");

          typesContainer.classList.remove("hidden");
          typesContainer.classList.add("projects-fade-in");

          backWrapper.classList.add("hidden");

          setTimeout(() => {
            typesContainer.classList.remove("projects-fade-in");
          }, 350);
        }, 220);
      });
    }
  }
})();
