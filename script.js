// HEART Score – ClinicalToolsDEV style
// Logic is kept in pure functions for reuse across apps.

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("tool-form");
  const resultsContainer = document.getElementById("results-container");
  const flagsContainer = document.getElementById("flags-container");

  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const inputs = readInputs();
    const validationErrors = validateInputs(inputs);

    if (validationErrors.length > 0) {
      renderValidationErrors(resultsContainer, validationErrors);
      flagsContainer.innerHTML = "";
      return;
    }

    const calcResults = performCalculations(inputs);
    const interpretation = interpretResults(calcResults);
    const flags = deriveFlags(calcResults, interpretation);

    renderResults(resultsContainer, calcResults, interpretation);
    renderFlags(flagsContainer, flags);
  });
});

// ---- Input Handling ----

function readInputs() {
  const historyScore = parseInt(
    document.getElementById("historyScore").value,
    10
  );
  const ecgScore = parseInt(document.getElementById("ecgScore").value, 10);
  const tropScore = parseInt(document.getElementById("tropScore").value, 10);
  const ageYears = parseFloat(document.getElementById("ageYears").value);

  const riskFactorCheckboxes = document.querySelectorAll(
    ".risk-factor"
  );
  const riskFactors = [];
  riskFactorCheckboxes.forEach((cb) => {
    if (cb.checked) riskFactors.push(cb.value);
  });

  return {
    historyScore,
    ecgScore,
    tropScore,
    ageYears,
    riskFactors,
  };
}

function validateInputs(inputs) {
  const errors = [];

  if (Number.isNaN(inputs.historyScore)) {
    errors.push("History category is required.");
  }
  if (Number.isNaN(inputs.ecgScore)) {
    errors.push("ECG category is required.");
  }
  if (Number.isNaN(inputs.tropScore)) {
    errors.push("Troponin category is required.");
  }
  if (Number.isNaN(inputs.ageYears)) {
    errors.push("Age is required and must be a number.");
  } else if (inputs.ageYears < 0 || inputs.ageYears > 120) {
    errors.push("Age appears outside typical human range (0–120).");
  }

  return errors;
}

// ---- Core Calculations ----

function performCalculations(inputs) {
  const agePoints = calculateHeartAgePoints(inputs.ageYears);
  const riskFactorPoints = calculateHeartRiskFactorPoints(
    inputs.riskFactors
  );

  const totalScore =
    inputs.historyScore +
    inputs.ecgScore +
    agePoints +
    riskFactorPoints +
    inputs.tropScore;

  const riskCategory = classifyHeartRiskCategory(totalScore);

  return {
    ageYears: inputs.ageYears,
    historyScore: inputs.historyScore,
    ecgScore: inputs.ecgScore,
    tropScore: inputs.tropScore,
    riskFactors: inputs.riskFactors,
    agePoints,
    riskFactorPoints,
    totalScore,
    riskCategory,
  };
}

// Pure helper functions – portable to RN/Swift/Flutter

function calculateHeartAgePoints(ageYears) {
  if (ageYears < 45) return 0;
  if (ageYears < 65) return 1;
  return 2;
}

function calculateHeartRiskFactorPoints(riskFactors) {
  if (!riskFactors || riskFactors.length === 0) return 0;

  const hasKnownAthero = riskFactors.includes("knownAthero");
  // All checkboxes except knownAthero contribute to count
  const count = riskFactors.filter((rf) => rf !== "knownAthero").length;

  if (hasKnownAthero) {
    // By definition, known atherosclerotic disease → 2 points
    return 2;
  }

  if (count === 0) return 0;
  if (count <= 2) return 1;
  return 2;
}

function classifyHeartRiskCategory(totalScore) {
  if (totalScore <= 3) return "low";
  if (totalScore <= 6) return "intermediate";
  return "high";
}

// ---- Interpretation ----

function interpretResults(results) {
  let summary = "";
  const notes = [];

  if (results.riskCategory === "low") {
    summary = "Low-risk HEART score (0–3).";
    notes.push(
      "Associated with 0.9–1.7% risk of MACE; in the HEART score study, these patients were typically discharged."
    );
  } else if (results.riskCategory === "intermediate") {
    summary = "Intermediate-risk HEART score (4–6).";
    notes.push(
      "Associated with a 12–16.6% estimated risk of MACE; in the HEART score study, these patients were typically admitted to the hospital."
    );
  } else {
    summary = "High-risk HEART score (7–10).";
    notes.push(
      "Associated with 50–65% risk of MACE; in the HEART score study, these patients were candidates for early invasive measures."
    );
  }

  // MACE definition – shown for all risk categories
  notes.push(
    "Major adverse cardiac events (MACE): acute myocardial infarction, need for percutaneous coronary intervention or coronary artery bypass graft, or death within 6 weeks."
  );

  if (results.ageYears < 18) {
    notes.push(
      "HEART score was developed for adult chest pain populations; use in younger patients is not well validated."
    );
  }

  return {
    summary,
    notes,
  };
}

