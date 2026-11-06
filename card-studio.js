/* Signature Card Studio (signature-card-studio.html).
   Draws two-sided business cards as SVG from the design library in
   card-studio-designs.js, fits every line to its space (fitHeading, fitBody),
   and runs the editor, the gallery, the shared digital card (#card=...) and
   the downloads. Nothing typed here leaves the page: there is no server.
   Wrapped in a function so its names never meet script.js's. */

(function () {
  "use strict";

  const D = window.CARD_DESIGNS;
  const NS = "http://www.w3.org/2000/svg";
  const SAFE = { left: 25, top: 25, right: 675, bottom: 375 };
  const BLEED = 25; // 0.125 in at 200 units per inch
  const QR_BOX = { x: 445, y: 100, size: 215 };
  const FIELDS = [
    ["name", "Name", "Alex Morgan"],
    ["credentials", "Credentials", "MD"],
    ["title", "Title", "Internal Medicine"],
    ["affiliation", "Affiliation", "Morgan Clinic"],
    ["email", "Email", "alex@example.com"],
    ["phone", "Phone", "(202) 555-0100"],
    ["website", "Website", "example.com/alex"],
  ];
  const HEADING_FIELDS = new Set(["name", "header"]);
  const FIT = {
    name: { oneLineFloor: 32, twoLineCap: 36 },
    header: { oneLineFloor: 24, twoLineCap: 28 },
    floor: 20,       // nothing smaller: 20 units is 7.2 pt at card size
    leading: 1.1,
    promote: 36,     // an affiliation this close below an empty title moves up
  };

  const byId = (id) => document.getElementById(id);
  const indexByName = (list, name) => Math.max(0, list.findIndex((item) => item.name === name));
  const escapeXml = (value) => String(value).replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));

  // ---------------------------------------------------------------- measuring

  const context = document.createElement("canvas").getContext("2d");

  // The width of the glyphs actually drawn, in the font the browser resolves
  function measure(text, size, family, weight) {
    context.font = `${weight} ${size}px ${family}`;
    const m = context.measureText(text);
    const ink = (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || 0);
    return Math.max(m.width, ink);
  }

  // How wide a line may be: its own limit, and never past the safe area
  function room(x, anchor, maxWidth) {
    if (anchor === "end") return Math.min(maxWidth, x - SAFE.left);
    if (anchor === "middle") return Math.min(maxWidth, 2 * Math.min(x - SAFE.left, SAFE.right - x));
    return Math.min(maxWidth, SAFE.right - x);
  }

  // The largest size (to a tenth of a unit, at most `cap`) at which every line fits
  function largestSize(lines, cap, width, family, weight) {
    const atOne = Math.max(...lines.map((line) => measure(line, 100, family, weight))) / 100;
    if (!atOne) return cap;
    let size = Math.min(cap, Math.floor((width / atOne) * 10) / 10);
    while (size > 1 && Math.max(...lines.map((line) => measure(line, size, family, weight))) > width) size -= 0.5;
    return size;
  }

  function graphemes(text) {
    if (window.Intl && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);
    }
    return Array.from(text);
  }

  // A name or header: one line if it fits at the listed size or no smaller
  // than the one-line floor; else two lines (a break before the credentials
  // preferred, then spaces and hyphens, then anywhere), down to 20 units.
  function fitHeading(text, kind, size, width, family, mainName) {
    const rules = FIT[kind];
    const one = largestSize([text], size, width, family, 700);
    if (one >= rules.oneLineFloor) return { lines: [text], size: one };

    const cap = Math.min(size, rules.twoLineCap);
    const options = [];
    if (mainName && text.startsWith(mainName + ", ")) {
      options.push({ lines: [mainName + ",", text.slice(mainName.length + 2)], credentials: true });
    }
    for (let i = 1; i < text.length - 1; i++) {
      if (text[i] === " ") options.push({ lines: [text.slice(0, i), text.slice(i + 1)] });
      else if (text[i] === "-") options.push({ lines: [text.slice(0, i + 1), text.slice(i + 1)] });
    }
    options.forEach((option) => { option.size = largestSize(option.lines, cap, width, family, 700); });
    let best = options.reduce((a, b) => (b.size > (a ? a.size : -1) ? b : a), null);
    const credentials = options.find((option) => option.credentials);
    if (credentials && best && credentials.size >= best.size * 0.95) best = credentials;

    if (!best || best.size < FIT.floor) {
      // One long word: break between characters where the halves balance
      const parts = graphemes(text);
      for (let i = 1; i < parts.length; i++) {
        const lines = [parts.slice(0, i).join(""), parts.slice(i).join("")];
        const fitted = largestSize(lines, cap, width, family, 700);
        if (!best || fitted > best.size) best = { lines, size: fitted };
      }
    }
    if (best.size >= FIT.floor) return { lines: best.lines, size: best.size };
    return { lines: best.lines, size: FIT.floor, overflow: true };
  }

  // Everything else: one line, shrinking to 20 units at most
  function fitBody(text, size, width, family) {
    const fitted = largestSize([text], size, width, family, 400);
    if (fitted >= FIT.floor) return { lines: [text], size: fitted };
    return { lines: [text], size: FIT.floor, overflow: true };
  }

  // ---------------------------------------------------------------- drawing

  function cardText(values) {
    const name = [values.name, values.credentials].filter(Boolean).join(", ");
    return { ...values, fullName: name, header: values.affiliation || name };
  }

  // The rows a face shows, after leaving out empty fields
  function rows(face, values, back) {
    let list = face.text
      .map(([field, x, y, anchor, size, maxWidth]) => ({ field, x, y, anchor, size, maxWidth }))
      .map((row) => ({ ...row, value: row.field === "name" ? values.fullName : values[row.field] || "" }));
    if (!back) {
      const title = list.find((row) => row.field === "title");
      const affiliation = list.find((row) => row.field === "affiliation");
      if (title && affiliation && !title.value && affiliation.value && title.x === affiliation.x &&
          title.anchor === affiliation.anchor && Math.abs(affiliation.y - title.y) <= FIT.promote) {
        affiliation.y = title.y;
        affiliation.maxWidth = Math.min(title.maxWidth, affiliation.maxWidth);
      }
    }
    return list.filter((row) => row.value);
  }

  function colour(palette, token) {
    return { accent: palette.accent, ink: palette.ink, background: palette.background }[token] || palette.accent;
  }

  function shapeMarkup(shape, palette, bleed) {
    const [type] = shape;
    if (type === "rect") {
      let [, x, y, w, h, token] = shape;
      if (bleed) { // shapes that touch the trim run out to the bleed edge
        if (x <= 0) { x -= BLEED; w += BLEED; }
        if (y <= 0) { y -= BLEED; h += BLEED; }
        if (x + w >= 700) w += BLEED;
        if (y + h >= 400) h += BLEED;
      }
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${colour(palette, token)}"/>`;
    }
    if (type === "line") {
      const [, x1, y1, x2, y2, token, stroke] = shape;
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${colour(palette, token)}" stroke-width="${stroke}"/>`;
    }
    if (type === "frame") {
      const [, x, y, w, h, token, stroke] = shape;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${colour(palette, token)}" stroke-width="${stroke}"/>`;
    }
    return "";
  }

  function qrMarkup(link) {
    const qr = new window.CardQRCode(-1, 0); // 0 is level M in this encoder
    qr.addData(link);
    qr.make();
    const count = qr.getModuleCount();
    if (count > 73) throw new Error("too dense");
    let path = "";
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) if (qr.isDark(y, x)) path += `M${x + 4} ${y + 4}h1v1h-1z`;
    }
    const size = count + 8; // four blank modules each side, inside the box
    return `<svg x="${QR_BOX.x}" y="${QR_BOX.y}" width="${QR_BOX.size}" height="${QR_BOX.size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
      `<rect width="${size}" height="${size}" fill="#FFFFFF"/><path d="${path}" fill="#000000"/></svg>`;
  }

  // One face of a card. state: { values, layout, palette, fonts, qr (svg or ""), bleed }
  // Returns { svg, warnings, boxes } (boxes: where each line went, for checking)
  function render(state, back) {
    const layout = D.layouts[state.layout];
    const palette = D.palettes[state.palette];
    const fonts = D.fonts[state.fonts];
    const values = cardText(state.values);
    const withQR = back && !!state.qr;
    const face = back ? (withQR ? D.qrTemplates[layout.back.qr] : layout.back) : layout.front;
    const warnings = [];
    const boxes = [];

    let text = "";
    for (const row of rows(face, values, back)) {
      const heading = HEADING_FIELDS.has(row.field);
      const family = heading ? fonts.heading : fonts.body;
      const width = room(row.x, row.anchor, row.maxWidth);
      const fit = heading
        ? fitHeading(row.value, row.field, row.size, width, family, values.name)
        : fitBody(row.value, row.size, width, family);
      if (fit.overflow) warnings.push(row.field);
      fit.lines.forEach((line, i) => {
        const y = row.y - (fit.lines.length - 1 - i) * fit.size * FIT.leading; // the last line keeps the baseline
        const w = measure(line, fit.size, family, heading ? 700 : 400);
        const left = row.anchor === "end" ? row.x - w : row.anchor === "middle" ? row.x - w / 2 : row.x;
        boxes.push({ field: row.field, left, right: left + w, top: y - fit.size * 0.8, bottom: y + fit.size * 0.22, size: fit.size });
        text += `<text x="${row.x}" y="${Math.round(y * 10) / 10}" fill="${palette.ink}" text-anchor="${row.anchor}" ` +
          `font-family="${family}" font-size="${fit.size}" font-weight="${heading ? 700 : 400}">${escapeXml(line)}</text>`;
      });
    }

    const shapes = face.shapes.map((shape) => shapeMarkup(shape, palette, state.bleed)).join("");
    const box = state.bleed ? `${-BLEED} ${-BLEED} ${700 + 2 * BLEED} ${400 + 2 * BLEED}` : "0 0 700 400";
    const inches = state.bleed ? ["3.75in", "2.25in"] : ["3.5in", "2in"];
    const fill = state.bleed
      ? `<rect x="${-BLEED}" y="${-BLEED}" width="${700 + 2 * BLEED}" height="${400 + 2 * BLEED}" fill="${palette.background}"/>`
      : `<rect width="700" height="400" fill="${palette.background}"/>`;
    const label = `${back ? "Back" : "Front"} of business card: ${layout.name}`;
    const svg = `<svg xmlns="${NS}" width="${inches[0]}" height="${inches[1]}" viewBox="${box}" role="img" aria-label="${escapeXml(label)}">` +
      fill + shapes + text + (withQR ? state.qr : "") + "</svg>";
    return { svg, warnings, boxes };
  }

  // Exposed for the layout checks (scripts/checks) and the console
  window.CardStudio = { render, fitHeading, fitBody, measure, FIELDS, SAFE, QR_BOX };

  // ---------------------------------------------------------------- the page

  const app = byId("card-studio");
  if (!app) return;

  const state = {
    values: Object.fromEntries(FIELDS.map(([id, , value]) => [id, value])),
    layout: indexByName(D.layouts, "Horizon"),
    palette: indexByName(D.palettes, "Forest"),
    fonts: indexByName(D.fonts, "Editorial Serif"),
    qr: "",
    bleed: false,
  };

  // Details form
  for (const [id, label] of FIELDS) {
    const row = document.createElement("label");
    row.className = "studio-field";
    row.textContent = label;
    const input = document.createElement("input");
    input.id = `card-${id}`;
    input.value = state.values[id];
    input.maxLength = 120;
    input.autocomplete = "off";
    input.addEventListener("input", () => { state.values[id] = input.value.trim(); update(); });
    row.append(input);
    byId("card-fields").append(row);
  }

  // Design choices
  const fill = (select, list, describe) => list.forEach((item, i) => select.add(new Option(describe(item), i)));
  fill(byId("card-layout"), D.layouts, (l) => l.name);
  fill(byId("card-palette"), D.palettes, (p) => p.name);
  fill(byId("card-fonts"), D.fonts, (f) => f.name);
  for (const [id, key] of [["card-layout", "layout"], ["card-palette", "palette"], ["card-fonts", "fonts"]]) {
    byId(id).addEventListener("change", (event) => { state[key] = Number(event.target.value); update(); });
  }
  byId("card-bleed").addEventListener("change", (event) => { state.bleed = event.target.checked; update(); });

  // Sharing: which fields the link and QR carry
  for (const [id, label] of FIELDS) {
    const row = document.createElement("label");
    row.className = "studio-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = `share-${id}`;
    input.checked = ["name", "credentials", "title", "affiliation"].includes(id);
    input.disabled = id === "name";
    input.addEventListener("change", update);
    row.append(input, ` ${label}`);
    byId("card-share-fields").append(row);
  }
  byId("card-qr").addEventListener("change", update);

  function encodeCard(data) {
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decodeCard(hash) {
    if (!hash.startsWith("#card=") || hash.length > 8000) return null;
    try {
      const raw = atob(hash.slice(6).replace(/-/g, "+").replace(/_/g, "/"));
      const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(raw, (c) => c.charCodeAt(0))));
      if (!Array.isArray(data) || data.length !== 10) return null;
      if (!data.slice(0, 7).every((v) => typeof v === "string" && v.length <= 120) || !data[0].trim()) return null;
      if (![D.layouts, D.palettes, D.fonts].every((list, i) => Number.isInteger(data[7 + i]) && list[data[7 + i]])) return null;
      return data;
    } catch (err) {
      return null;
    }
  }

  function shareLink() {
    const shared = FIELDS.map(([id]) => (byId(`share-${id}`).checked ? state.values[id] : ""));
    if (!shared[0]) return "";
    return new URL("#card=" + encodeCard([...shared, state.layout, state.palette, state.fonts]), location.href).href;
  }

  let lastQR = "";
  function refreshQR(link) {
    const note = byId("card-qr-note");
    const wanted = byId("card-qr").checked ? link : "";
    if (wanted === lastQR) return;
    lastQR = wanted;
    state.qr = "";
    note.textContent = "";
    if (!byId("card-qr").checked) return;
    if (!link) { note.textContent = "Add a name to make a QR code."; return; }
    try {
      state.qr = qrMarkup(link);
      note.textContent = "Scan a printed proof at actual size before ordering.";
    } catch (err) {
      note.textContent = "Too much for a compact QR code: share fewer fields and try again.";
    }
  }

  function prompt() {
    const lines = FIELDS.map(([id, label]) => [label, state.values[id]]).filter(([, v]) => v).map(([l, v]) => `${l}: ${v}`);
    const layout = D.layouts[state.layout];
    return "Help me refine a premium business card (3.5 x 2 in). Use this exact card text and leave out absent fields.\n" +
      lines.join("\n") +
      `\nLayout: ${layout.name} (${layout.description}) Palette: ${D.palettes[state.palette].name}. ` +
      `Typography: ${D.fonts[state.fonts].name}. Keep text at least 7 pt and inside a 0.125 in safe margin. ` +
      "Suggest refinements only; do not invent credentials, logos or contact details.";
  }

  let faces = [];
  function update() {
    const link = shareLink();
    byId("card-link").value = link;
    const open = byId("card-open");
    open.hidden = !link;
    if (link) open.href = link;
    refreshQR(link);

    faces = [false, true].map((back) => render(state, back));
    byId("card-preview").innerHTML = faces.map((face, i) =>
      `<figure class="studio-face"><figcaption>${i ? "Back" : "Front"}</figcaption>${face.svg}</figure>`).join("");

    const layout = D.layouts[state.layout];
    byId("card-layout-note").textContent = `${layout.description} Suits: ${layout.audience.toLowerCase()}.`;

    // A line that cannot fit at 7 pt blocks the download until it is shortened
    const labels = Object.fromEntries([...FIELDS, ["header", "Back heading"]].map(([id, label]) => [id, label]));
    const tooLong = [...new Set(faces.flatMap((face) => face.warnings))];
    const warn = byId("card-warnings");
    warn.hidden = !tooLong.length;
    warn.textContent = tooLong.length
      ? `Too long to print legibly: ${tooLong.map((f) => labels[f] || f).join(", ")}. Shorten it to download. ` +
        "The link and QR code keep the full text."
      : "";
    for (const id of ["card-front", "card-back"]) byId(id).disabled = tooLong.length > 0;
    byId("card-prompt").value = prompt();
  }

  function save(content, type, name) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const slug = () => (state.values.name || "card").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "card";
  byId("card-front").addEventListener("click", () => save(faces[0].svg, "image/svg+xml", `${slug()}-front.svg`));
  byId("card-back").addEventListener("click", () => save(faces[1].svg, "image/svg+xml", `${slug()}-back.svg`));
  byId("card-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(byId("card-prompt").value);
      byId("card-status").textContent = "Prompt copied.";
    } catch (err) {
      byId("card-prompt").closest("details").open = true;
      byId("card-prompt").select();
      byId("card-status").textContent = "Select the prompt and copy it.";
    }
  });

  // Gallery: the made-up examples, each one click from the editor
  const gallery = byId("card-gallery");
  D.examples.forEach((example) => {
    const preset = {
      values: Object.fromEntries(FIELDS.map(([id]) => [id, example[id] || ""])),
      layout: indexByName(D.layouts, example.layout),
      palette: indexByName(D.palettes, example.palette),
      fonts: indexByName(D.fonts, example.fonts),
      qr: "",
      bleed: false,
    };
    const item = document.createElement("li");
    item.className = "studio-example";
    item.innerHTML = render(preset, false).svg;
    const caption = document.createElement("p");
    caption.className = "studio-example-caption";
    caption.textContent = `${example.layout} · ${example.palette} · ${example.fonts}`;
    const use = document.createElement("button");
    use.type = "button";
    use.className = "btn";
    use.textContent = "Use this design";
    use.setAttribute("aria-label", `Use the ${example.layout} design in ${example.palette}`);
    use.addEventListener("click", () => {
      state.layout = preset.layout;
      state.palette = preset.palette;
      state.fonts = preset.fonts;
      byId("card-layout").value = state.layout;
      byId("card-palette").value = state.palette;
      byId("card-fonts").value = state.fonts;
      update();
      byId("card-editor").scrollIntoView({ behavior: "smooth", block: "start" });
      byId("card-status").textContent = `${example.layout} in ${example.palette} applied. Your details are unchanged.`;
    });
    item.append(caption, use);
    gallery.append(item);
  });

  // A shared digital card: show the card and a "Save contact" button only
  function contactFile(data) {
    const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/[,;]/g, (c) => "\\" + c).replace(/[\x00-\x1f\x7f]/g, "");
    const [name, credentials, title, company, email, phone, website] = data;
    const props = [["FN", [name, credentials].filter(Boolean).join(", ")], ["TITLE", title], ["ORG", company],
      ["EMAIL", email], ["TEL", phone], ["URL", website]];
    const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${esc(name)};;;;`, ...props.filter(([, v]) => v).map(([k, v]) => `${k}:${esc(v)}`), "END:VCARD"];
    const encoder = new TextEncoder();
    return lines.map((line) => {
      let out = "";
      let width = 0;
      for (const ch of line) {
        const size = encoder.encode(ch).length;
        if (width + size > 75) { out += "\r\n "; width = 1; }
        out += ch;
        width += size;
      }
      return out;
    }).join("\r\n") + "\r\n";
  }

  const shared = decodeCard(location.hash);
  if (location.hash.startsWith("#card=")) {
    app.classList.add("studio--shared");
    if (!shared) {
      byId("card-shared").hidden = false;
      byId("card-shared-title").textContent = "This card link is incomplete or not valid.";
      return;
    }
    FIELDS.forEach(([id], i) => { state.values[id] = shared[i]; });
    state.layout = shared[7];
    state.palette = shared[8];
    state.fonts = shared[9];
    byId("card-shared").hidden = false;
    byId("card-shared-title").textContent = [shared[0], shared[1]].filter(Boolean).join(", ");
    byId("card-shared-sub").textContent = [shared[2], shared[3]].filter(Boolean).join(" · ");
    byId("card-shared-cards").innerHTML = [false, true].map((back) => render(state, back).svg).join("");
    byId("card-save-contact").addEventListener("click", () => save(contactFile(shared), "text/vcard;charset=utf-8", "contact.vcf"));
    return;
  }

  byId("card-layout").value = state.layout;
  byId("card-palette").value = state.palette;
  byId("card-fonts").value = state.fonts;
  update();
})();
