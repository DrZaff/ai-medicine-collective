// === AI Medicine Collective - soft gate + session memory + UI polish ===

const CLUB_PASSWORD = "collective";

const header = document.getElementById("site-header");
const gate = document.getElementById("gate");
const main = document.getElementById("site-content");
const form = document.getElementById("password-form");
const errorMsg = document.getElementById("error-message");
const input = document.getElementById("password-input");

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

// Handle password form submission (index only)
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

// === Global: style all "< Back" anchors as .back-link ================

document.querySelectorAll("a").forEach((a) => {
  if (a.textContent.trim().startsWith("< Back")) {
    a.classList.add("back-link");
  }
});

// === JOIN PAGE COPY EMAIL ===========================================

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

// === MEMBERS PAGE copy by clicking a card ===========================

const memberCards = document.querySelectorAll(".member-card");

if (memberCards.length && navigator.clipboard) {
  memberCards.forEach((card) => {
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

// === MEMBER PROFILE: copy email button ========================

(function () {
  const btn = document.querySelector(".copy-email-btn");
  const emailSpan = document.querySelector(".profile-email-address");

  if (!btn || !emailSpan || !navigator.clipboard) return;

  btn.addEventListener("click", () => {
    const email = emailSpan.textContent.trim();
    if (!email) return;

    navigator.clipboard
      .writeText(email)
      .then(() => {
        const originalText = btn.textContent;
        btn.textContent = "COPIED!";
        btn.classList.add("copied");

        setTimeout(() => {
          btn.textContent = originalText;
          btn.classList.remove("copied");
        }, 900);
      })
      .catch((err) => {
        console.error("Failed to copy email:", err);
      });
  });
})();

// === PROJECTS PAGE: type grid <-> detail list switching =============

(function () {
  const typesContainer = document.getElementById("project-types");
  const detailsContainer = document.getElementById("project-details");
  if (!typesContainer || !detailsContainer) return; // not on projects page

  const typeLabel = document.getElementById("projects-current-type-label");
  const detailCards = detailsContainer.querySelectorAll(".project-detail-card");

  // This is the bottom "< Back" link on the page
  const backLink = document.querySelector("a.back-link");

  const typeNames = {
    clinical: "Clinical tools",
    education: "Education",
    lifestyle: "Lifestyle",
    productivity: "Productivity",
    misc: "Miscellaneous",
  };

  let showingDetails = false;

  function showDetails(type) {
    if (typeLabel) {
      typeLabel.textContent = `// ${typeNames[type] || "Projects"}`;
      typeLabel.classList.remove("hidden");
    }

    detailCards.forEach((card) => {
      card.style.display = card.dataset.type === type ? "block" : "none";
    });

    typesContainer.classList.add("projects-fade-out");

    setTimeout(() => {
      typesContainer.classList.add("hidden");
      typesContainer.classList.remove("projects-fade-out");

      detailsContainer.classList.remove("hidden");
      detailsContainer.classList.add("projects-fade-in");

      setTimeout(() => {
        detailsContainer.classList.remove("projects-fade-in");
      }, 350);
    }, 220);

    showingDetails = true;
  }

  function showTypes() {
    if (typeLabel) {
      typeLabel.classList.add("hidden");
      typeLabel.textContent = "";
    }

    detailsContainer.classList.add("projects-fade-out");

    setTimeout(() => {
      detailsContainer.classList.add("hidden");
      detailsContainer.classList.remove("projects-fade-out");

      typesContainer.classList.remove("hidden");
      typesContainer.classList.add("projects-fade-in");

      setTimeout(() => {
        typesContainer.classList.remove("projects-fade-in");
      }, 350);
    }, 220);

    showingDetails = false;
  }

  // Clicking a project type => drill down into that category
  typesContainer.querySelectorAll(".project-type").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const type = link.dataset.type;
      if (!type) return;
      showDetails(type);
    });
  });

  // Bottom "< Back" link:
  // - When details are showing -> intercept and go back to types
  // - When on type grid -> behaves like normal link (to index.html)
  if (backLink) {
    backLink.addEventListener("click", (e) => {
      if (!showingDetails) {
        // normal navigation to index.html
        return;
      }
      e.preventDefault();
      showTypes();
    });
  }
})();

// === ADELANTE REPORT PAGE – dropdown stack ====================

(function () {
  const stack = document.getElementById("adelante-report-stack");
  if (!stack) return; // not on ADELANTE page

  const header = stack.querySelector(".report-stack-header");
  const body = stack.querySelector(".report-stack-body");

  if (!header || !body) return;

  header.addEventListener("click", () => {
    const isHidden = body.classList.contains("hidden");
    if (isHidden) {
      body.classList.remove("hidden");
      stack.classList.add("open");
    } else {
      body.classList.add("hidden");
      stack.classList.remove("open");
    }
  });
})();

// === RESOURCES PAGE: flyer lightbox ===
(function () {
  const thumbs = document.querySelectorAll(".resource-thumb img");
  if (!thumbs.length) return; // not on resources page

  // Create overlay once
  const overlay = document.createElement("div");
  overlay.className = "lightbox-overlay hidden";
  overlay.innerHTML = `
    <div class="lightbox-inner">
      <button class="lightbox-close" aria-label="Close image">CLOSE</button>
      <img class="lightbox-img" src="" alt="Club flyer" />
    </div>
  `;
  document.body.appendChild(overlay);

  const imgEl = overlay.querySelector(".lightbox-img");
  const closeBtn = overlay.querySelector(".lightbox-close");

  function openLightbox(fullSrc) {
    imgEl.src = fullSrc;
    overlay.classList.remove("hidden");
  }

  function closeLightbox() {
    overlay.classList.add("hidden");
    imgEl.src = "";
  }

  thumbs.forEach((thumb) => {
    const fullSrc = thumb.dataset.full || thumb.src;
    thumb.addEventListener("click", () => {
      openLightbox(fullSrc);
    });
  });

  // Close when clicking outside the image
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeLightbox();
    }
  });

  closeBtn.addEventListener("click", closeLightbox);

  // Escape key closes lightbox
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) {
      closeLightbox();
    }
  });
})();

// JOIN FORM SUCCESS
const joinForm = document.getElementById("join-form");
const joinSuccess = document.getElementById("join-success");

if (joinForm) {
  joinForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const formData = new FormData(joinForm);

    const response = await fetch(joinForm.action, {
      method: "POST",
      body: formData,
      headers: { Accept: "application/json" },
    });

    if (response.ok) {
      joinForm.reset();
      joinSuccess.classList.remove("hidden");
    }
  });
}