// ---- Flags / Alerts ----

function deriveFlags(results, interpretation) {
  const flags = [];

  // Risk-based flags
  if (results.riskCategory === "high") {
    flags.push({
      level: "danger",
      message:
        "High-risk HEART score (≥7). Consider urgent evaluation per ACS protocol.",
    });
  } else if (results.riskCategory === "intermediate") {
    flags.push({
      level: "warning",
      message:
        "Intermediate-risk HEART score (4–6). Requires close clinical follow-up and appropriate testing.",
    });
  }

  // Age-related flags
  if (results.ageYears < 18) {
    flags.push({
      level: "warning",
      message:
        "Tool is primarily validated for adult chest pain populations (≥18 years).",
    });
  }

  return flags;
}

// ---- Rendering ----

function renderValidationErrors(container, errors) {
  container.innerHTML = `
    <div class="results-errors">
      <h3>Check your inputs</h3>
      <ul>
        ${errors.map((err) => `<li>${err}</li>`).join("")}
      </ul>
    </div>
  `;
}

function renderResults(container, results, interpretation) {
  const riskLabel =
    results.riskCategory === "low"
      ? "Low"
      : results.riskCategory === "intermediate"
      ? "Intermediate"
      : "High";

  const riskClass =
    results.riskCategory === "high"
      ? "results-value results-value--danger"
      : "results-value results-value--accent";

  container.innerHTML = `
    <div class="results-section">
      <h3>Key Values</h3>
      <ul class="results-list">
        <li>
          <span class="results-label">History component</span>
          <span class="results-value">${results.historyScore} pts</span>
        </li>
        <li>
          <span class="results-label">ECG component</span>
          <span class="results-value">${results.ecgScore} pts</span>
        </li>
        <li>
          <span class="results-label">Age component</span>
          <span class="results-value">${results.agePoints} pts (Age ${formatNumber(
            results.ageYears,
            0
          )} yrs)</span>
        </li>
        <li>
          <span class="results-label">Risk factor component</span>
          <span class="results-value">${results.riskFactorPoints} pts</span>
        </li>
        <li>
          <span class="results-label">Troponin component</span>
          <span class="results-value">${results.tropScore} pts</span>
        </li>
        <li>
          <span class="results-label">Total HEART score</span>
          <span class="${riskClass}">${results.totalScore} / 10</span>
        </li>
        <li>
          <span class="results-label">Risk category</span>
          <span class="${riskClass}">${riskLabel} risk</span>
        </li>
      </ul>

      <h3>Interpretation</h3>
      <p>${interpretation.summary}</p>
      ${
        interpretation.notes?.length
          ? `<ul>${interpretation.notes
              .map((note) => `<li>${note}</li>`)
              .join("")}</ul>`
          : ""
      }
    </div>
  `;
}

function renderFlags(container, flags) {
  if (!flags || flags.length === 0) {
    container.innerHTML = `
      <p class="results-placeholder">
        No critical flags based on the provided values. Always correlate clinically.
      </p>
    `;
    return;
  }

  container.innerHTML = flags
    .map((flag) => {
      const cls =
        flag.level === "danger"
          ? "flag-pill flag-pill--danger"
          : "flag-pill flag-pill--warning";
      return `<div class="${cls}">${flag.message}</div>`;
    })
    .join("");
}

function formatNumber(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number(value).toFixed(decimals);
}

// ---- Exportable Core Logic (for future unified app) ----
// Example of a reusable function you can import elsewhere.

function calculateHeartScoreFromRaw(inputs) {
  const agePoints = calculateHeartAgePoints(inputs.ageYears);
  const riskFactorPoints = calculateHeartRiskFactorPoints(inputs.riskFactors);
  const totalScore =
    inputs.historyScore +
    inputs.ecgScore +
    agePoints +
    riskFactorPoints +
    inputs.tropScore;
  const riskCategory = classifyHeartRiskCategory(totalScore);

  return {
    totalScore,
    riskCategory,
    agePoints,
    riskFactorPoints,
  };
}
