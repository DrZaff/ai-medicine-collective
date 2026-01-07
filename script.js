// -------------------- PASSWORD GATE --------------------
const PASSWORD = "adelante"; // change this
const gate = document.getElementById("gate");
const app = document.getElementById("app");
const form = document.getElementById("password-form");
const input = document.getElementById("password-input");
const error = document.getElementById("error-message");

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const ok = input.value === PASSWORD;
  if (ok) {
    gate.classList.add("hidden");
    app.classList.remove("hidden");
    error.classList.add("hidden");
    input.value = "";
  } else {
    error.classList.remove("hidden");
  }
});

// -------------------- SIDEBAR TOGGLE (MOBILE) --------------------
const sidebar = document.getElementById("sidebar");
const toggleBtn = document.getElementById("sidebar-toggle");

toggleBtn.addEventListener("click", () => {
  sidebar.classList.toggle("show");
});

// -------------------- MODAL READER --------------------
const overlay = document.getElementById("overlay");
const overlayContent = document.getElementById("overlay-content");
const closeOverlayBtn = document.getElementById("close-overlay");

// demo content builder (replace with your real news later)
function openReader({ title, date, source, bodyHtml }) {
  overlayContent.innerHTML = `
    <h2 style="margin-top:0">${title}</h2>
    <p style="opacity:.8;margin-top:6px">${date} • ${source}</p>
    <hr style="border:0;border-top:1px solid rgba(0,255,102,.25);margin:16px 0" />
    ${bodyHtml}
  `;

  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");

  // prevent background scroll / weird focus issues
  document.body.style.overflow = "hidden";
}

function closeReader() {
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "hidden"; // keep page locked
}

// Close button
closeOverlayBtn.addEventListener("click", closeReader);

// Click outside modal closes (THIS is the part you wanted)
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) closeReader();
});

// ESC closes
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeReader();
});

// Hook up buttons
document.querySelectorAll(".open-article").forEach((btn, idx) => {
  btn.addEventListener("click", () => {
    openReader({
      title: idx === 0 ? "DeepMind Announces Med-Gemini" : "FDA Clears AI Diagnostic Tool",
      date: idx === 0 ? "2024.05.20" : "2024.05.15",
      source: "AI Medicine Collective",
      bodyHtml: `
        <p style="line-height:1.6">
          Replace this with your real summary + links. Keep it short, clean, and readable.
        </p>
        <h3>Why it matters</h3>
        <ul>
          <li>Multimodal clinical reasoning is moving quickly.</li>
          <li>Benchmarks are becoming domain-specific.</li>
          <li>We can translate findings into resident-friendly tools.</li>
        </ul>
      `
    });
  });
});
