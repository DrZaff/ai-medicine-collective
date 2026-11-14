// === FAQ page (faq.html): questions and answers from faq/faq.json ===
// Loaded after script.js (uses niceDate and copyText). Answers are drafted by
// an AI agent and reviewed before merging, so they are drawn with textContent
// only, never as HTML. scripts/seo/build_seo.py writes the same markup into
// the page at deploy time for readers without JavaScript; this replaces it.
(function () {
  const app = document.getElementById("faq-app");
  if (!app) return;

  const SITE = "https://www.aimedicinecollective.com/faq.html";
  const search = document.getElementById("faq-search");
  const count = document.getElementById("faq-count");

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  };

  const safeUrl = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
    } catch {
      return null;
    }
  };

  // "... detection [1][2]." -> text with numbered links to the sources below it
  function answerText(item) {
    const p = el("p", "faq-text");
    String(item.answer).split(/(\[\d+\])/).forEach((part) => {
      const n = /^\[(\d+)\]$/.exec(part);
      if (!n) return p.append(part);
      if (!item.sources[Number(n[1]) - 1]) return;
      const link = el("a", "review-cite", `[${n[1]}]`);
      link.href = `#faq-${item.id}-src-${n[1]}`;
      p.append(link);
    });
    return p;
  }

  function flash(button, text) {
    const before = button.textContent;
    button.textContent = text;
    setTimeout(() => { button.textContent = before; }, 1600);
  }

  function itemNode(item, updated) {
    const details = el("details", "faq-item resource-group");
    details.id = `faq-${item.id}`;
    details.dataset.search = [item.question, item.answer, ...(item.keywords || [])].join(" ").toLowerCase();
    const summary = el("summary", "faq-question resource-summary", item.question);
    const body = el("div", "faq-answer resource-body");
    body.append(answerText(item));
    // A correction that changed a number or a result is noted, with its date
    // (corrections.html), never made silently
    if (item.correction && item.correction.note) {
      body.append(el("p", "faq-correction",
        `Corrected ${niceDate(item.correction.date)}: ${item.correction.note}`));
    }

    if (item.sources && item.sources.length) {
      const list = el("ol", "faq-sources");
      item.sources.forEach((source, i) => {
        const li = el("li");
        li.id = `faq-${item.id}-src-${i + 1}`;
        const href = safeUrl(source.url);
        const title = el(href ? "a" : "span", "faq-source-title", source.title);
        if (href) {
          title.href = href;
          title.target = "_blank";
          title.rel = "noopener noreferrer";
        }
        li.append(title);
        const meta = [source.source, source.published && niceDate(source.published)].filter(Boolean).join(", ");
        if (meta) li.append(" ", el("span", "faq-source-meta", meta));
        list.append(li);
      });
      body.append(el("p", "faq-sources-label", "// Sources"), list);
    }

    const meta = el("p", "faq-meta");
    meta.append(`Last reviewed ${niceDate(item.updated || updated)} · `);
    const link = `${SITE}#faq-${item.id}`;
    const share = el("button", "faq-share", "Copy link");
    share.type = "button";
    share.addEventListener("click", () => copyText(link).then(() => flash(share, "Link copied"), () => flash(share, "Could not copy")));
    const cite = el("button", "faq-share", "Cite this answer");
    cite.type = "button";
    cite.addEventListener("click", () => {
      const text = `AI Medicine Collective. ${item.question} In: Frequently asked questions: AI in medicine. ` +
        `Last reviewed ${niceDate(item.updated || updated)}. ${link}`;
      copyText(text).then(() => flash(cite, "Citation copied"), () => flash(cite, "Could not copy"));
    });
    meta.append(share, " ", cite);
    body.append(meta);
    details.append(summary, body);
    return details;
  }

  function render(faq) {
    const nav = el("nav", "faq-cats");
    nav.setAttribute("aria-label", "Topics");
    const groups = [];
    faq.categories.forEach((category) => {
      const items = faq.items.filter((item) => item.category === category.id);
      if (!items.length) return;
      const jump = el("a", "faq-cat", `${category.name} (${items.length})`);
      jump.href = `#faq-topic-${category.id}`;
      nav.append(jump);
      const group = el("section", "faq-group");
      group.id = `faq-topic-${category.id}`;
      group.append(el("h3", "subsection-title faq-group-title", `// ${category.name}`));
      items.forEach((item) => group.append(itemNode(item, faq.updated)));
      groups.push(group);
    });
    app.replaceChildren(nav, ...groups);
    if (count) count.textContent = `// ${faq.items.length} questions · updated ${niceDate(faq.updated)}`;
  }

  function filter() {
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    app.querySelectorAll(".faq-item").forEach((item) => {
      const match = words.every((word) => item.dataset.search.includes(word));
      item.hidden = !match;
      if (match) shown += 1;
    });
    app.querySelectorAll(".faq-group").forEach((group) => {
      group.hidden = !group.querySelector(".faq-item:not([hidden])");
    });
    if (count) count.textContent = words.length ? `// ${shown} matching ${shown === 1 ? "question" : "questions"}` : "";
  }

  // #faq-<id> in the address opens that answer
  function openFromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id.startsWith("faq-")) return;
    const target = document.getElementById(id);
    const item = target && target.closest(".faq-item");
    if (!item) return;
    item.open = true;
    target.scrollIntoView({ block: "start" });
  }

  fetch("faq/faq.json", { cache: "no-cache" })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null)
    .then((faq) => {
      if (!faq || !Array.isArray(faq.items) || !Array.isArray(faq.categories)) {
        // keep the questions written into the page at deploy time, if any
        if (!app.querySelector(".faq-item")) app.replaceChildren(el("p", "blog-status", "> THE QUESTIONS COULD NOT BE LOADED. PLEASE TRY AGAIN LATER."));
        return;
      }
      render(faq);
      if (search) search.addEventListener("input", filter);
      openFromHash();
      window.addEventListener("hashchange", openFromHash);
    });
})();
