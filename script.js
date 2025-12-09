// script.js – VA Night Shift Algorithm (ClinicalToolsDEV, compact mobile layout)

// ----- Team labels based on date rotation -----

console.log("script.js loaded");

const ROLE_LABELS = {
  L: "Long call",
  M: "Medium call",
  Post: "Post call",
  Pre: "Pre call",
  S: "Short call",
};

const SHORT_ROLE_LABELS = {
  L: "Long",
  M: "Medium",
  Post: "Post",
  Pre: "Pre",
  S: "Short",
};

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("tool-form");
  const resultsContainer = document.getElementById("results-container");
  const flagsContainer = document.getElementById("flags-container");

  // Set labels with date-based team rotation on load
  const teamMapping = calculateDefaultTeamRotation();
  console.log("Team mapping:", teamMapping);
  applyTeamLabels(teamMapping);

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

    const calcResults = performCalculations(inputs, teamMapping);
    const flags = deriveFlags(calcResults);

    renderResults(resultsContainer, calcResults);
    renderFlags(flagsContainer, flags);
  });
});

function applyTeamLabels(teamMapping) {
  ["L", "M", "Post", "Pre", "S"].forEach((role) => {
    const el = document.getElementById(`label-${role}`);
    if (!el) return;
    const teamNum = teamMapping[role];
    const text = teamNum
      ? `${ROLE_LABELS[role]} (Team ${teamNum})`
      : `${ROLE_LABELS[role]} (Team ?)`;
    el.textContent = text;
  });
}

// ----- Input handling -----

function readInputs() {
  const getNumber = (id) => {
    const val = document.getElementById(id)?.value;
    if (val === "" || val === null || val === undefined) return null;
    const num = Number(val);
    return Number.isNaN(num) ? null : num;
  };

  const L_start = getNumber("L_start");
  const M_start = getNumber("M_start");
  const Post_start = getNumber("Post_start");
  const Pre_start = getNumber("Pre_start");
  const S_start = getNumber("S_start");
  const numAdmissions = getNumber("numAdmissions");

  return {
    startingCensus: {
      L: L_start,
      M: M_start,
      Post: Post_start,
      Pre: Pre_start,
      S: S_start,
    },
    numAdmissions,
  };
}

function validateInputs(inputs) {
  const errors = [];
  const roles = ["L", "M", "Post", "Pre", "S"];

  roles.forEach((role) => {
    const value = inputs.startingCensus[role];
    if (value === null) {
      errors.push(`${ROLE_LABELS[role]} starting census is required.`);
    } else if (!Number.isFinite(value) || value < 0) {
      errors.push(`${ROLE_LABELS[role]} starting census must be a non-negative number.`);
    }
  });

  if (inputs.numAdmissions === null) {
    errors.push("Number of overnight admissions is required.");
  } else if (!Number.isInteger(inputs.numAdmissions) || inputs.numAdmissions <= 0) {
    errors.push("Number of overnight admissions must be a positive whole number.");
  } else if (inputs.numAdmissions > 40) {
    errors.push("For safety, limit the simulation to 40 admissions or fewer.");
  }

  return errors;
}

// ----- Core calculations -----

function performCalculations(inputs, teamMapping) {
  const startingCensus = {
    L: inputs.startingCensus.L,
    M: inputs.startingCensus.M,
    Post: inputs.startingCensus.Post,
    Pre: inputs.startingCensus.Pre,
    S: inputs.startingCensus.S,
  };

  const simulation = simulateAdmissions(startingCensus, inputs.numAdmissions, teamMapping);

  return {
    startingCensus,
    numAdmissions: inputs.numAdmissions,
    teamMapping,
    steps: simulation.steps,
    finalCensus: simulation.finalCensus,
  };
}

// Date-based rotation (Excel logic)

function calculateDefaultTeamRotation() {
  // Excel baseDate = 2025-11-13; JS months are 0-based
  const baseDate = new Date(2025, 10, 13);
  const today = truncateToDay(new Date());
  const baseTeamsPreOrder = [4, 5, 1, 2, 3]; // {4;5;1;2;3} in Excel

  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((today.getTime() - baseDate.getTime()) / msPerDay);
  const offset = ((diffDays % 5) + 5) % 5; // safe mod

  const todayTeamsPreOrder = [];
  for (let i = 0; i < 5; i++) {
    todayTeamsPreOrder.push(baseTeamsPreOrder[(i + offset) % 5]);
  }

  // Indices (1-based in Excel) mapped as:
  // Pre = 1, M = 2, S = 3, Post = 4, L = 5
  return {
    Pre: todayTeamsPreOrder[0],
    M: todayTeamsPreOrder[1],
    S: todayTeamsPreOrder[2],
    Post: todayTeamsPreOrder[3],
    L: todayTeamsPreOrder[4],
  };
}

