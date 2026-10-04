// === AI Medicine Collective: tool requests board ===
//
// Loaded on requests.html, after the Supabase library and auth.js (it uses
// db, el, button, formatDate, loadingBlock, emptyState and
// getSessionAndProfile from there; the scripts share one global scope, so
// top-level names here must not repeat names in the other scripts).
//
// "I wish there were a tool for X": members post a request, upvote the ones
// they want, and claim one to build it. Members-only, enforced by the
// database (migration 009), not by this file.

const REQUEST_COLUMNS =
  "id, title, details, status, created_at, " +
  "author:profiles!tool_requests_author_id_fkey(id, full_name), " +
  "claimer:profiles!tool_requests_claimed_by_fkey(id, full_name), " +
  "project:projects(id, title, kind)";

const REQUEST_STATUS_LABELS = { open: "OPEN", claimed: "BEING BUILT", done: "BUILT" };

function initRequestsPage() {
  const app = document.getElementById("requests-app");
  if (!app) return;

  let me = null;
  let filter = "open";
  const isModerator = () => me.role === "moderator" || me.role === "admin";

  const status = el("p", "account-status hub-status");
  status.setAttribute("role", "status");
  const say = (text, isError) => {
    status.textContent = text || "";
    status.classList.toggle("is-error", !!isError);
  };

  // Runs a change, then redraws the board
  async function act(work, failText) {
    say("> WORKING...");
    const { error } = await work();
    if (error) {
      console.error(error);
      say(failText, true);
      return;
    }
    say("");
    await load();
  }

  function requestForm() {
    const wrap = el("details", "account-details request-form");
    wrap.append(el("summary", "account-details-summary", "+ Request a tool"));

    const form = el("form", "account-details-form");
    const title = el("input", "join-input");
    title.id = "request-title";
    title.type = "text";
    title.required = true;
    title.minLength = 5;
    title.maxLength = 120;
    title.placeholder = "I wish there were a tool that…";
    const titleLabel = el("label", "join-label", "Idea");
    titleLabel.htmlFor = title.id;
    const titleRow = el("div", "join-row join-row--stacked");
    titleRow.append(titleLabel, title);

    const details = el("textarea", "join-input");
    details.id = "request-details";
    details.rows = 3;
    details.maxLength = 1000;
    details.placeholder = "Who would use it, and when? What does it replace? (optional)";
    const detailsLabel = el("label", "join-label", "Details");
    detailsLabel.htmlFor = details.id;
    const detailsRow = el("div", "join-row join-row--stacked");
    detailsRow.append(detailsLabel, details);

    const send = el("button", "join-submit", "> Post request");
    send.type = "submit";
    form.append(titleRow, detailsRow, send,
      el("p", "join-hint", "// Visible to members. No patient information: describe the problem, not a patient."));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = title.value.trim();
      if (text.length < 5) return;
      send.disabled = true;
      await act(() => db.from("tool_requests").insert({
        author_id: me.id,
        title: text,
        details: details.value.trim() || null,
      }), "> COULD NOT POST YOUR REQUEST. Please try again.");
      send.disabled = false;
    });

    wrap.append(form);
    return wrap;
  }

  function requestCard(request, votes, mine, myProjects) {
    const card = el("article", "request-card");

    // Upvote: a toggle. Built requests keep their count but can't be voted on.
    const voted = mine.has(request.id);
    const vote = button(`▲ ${votes}`, "request-vote", () => act(
      () => (voted
        ? db.from("tool_request_votes").delete().eq("request_id", request.id).eq("user_id", me.id)
        : db.from("tool_request_votes").insert({ request_id: request.id, user_id: me.id })),
      "> COULD NOT SAVE YOUR VOTE. Please try again."));
    vote.setAttribute("aria-pressed", String(voted));
    vote.setAttribute("aria-label", voted ? `Remove your vote (${votes} votes)` : `Upvote (${votes} votes)`);
    vote.disabled = request.status === "done";

    const body = el("div", "request-body");
    const head = el("div", "hub-card-head");
    head.append(el("span", "project-title", request.title),
      el("span", `member-tag request-${request.status}`, REQUEST_STATUS_LABELS[request.status]));
    body.append(head);
    if (request.details) body.append(el("p", "request-details", request.details));
    body.append(el("p", "hub-card-meta",
      `// ${(request.author && request.author.full_name) || "Member"} · ${formatDate(request.created_at)}`));

    const actions = el("div", "request-actions");
    const claimedByMe = request.claimer && request.claimer.id === me.id;

    if (request.status === "open") {
      actions.append(button("> I'll build this", "hub-tab hub-tab--submit", () => act(
        () => db.rpc("claim_tool_request", { target: request.id }),
        "> COULD NOT CLAIM IT. Someone may have just picked it up.")));
    } else if (request.status === "claimed") {
      actions.append(el("span", "note", claimedByMe
        ? "// You're building this."
        : `// ${(request.claimer && request.claimer.full_name) || "A member"} is building this.`));
      if (claimedByMe || isModerator()) {
        // Optionally point at the finished, published project
        const pick = el("select", "join-input request-pick");
        pick.setAttribute("aria-label", "The published project that answers this request");
        const none = el("option", null, "No project to link");
        none.value = "";
        pick.append(none);
        for (const project of myProjects) {
          const option = el("option", null, project.title);
          option.value = project.id;
          pick.append(option);
        }
        actions.append(
          pick,
          button("> Mark built", "hub-tab", () => act(
            () => db.rpc("complete_tool_request", { target: request.id, built: pick.value || null }),
            "> COULD NOT MARK IT BUILT. Please try again.")),
          button("Release", "hub-tab", () => act(
            () => db.rpc("release_tool_request", { target: request.id }),
            "> COULD NOT RELEASE IT. Please try again."))
        );
      }
    } else if (request.project) {
      const link = el("a", "account-mod-link", `> OPEN: ${request.project.title}`);
      link.href = `${request.project.kind === "material" ? "learn.html" : "hub.html"}?project=${encodeURIComponent(request.project.id)}`;
      actions.append(link);
    } else {
      actions.append(el("span", "note",
        `// Built by ${(request.claimer && request.claimer.full_name) || "a member"}.`));
    }

    const mayDelete = isModerator() || (request.author && request.author.id === me.id && request.status === "open");
    if (mayDelete) {
      actions.append(button("Delete", "hub-tab request-delete", () => {
        if (!window.confirm("Delete this request? This can't be undone.")) return;
        act(() => db.from("tool_requests").delete().eq("id", request.id),
          "> COULD NOT DELETE IT. Please try again.");
      }));
    }

    body.append(actions);
    card.append(vote, body);
    return card;
  }

  async function load() {
    const [requests, votes, projects] = await Promise.all([
      db.from("tool_requests").select(REQUEST_COLUMNS).order("created_at", { ascending: false }),
      db.from("tool_request_votes").select("request_id, user_id"),
      db.from("projects").select("id, title").eq("author_id", me.id).eq("status", "published")
        .order("created_at", { ascending: false }),
    ]);
    if (requests.error || votes.error) {
      console.error(requests.error || votes.error);
      app.replaceChildren(el("p", "account-status is-error", "> REQUESTS AREN'T AVAILABLE YET. Please try again later."));
      return;
    }

    const counts = new Map();
    const mine = new Set();
    for (const row of votes.data) {
      counts.set(row.request_id, (counts.get(row.request_id) || 0) + 1);
      if (row.user_id === me.id) mine.add(row.request_id);
    }

    const tabs = el("div", "filter-bar");
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Filter requests by status");
    for (const [key, label] of [["open", "OPEN"], ["claimed", "BEING BUILT"], ["done", "BUILT"]]) {
      const n = requests.data.filter((r) => r.status === key).length;
      const tab = button(`${label} (${n})`, "filter-btn", () => { filter = key; load(); });
      tab.setAttribute("aria-pressed", String(filter === key));
      tabs.append(tab);
    }

    // Most wanted first; ties go to the newer request
    const shown = requests.data
      .filter((r) => r.status === filter)
      .sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0));

    const nodes = [requestForm(), tabs, status];
    if (!shown.length) {
      nodes.push(filter === "open"
        ? emptyState("// No open requests", "What would save you ten minutes a day? Post it above and see who else wants it.")
        : emptyState(filter === "claimed" ? "// Nothing being built right now" : "// Nothing built yet",
          "Pick an open request and say you'll build it."));
    } else {
      const list = el("div", "request-list");
      shown.forEach((request) => list.append(
        requestCard(request, counts.get(request.id) || 0, mine, projects.data || [])));
      nodes.push(list);
    }
    app.replaceChildren(...nodes);
  }

  (async () => {
    app.replaceChildren(loadingBlock("> CHECKING ACCESS..."));
    try {
      const { session, profile } = await getSessionAndProfile();
      const gate = (text, linkText) => {
        const link = el("a", "account-mod-link", linkText);
        link.href = "account.html";
        app.replaceChildren(el("p", "account-status", "> MEMBERS ONLY"), el("p", null, text), link);
      };
      if (!session) {
        return gate("Members post ideas for tools they wish existed, vote on them, and pick one to build.",
          "> SIGN IN OR REQUEST MEMBERSHIP");
      }
      if (!profile || !["member", "moderator", "admin"].includes(profile.role)) {
        return gate("Your membership isn't active yet. Requests open once a moderator approves you.", "> CHECK YOUR STATUS");
      }
      me = profile;
      await load();
    } catch (err) {
      console.error(err);
      app.replaceChildren(el("p", "account-status is-error", "> COULD NOT LOAD REQUESTS. Please refresh the page."));
    }
  })();
}

document.addEventListener("DOMContentLoaded", initRequestsPage);
