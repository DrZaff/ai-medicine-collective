// PASSWORD GATE
const PASSWORD = "adelante";

const gate = document.getElementById("gate");
const app = document.getElementById("app");
const form = document.getElementById("password-form");
const input = document.getElementById("password-input");
const error = document.getElementById("error-message");

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (input.value === PASSWORD) {
    gate.classList.add("hidden");
    app.classList.remove("hidden");
  } else {
    error.classList.remove("hidden");
  }
});

// SIDEBAR TOGGLE
document.getElementById("sidebar-toggle").onclick = () => {
  document.getElementById("sidebar").classList.toggle("hidden");
};

// MODAL
const overlay = document.getElementById("overlay");
const content = document.getElementById("overlay-content");

document.querySelectorAll(".open-article").forEach(btn => {
  btn.onclick = () => {
    content.innerHTML = `
      <h2>Article</h2>
      <p>This is where the clean, readable article content goes.</p>
      <h3>Why it matters</h3>
      <ul>
        <li>Clinical relevance</li>
        <li>Resident-friendly translation</li>
        <li>Actionable insights</li>
      </ul>
    `;
    overlay.classList.remove("hidden");
  };
});

document.getElementById("close-overlay").onclick = () => {
  overlay.classList.add("hidden");
};

overlay.addEventListener("click", (e) => {
  if (e.target === overlay) {
    overlay.classList.add("hidden");
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    overlay.classList.add("hidden");
  }
});