function truncateToDay(date) {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

// Simulate admission sequence
function simulateAdmissions(startingCensus, numAdmissions, teamMapping) {
  const steps = [];
  let currentCensus = { ...startingCensus };

  for (let i = 0; i < numAdmissions; i++) {
    const phase = computePhase(currentCensus);
    const resultRole = determineResultRole(currentCensus, phase);
    const callChief = checkMaxFlag(resultRole, currentCensus);

    const censusBefore = { ...currentCensus };
    let censusAfter = { ...currentCensus };
    let display;
    const teamNumber = teamMapping[resultRole];

    if (callChief || !teamNumber) {
      // CALL CHIEF or missing mapping → do not bump census
      display = "CALL CHIEF";
    } else {
      censusAfter[resultRole] = censusAfter[resultRole] + 1;
         display = `${SHORT_ROLE_LABELS[resultRole]} (Team ${teamNumber})`;
    }

    steps.push({
      admissionIndex: i,
      phase,
      resultRole,
      display,
      callChief,
      censusBefore,
      censusAfter,
    });

    currentCensus = censusAfter;
  }

  return {
    steps,
    finalCensus: currentCensus,
  };
}

// Phase logic (mirrors Excel LET formula)
function computePhase(census) {
  const values = [census.L, census.M, census.Post, census.Pre, census.S];
  const minCensus = Math.min(...values);

  if (minCensus < 6) return "AllTo6";
  if (census.L < 10) return "Lto10";
  if (census.M < 8) return "Mto8";
  if (minCensus < 8) return "AllTo8";
  if (census.L < 12) return "Lto12";
  if (census.M < 10) return "Mto10";
  if (minCensus < 10) return "AllTo10";
  if (census.L < 14) return "Lto14";
  if (census.M < 12) return "Mto12";
  if (minCensus < 12) return "AllTo12";
  if (census.M < 14 || census.Pre < 14) return "MPreTo14";
  if (census.Post < 14 || census.S < 14) return "PostSTo14";
  if (census.L < 16) return "Lto16";
  return "Fallback";
}

// For AllToX phases: choose lowest census under cap
function pickAllTeamsChoice(census, phase) {
  const roles = ["L", "M", "Post", "Pre", "S"];
  let cap;

  if (phase === "AllTo6") cap = 6;
  else if (phase === "AllTo8") cap = 8;
  else if (phase === "AllTo10") cap = 10;
  else if (phase === "AllTo12") cap = 12;
  else cap = 999;

  const adjusted = roles.map((role) => {
    const value = census[role];
    return value < cap ? value : 999;
  });

  const minVal = Math.min(...adjusted);
  const idx = adjusted.indexOf(minVal);
  return roles[idx] || "L"; // fallback
}

// Map phase + census to result role
function determineResultRole(census, phase) {
  switch (phase) {
    case "Lto10":
    case "Lto12":
    case "Lto14":
    case "Lto16":
      return "L";
    case "Mto8":
    case "Mto10":
    case "Mto12":
      return "M";
    case "MPreTo14":
      return census.M <= census.Pre ? "M" : "Pre";
    case "PostSTo14":
      return census.Post <= census.S ? "Post" : "S";
    default:
      return pickAllTeamsChoice(census, phase);
  }
}

// Hard caps for CALL CHIEF
function checkMaxFlag(resultRole, census) {
  const thresholds = {
    L: 16,
    M: 14,
    Post: 14,
    Pre: 14,
    S: 14,
  };
  const threshold = thresholds[resultRole];
  if (threshold === undefined) return false;
  return census[resultRole] >= threshold;
}

// ----- Flags -----

function deriveFlags(calcResults) {
  const flags = [];
  const { steps, finalCensus } = calcResults;

  // --- CALL CHIEF FLAGS (collapsed to a single pill) ---

  // Collect all admissions where CALL CHIEF was triggered
  const callChiefAdmissions = steps
    .filter((step) => step.callChief)
    .map((step) => step.admissionIndex + 1);

  if (callChiefAdmissions.length === 1) {
    // Single event
    flags.push({
      level: "danger",
      message: `CALL CHIEF at admission #${callChiefAdmissions[0]} (see matrix for details).`,
    });
  } else if (callChiefAdmissions.length > 1) {
    // Multiple events → single summary pill
    const listText =
      callChiefAdmissions.length <= 6
        ? callChiefAdmissions.join(", ")
        : `${callChiefAdmissions.slice(0, 6).join(", ")}, …`;

    flags.push({
      level: "danger",
      message: `CALL CHIEF triggered on multiple admissions (#${listText}). See matrix for details.`,
    });
  }

  // --- CAP / NEAR-CAP FLAGS (one per team, as before) ---

  const nearCaps = [
    { role: "L", value: finalCensus.L, soft: 14, hard: 16 },
    { role: "M", value: finalCensus.M, soft: 12, hard: 14 },
    { role: "Post", value: finalCensus.Post, soft: 12, hard: 14 },
    { role: "Pre", value: finalCensus.Pre, soft: 12, hard: 14 },
    { role: "S", value: finalCensus.S, soft: 12, hard: 14 },
  ];

  nearCaps.forEach(({ role, value, soft, hard }) => {
    if (value >= hard) {
      flags.push({
        level: "danger",
        message: `${ROLE_LABELS[role]} at or above hard cap (${value} ≥ ${hard}).`,
      });
    } else if (value >= soft) {
      flags.push({
        level: "warning",
        message: `${ROLE_LABELS[role]} approaching cap (${value} ≥ ${soft}).`,
      });
    }
  });

  return flags;
}

// ----- Rendering -----

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

function renderResults(container, results) {
  const { teamMapping, steps, startingCensus, finalCensus, numAdmissions } = results;

  const date = new Date();
  const dateLabel = date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const mappingItems = ["L", "M", "Post", "Pre", "S"]
    .map((role) => {
      const t = teamMapping[role];
      const label = ROLE_LABELS[role];
      if (!t) return `<li>${label}: <span>Team ?</span></li>`;
      return `<li>${label}: <span>Team ${t}</span></li>`;
    })
    .join("");

  const admissionsRows = steps
  .map((step) => {
    const n = step.admissionIndex + 1;
    const selectedRole = step.callChief ? null : step.resultRole;
    const phase = step.phase;
    const c = step.censusAfter; // after admission

    const cellClass = (role) => {
      if (!selectedRole || selectedRole !== role) return "";
      return `cell-selected cell-selected--${role}`;
    };

    const resultText = step.callChief ? "CALL CHIEF" : step.display;
    const resultClass = step.callChief ? "cell-call-chief" : "";

    const roleColorClass = step.callChief || !selectedRole
      ? ""
      : `result-role result-role--${selectedRole}`;

    return `
      <tr>
        <td>${n}</td>
        <td class="${resultClass} ${roleColorClass}">${resultText}</td>
        <td class="${cellClass("L")}">${c.L}</td>
        <td class="${cellClass("M")}">${c.M}</td>
        <td class="${cellClass("Post")}">${c.Post}</td>
        <td class="${cellClass("Pre")}">${c.Pre}</td>
        <td class="${cellClass("S")}">${c.S}</td>
      </tr>
    `;
  })
  .join("");

  container.innerHTML = `
    <div class="results-section">
      <div class="results-summary">
        <strong>Date:</strong> ${dateLabel} &nbsp;•&nbsp;
        <strong>Admissions simulated:</strong> ${numAdmissions}
      </div>

      <h3>Today's call teams</h3>
      <ul class="mapping-list">
        ${mappingItems}
      </ul>

      <h3>Starting census</h3>
      <p>
        Long call: ${startingCensus.L},
        Medium call: ${startingCensus.M},
        Post call: ${startingCensus.Post},
        Pre call: ${startingCensus.Pre},
        Short call: ${startingCensus.S}
      </p>

      <h3>Admission matrix</h3>
      <table class="admissions-table">
        <thead>
          <tr>
            <th>Admit #</th>
            <th>Assigned Team</th>
            <th>L</th>
            <th>M</th>
            <th>Post</th>
            <th>Pre</th>
            <th>S</th>
          </tr>
        </thead>
        <tbody>
          ${admissionsRows}
        </tbody>
      </table>

      <h3>Final census</h3>
      <p>
        Long call: ${finalCensus.L},
        Medium call: ${finalCensus.M},
        Post call: ${finalCensus.Post},
        Pre call: ${finalCensus.Pre},
        Short call: ${finalCensus.S}
      </p>
    </div>
  `;
}

function renderFlags(container, flags) {
  if (!flags || flags.length === 0) {
    container.innerHTML = `
      <p class="results-placeholder">
        No capacity flags in this simulation. Always correlate with real-time clinical context and local policies.
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
