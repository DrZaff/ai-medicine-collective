/* Signature Card Studio (signature-card-studio.html).
   Two kinds of design, chosen from one menu:
   - designed templates (card-studio-templates.js): complete SVGs by ChatGPT
     with text placeholders, three colourways each and their own fonts, which
     are hosted in fonts/cards/ and embedded in the downloaded files;
   - simple layouts (card-studio-designs.js): 24 layouts drawn from
     coordinates, with 12 palettes and 6 pairings of system fonts.
   Every line is fitted to its space in the font the browser has loaded
   (fitHeading, fitBody, fitPlaceholder). A line that cannot fit at its
   smallest allowed size is flagged and blocks the download until shortened.
   Also runs the gallery, the shared digital card (#card=...) and the
   downloads. Nothing typed here leaves the page: there is no server.
   Wrapped in a function so its names never meet script.js's. */

(function () {
  "use strict";

  const D = window.CARD_DESIGNS;
  const T = window.CARD_TEMPLATES || [];
  const FONT_FILES = window.CARD_FONT_FILES || {};
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
    // Templates: a two-line field stays on one line down to this share of
    // its size, and wraps at no more than this share
    oneLineShare: 0.78,
    twoLineShare: 0.8,
  };

  // Templates first, then the simple layouts: one list, one menu
  const DESIGNS = [
    ...T.map((t, i) => ({ kind: "template", index: i, name: t.name, group: "Designed templates" })),
    ...D.layouts.map((l, i) => ({ kind: "layout", index: i, name: l.name, group: "Simple layouts" })),
  ];

  const byId = (id) => document.getElementById(id);
  const indexByName = (list, name) => Math.max(0, list.findIndex((item) => item.name === name));
  const designIndex = (kind, name) => Math.max(0, DESIGNS.findIndex((d) => d.kind === kind && d.name === name));
  const escapeXml = (value) => String(value).replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));

  // ---------------------------------------------------------------- measuring

  const context = document.createElement("canvas").getContext("2d");

  // The width of the glyphs actually drawn, in the font the browser resolves
  function measure(text, size, family, weight, style = "normal", spacing = 0) {
    context.font = `${style === "italic" ? "italic " : ""}${weight} ${size}px ${family}`;
    const m = context.measureText(text);
    const ink = (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || 0);
    return Math.max(m.width, ink) + spacing * Math.max(0, Array.from(text).length - 1);
  }

  // How wide a line may be: its own limit, and never past the safe area
  function room(x, anchor, maxWidth) {
    if (anchor === "end") return Math.min(maxWidth, x - SAFE.left);
    if (anchor === "middle") return Math.min(maxWidth, 2 * Math.min(x - SAFE.left, SAFE.right - x));
    return Math.min(maxWidth, SAFE.right - x);
  }

  // The largest size (to a tenth of a unit, at most `cap`) at which every line fits
  function largestSize(lines, cap, width, font) {
    const w = (line, size) => measure(line, size, font.family, font.weight, font.style, font.spacing);
    const atHundred = Math.max(...lines.map((line) => w(line, 100))) / 100;
    if (!atHundred) return cap;
    let size = Math.min(cap, Math.floor((width / atHundred) * 10) / 10);
    while (size > 1 && Math.max(...lines.map((line) => w(line, size))) > width) size -= 0.5;
    return size;
  }

  function graphemes(text) {
    if (window.Intl && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);
    }
    return Array.from(text);
  }

  // Ways to break a line in two: before the credentials first, then at
  // spaces and hyphens
  function breaks(text, mainName) {
    const options = [];
    if (mainName && text.startsWith(mainName + ", ")) {
      options.push({ lines: [mainName + ",", text.slice(mainName.length + 2)], credentials: true });
    }
    for (let i = 1; i < text.length - 1; i++) {
      if (text[i] === " ") options.push({ lines: [text.slice(0, i), text.slice(i + 1)] });
      else if (text[i] === "-") options.push({ lines: [text.slice(0, i + 1), text.slice(i + 1)] });
    }
    return options;
  }

  // Fit on two lines, at most `cap`: the best break, or between characters
  // for one long word; never below `floor`
  function twoLines(text, cap, floor, width, font, mainName) {
    const options = breaks(text, mainName);
    options.forEach((option) => { option.size = largestSize(option.lines, cap, width, font); });
    let best = options.reduce((a, b) => (b.size > (a ? a.size : -1) ? b : a), null);
    const credentials = options.find((option) => option.credentials);
    if (credentials && best && credentials.size >= best.size * 0.95) best = credentials;
    if (!best || best.size < floor) {
      const parts = graphemes(text);
      for (let i = 1; i < parts.length; i++) {
        const lines = [parts.slice(0, i).join(""), parts.slice(i).join("")];
        const fitted = largestSize(lines, cap, width, font);
        if (!best || fitted > best.size) best = { lines, size: fitted };
      }
    }
    if (best && best.size >= floor) return { lines: best.lines, size: best.size };
    return { lines: best ? best.lines : [text], size: floor, overflow: true };
  }

  // Simple layouts: a name or header
  function fitHeading(text, kind, size, width, family, mainName) {
    const rules = FIT[kind];
    const font = { family, weight: 700 };
    const one = largestSize([text], size, width, font);
    if (one >= rules.oneLineFloor) return { lines: [text], size: one };
    return twoLines(text, Math.min(size, rules.twoLineCap), FIT.floor, width, font, mainName);
  }

  // Simple layouts: everything else, one line, down to 20 units
  function fitBody(text, size, width, family) {
    const fitted = largestSize([text], size, width, { family, weight: 400 });
    if (fitted >= FIT.floor) return { lines: [text], size: fitted };
    return { lines: [text], size: FIT.floor, overflow: true };
  }

  // Templates: one placeholder, by its data-max-width, data-min-size, data-lines
  function fitPlaceholder(text, opts, width, font, mainName) {
    const floor = Math.max(FIT.floor, opts.minSize);
    const one = largestSize([text], opts.size, width, font);
    if (opts.lines < 2) {
      return one >= floor ? { lines: [text], size: one } : { lines: [text], size: floor, overflow: true };
    }
    if (one >= Math.max(floor, opts.size * FIT.oneLineShare)) return { lines: [text], size: one };
    const wrapped = twoLines(text, opts.size * FIT.twoLineShare, floor, width, font, mainName);
    // Prefer one line when it is at least as large as the wrapped version
    if (one >= floor && one >= wrapped.size) return { lines: [text], size: one };
    return wrapped;
  }

  // ---------------------------------------------------------------- shared pieces

  function initials(name) {
    const words = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "";
    const first = graphemes(words[0])[0] || "";
    const last = words.length > 1 ? graphemes(words[words.length - 1])[0] || "" : "";
    return (first + last).toUpperCase();
  }

  function cardText(values) {
    const fullName = [values.name, values.credentials].filter(Boolean).join(", ");
    return { ...values, fullname: fullName, fullName, header: values.affiliation || fullName, initials: initials(values.name) };
  }

  // QR modules for a link (throws when the code would be too dense)
  function qrModules(link) {
    const qr = new window.CardQRCode(-1, 0); // 0 is level M in this encoder
    qr.addData(link);
    qr.make();
    const count = qr.getModuleCount();
    if (count > 73) throw new Error("too dense");
    let path = "";
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) if (qr.isDark(y, x)) path += `M${x + 4} ${y + 4}h1v1h-1z`;
    }
    return { path, size: count + 8 }; // four blank modules each side, inside the box
  }

  function qrSvg(qr, x, y, size) {
    return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 ${qr.size} ${qr.size}" shape-rendering="crispEdges">` +
      `<rect width="${qr.size}" height="${qr.size}" fill="#FFFFFF"/><path d="${qr.path}" fill="#000000"/></svg>`;
  }

  // ---------------------------------------------------------------- simple layouts

  function rows(face, values, back) {
    const list = face.text
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

  function renderLayout(state, back) {
    const layout = D.layouts[DESIGNS[state.design].index];
    const palette = D.palettes[state.palette] || D.palettes[0];
    const fonts = D.fonts[state.fonts] || D.fonts[0];
    const values = cardText(state.values);
    const withQR = back && !!state.qr;
    const face = back ? (withQR ? D.qrTemplates[layout.back.qr] : layout.back) : layout.front;
    const warnings = [];

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
    const qr = withQR ? qrSvg(state.qr, QR_BOX.x, QR_BOX.y, QR_BOX.size) : "";
    const label = `${back ? "Back" : "Front"} of business card: ${layout.name}`;
    const svg = `<svg xmlns="${NS}" width="${inches[0]}" height="${inches[1]}" viewBox="${box}" role="img" aria-label="${escapeXml(label)}">` +
      fill + shapes + text + qr + "</svg>";
    return { svg, warnings, fonts: [] };
  }

  // ---------------------------------------------------------------- templates

  const COLOUR_ATTRS = ["fill", "stroke", "stop-color", "flood-color", "color"];

  function renderTemplate(state, back) {
    const tpl = T[DESIGNS[state.design].index];
    const colours = tpl.colourways[state.palette] || tpl.colourways[0];
    const values = cardText(state.values);
    const withQR = back && !!state.qr;
    const source = back ? (withQR ? tpl.backQr : tpl.back) : tpl.front;
    const doc = new DOMParser().parseFromString(source, "image/svg+xml");
    const svg = doc.documentElement;
    const warnings = [];

    // Colour tokens become plain colours, so any program reads the file
    for (const el of svg.querySelectorAll("*")) {
      for (const attr of COLOUR_ATTRS) {
        const v = el.getAttribute(attr);
        if (v && v.includes("var(")) el.setAttribute(attr, v.replace(/var\(--([a-z0-9-]+)\)/g, (m, token) => colours[token] || m));
      }
    }

    // Empty fields: their text and any shape that belongs with them go;
    // lines the template names move up
    const present = (field) => !!values[field];
    for (const el of [...svg.querySelectorAll("[data-with]")]) {
      if (!present(el.getAttribute("data-with"))) el.remove();
    }
    for (const el of [...svg.querySelectorAll("text[data-field]")]) {
      if (!present(el.getAttribute("data-field"))) el.remove();
    }
    for (const [emptyField, moves] of Object.entries(tpl.moveWhenEmpty || {})) {
      if (present(emptyField)) continue;
      for (const [field, y] of Object.entries(moves)) {
        const el = svg.querySelector(`text[data-field="${field}"]`);
        if (el) el.setAttribute("y", y);
      }
    }

    // Fill and fit every placeholder
    for (const el of [...svg.querySelectorAll("text[data-field]")]) {
      const field = el.getAttribute("data-field");
      const value = values[field];
      const x = Number(el.getAttribute("x"));
      const y = Number(el.getAttribute("y"));
      const anchor = el.getAttribute("text-anchor") || "start";
      const font = {
        family: el.getAttribute("font-family"),
        weight: Number(el.getAttribute("font-weight") || 400),
        style: el.getAttribute("font-style") || "normal",
        spacing: Number(el.getAttribute("letter-spacing") || 0),
      };
      const opts = {
        size: Number(el.getAttribute("font-size")),
        minSize: Number(el.getAttribute("data-min-size") || FIT.floor),
        lines: Number(el.getAttribute("data-lines") || 1),
      };
      const width = room(x, anchor, Number(el.getAttribute("data-max-width") || 600));
      const mainName = field === "fullname" || field === "header" ? values.name : "";
      const fit = fitPlaceholder(value, opts, width, font, mainName);
      if (fit.overflow) warnings.push(field);
      el.setAttribute("font-size", Math.round(fit.size * 10) / 10);
      el.textContent = fit.lines[fit.lines.length - 1];
      if (fit.lines.length > 1) { // the first line goes above; y stays the last baseline
        const first = el.cloneNode(false);
        first.setAttribute("y", Math.round((y - fit.size * FIT.leading) * 10) / 10);
        first.textContent = fit.lines[0];
        el.parentNode.insertBefore(first, el);
      }
    }

    // The QR code goes in the template's slot, black on white
    const slot = svg.querySelector("[data-slot='qr']");
    if (slot) {
      if (withQR) {
        const size = Math.min(Number(slot.getAttribute("width")), Number(slot.getAttribute("height")));
        const holder = new DOMParser().parseFromString(
          `<svg xmlns="${NS}">${qrSvg(state.qr, slot.getAttribute("x"), slot.getAttribute("y"), size)}</svg>`, "image/svg+xml");
        slot.replaceWith(doc.importNode(holder.documentElement.firstElementChild, true));
      } else {
        slot.remove();
      }
    }

    // Drop the authoring attributes, then size the file
    for (const el of svg.querySelectorAll("[data-field],[data-max-width],[data-min-size],[data-lines],[data-with]")) {
      for (const a of ["data-field", "data-max-width", "data-min-size", "data-lines", "data-with"]) el.removeAttribute(a);
    }
    svg.removeAttribute("style");
    if (state.bleed) {
      svg.setAttribute("viewBox", "-25 -25 750 450");
      svg.setAttribute("width", "3.75in");
      svg.setAttribute("height", "2.25in");
    } else {
      svg.setAttribute("viewBox", "0 0 700 400");
      svg.setAttribute("width", "3.5in");
      svg.setAttribute("height", "2in");
    }
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${back ? "Back" : "Front"} of business card: ${tpl.name}, ${colours.name}`);
    return { svg: new XMLSerializer().serializeToString(svg), warnings, fonts: tpl.fonts };
  }

  // One face of a card. state: { values, design, palette, fonts, qr, bleed }
  function render(state, back) {
    return DESIGNS[state.design].kind === "template" ? renderTemplate(state, back) : renderLayout(state, back);
  }

  // ---------------------------------------------------------------- fonts

  const fontKey = ([family, weight, style]) => `${family}|${weight}|${style}`;

  // Load every card face, so measuring and the preview use the real fonts
  function loadCardFonts() {
    if (!window.FontFace || !document.fonts) return Promise.resolve();
    return Promise.all(Object.entries(FONT_FILES).map(([key, url]) => {
      const [family, weight, style] = key.split("|");
      const face = new FontFace(family, `url("${url}")`, { weight, style });
      document.fonts.add(face);
      return face.load().catch(() => null);
    }));
  }

  // The downloaded file carries its fonts, so it prints as designed
  const embedded = {};
  async function fontData(url) {
    if (!embedded[url]) {
      embedded[url] = fetch(url).then((r) => r.arrayBuffer()).then((buffer) => {
        let binary = "";
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(binary);
      });
    }
    return embedded[url];
  }

  async function withFonts(svgText, fonts) {
    if (!fonts.length) return svgText;
    const rules = [];
    for (const font of fonts) {
      const url = FONT_FILES[fontKey(font)];
      if (!url) continue;
      const data = await fontData(url);
      rules.push(`@font-face{font-family:"${font[0]}";font-weight:${font[1]};font-style:${font[2]};` +
        `src:url(data:font/woff2;base64,${data}) format("woff2")}`);
    }
    return svgText.replace(/^(<svg[^>]*>)/, `$1<style>${rules.join("")}</style>`);
  }

  // Exposed for the layout checks and the console
  window.CardStudio = { render, withFonts, loadCardFonts, DESIGNS, fitHeading, fitBody, fitPlaceholder, measure, FIELDS, SAFE, QR_BOX, qrModules };

  // ---------------------------------------------------------------- the page

  const app = byId("card-studio");
  if (!app) return;

  const state = {
    values: Object.fromEntries(FIELDS.map(([id, , value]) => [id, value])),
    design: T.length ? 0 : designIndex("layout", "Horizon"),
    palette: 0,
    fonts: indexByName(D.fonts, "Editorial Serif"),
    qr: null,
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

  // Design menu, grouped; palette and type menus follow the design
  const designSelect = byId("card-layout");
  for (const group of [...new Set(DESIGNS.map((d) => d.group))]) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group;
    DESIGNS.forEach((d, i) => { if (d.group === group) optgroup.append(new Option(d.name, i)); });
    designSelect.append(optgroup);
  }
  D.fonts.forEach((f, i) => byId("card-fonts").add(new Option(f.name, i)));

  function fillPalettes() {
    const select = byId("card-palette");
    const d = DESIGNS[state.design];
    const list = d.kind === "template" ? T[d.index].colourways : D.palettes;
    select.replaceChildren(...list.map((p, i) => new Option(p.name, i)));
    if (state.palette >= list.length) state.palette = 0;
    select.value = state.palette;
    byId("card-fonts").closest("label").hidden = d.kind === "template";
    byId("card-palette").closest("label").firstChild.textContent = d.kind === "template" ? "Colourway " : "Palette ";
  }

  designSelect.addEventListener("change", (event) => { state.design = Number(event.target.value); state.palette = 0; fillPalettes(); update(); });
  byId("card-palette").addEventListener("change", (event) => { state.palette = Number(event.target.value); update(); });
  byId("card-fonts").addEventListener("change", (event) => { state.fonts = Number(event.target.value); update(); });
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

  // A shared card: [7 fields, design index, palette or colourway, type]
  function decodeCard(hash) {
    if (!hash.startsWith("#card=") || hash.length > 8000) return null;
    try {
      const raw = atob(hash.slice(6).replace(/-/g, "+").replace(/_/g, "/"));
      const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(raw, (c) => c.charCodeAt(0))));
      if (!Array.isArray(data) || data.length !== 10) return null;
      if (!data.slice(0, 7).every((v) => typeof v === "string" && v.length <= 120) || !data[0].trim()) return null;
      const d = DESIGNS[data[7]];
      if (!Number.isInteger(data[7]) || !d) return null;
      const palettes = d.kind === "template" ? T[d.index].colourways : D.palettes;
      if (!Number.isInteger(data[8]) || !palettes[data[8]] || !Number.isInteger(data[9]) || !D.fonts[data[9]]) return null;
      return data;
    } catch (err) {
      return null;
    }
  }

  function shareLink() {
    const shared = FIELDS.map(([id]) => (byId(`share-${id}`).checked ? state.values[id] : ""));
    if (!shared[0]) return "";
    return new URL("#card=" + encodeCard([...shared, state.design, state.palette, state.fonts]), location.href).href;
  }

  let lastQR = null;
  function refreshQR(link) {
    const note = byId("card-qr-note");
    const wanted = byId("card-qr").checked ? link : "";
    if (wanted === lastQR) return;
    lastQR = wanted;
    state.qr = null;
    note.textContent = "";
    if (!byId("card-qr").checked) return;
    if (!link) { note.textContent = "Add a name to make a QR code."; return; }
    try {
      state.qr = qrModules(link);
      note.textContent = "Scan a printed proof at actual size before ordering.";
    } catch (err) {
      note.textContent = "Too much for a compact QR code: share fewer fields and try again.";
    }
  }

  function describe() {
    const d = DESIGNS[state.design];
    if (d.kind === "template") {
      const t = T[d.index];
      return { name: t.name, text: `${t.style}. ${t.description} Suits: ${t.suits.toLowerCase()}.`, palette: t.colourways[state.palette].name, type: "its own typefaces" };
    }
    const l = D.layouts[d.index];
    return { name: l.name, text: `${l.description} Suits: ${l.audience.toLowerCase()}.`, palette: D.palettes[state.palette].name, type: D.fonts[state.fonts].name };
  }

  function prompt() {
    const lines = FIELDS.map(([id, label]) => [label, state.values[id]]).filter(([, v]) => v).map(([l, v]) => `${l}: ${v}`);
    const d = describe();
    return "Help me refine a premium business card (3.5 x 2 in). Use this exact card text and leave out absent fields.\n" +
      lines.join("\n") +
      `\nDesign: ${d.name} (${d.text}) Colours: ${d.palette}. Type: ${d.type}. ` +
      "Keep text at least 7 pt and inside a 0.125 in safe margin. " +
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
    byId("card-layout-note").textContent = describe().text;

    // A line that cannot fit at its smallest size blocks the download
    const labels = Object.fromEntries([...FIELDS, ["header", "Back heading"], ["fullname", "Name"], ["initials", "Initials"]].map(([id, label]) => [id, label]));
    const tooLong = [...new Set(faces.flatMap((face) => face.warnings))];
    const warn = byId("card-warnings");
    warn.hidden = !tooLong.length;
    warn.textContent = tooLong.length
      ? `Too long to print legibly: ${[...new Set(tooLong.map((f) => labels[f] || f))].join(", ")}. Shorten it to download. ` +
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
  async function download(i) {
    const face = faces[i];
    try {
      save(await withFonts(face.svg, face.fonts), "image/svg+xml", `${slug()}-${i ? "back" : "front"}.svg`);
    } catch (err) {
      byId("card-status").textContent = "The fonts could not be added to the file. Try again.";
    }
  }
  byId("card-front").addEventListener("click", () => download(0));
  byId("card-back").addEventListener("click", () => download(1));
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

  function choose(design, palette, fonts, label) {
    state.design = design;
    state.palette = palette;
    if (fonts !== undefined) state.fonts = fonts;
    designSelect.value = state.design;
    byId("card-fonts").value = state.fonts;
    fillPalettes();
    update();
    byId("card-editor").scrollIntoView({ behavior: "smooth", block: "start" });
    byId("card-status").textContent = `${label} applied. Your details are unchanged.`;
  }

  function galleryItem(list, previewState, caption, label, onUse) {
    const item = document.createElement("li");
    item.className = "studio-example";
    item.innerHTML = render(previewState, false).svg;
    const p = document.createElement("p");
    p.className = "studio-example-caption";
    p.textContent = caption;
    const use = document.createElement("button");
    use.type = "button";
    use.className = "btn";
    use.textContent = "Use this design";
    use.setAttribute("aria-label", `Use ${label}`);
    use.addEventListener("click", onUse);
    item.append(p, use);
    list.append(item);
  }

  // Gallery: every template (first in its first colourway) with ChatGPT's
  // made-up sample person, then the simple-layout examples
  const SAMPLE = { name: "Alexandria Montgomery", credentials: "MD, PhD", title: "Internal Medicine Physician",
    affiliation: "Riverside Health Partners", email: "a.montgomery@example.com", phone: "(202) 555-0142", website: "example.com/montgomery" };
  function buildGallery() {
    const templates = byId("card-templates");
    T.forEach((t, i) => {
      t.colourways.forEach((c, ci) => {
        galleryItem(templates, { values: SAMPLE, design: i, palette: ci, fonts: 0, qr: null, bleed: false },
          `${t.name} · ${c.name} · ${t.style}`, `${t.name} in ${c.name}`,
          () => choose(i, ci, undefined, `${t.name} in ${c.name}`));
      });
    });
    const gallery = byId("card-gallery");
    D.examples.forEach((example) => {
      const preset = {
        values: Object.fromEntries(FIELDS.map(([id]) => [id, example[id] || ""])),
        design: designIndex("layout", example.layout),
        palette: indexByName(D.palettes, example.palette),
        fonts: indexByName(D.fonts, example.fonts),
        qr: null,
        bleed: false,
      };
      galleryItem(gallery, preset, `${example.layout} · ${example.palette} · ${example.fonts}`,
        `the ${example.layout} layout in ${example.palette}`,
        () => choose(preset.design, preset.palette, preset.fonts, `${example.layout} in ${example.palette}`));
    });
  }

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

  function start() {
    const shared = decodeCard(location.hash);
    if (location.hash.startsWith("#card=")) {
      app.classList.add("studio--shared");
      byId("card-shared").hidden = false;
      if (!shared) {
        byId("card-shared-title").textContent = "This card link is incomplete or not valid.";
        return;
      }
      FIELDS.forEach(([id], i) => { state.values[id] = shared[i]; });
      state.design = shared[7];
      state.palette = shared[8];
      state.fonts = shared[9];
      byId("card-shared-title").textContent = [shared[0], shared[1]].filter(Boolean).join(", ");
      byId("card-shared-sub").textContent = [shared[2], shared[3]].filter(Boolean).join(" · ");
      byId("card-shared-cards").innerHTML = [false, true].map((back) => render(state, back).svg).join("");
      byId("card-save-contact").addEventListener("click", () => save(contactFile(shared), "text/vcard;charset=utf-8", "contact.vcf"));
      return;
    }
    designSelect.value = state.design;
    byId("card-fonts").value = state.fonts;
    fillPalettes();
    update();
    buildGallery();
    app.classList.add("studio--ready");
  }

  // Measure only once the card fonts have loaded (or failed to)
  loadCardFonts().then(start, start);
})();
