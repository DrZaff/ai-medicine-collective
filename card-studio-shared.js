/* Shared, admin-managed artwork for Signature Card Studio. */
(() => {
  "use strict";
  const table = "signature_card_templates";
  const jpeg = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
  const publishedId = /^published-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
  const base = { bg: "#F8F3E9", ink: "#222B3A", accent: "#2C4964", "accent-2": "#8DAAB7", soft: "#DFE7EA", "on-accent": "#FFF9EC" };
  const colourways = [
    { name: "Ivory", ...base },
    { name: "Midnight", bg: "#192637", ink: "#FBF6EC", accent: "#263E54", "accent-2": "#8CB4C7", soft: "#26384A", "on-accent": "#FFFFFF" }
  ];
  const copy = { fullname: "Alexandria Montgomery, MD, PhD", title: "Internal Medicine Physician",
    affiliation: "Riverside Health Partners", header: "Riverside Health Partners", email: "a.montgomery@example.com",
    phone: "(202) 555-0142", website: "example.com/montgomery" };

  async function read(query) {
    const response = await fetch(PUBLIC_API_URL + "/" + table + "?" + query, {
      headers: { apikey: PUBLIC_API_KEY }, cache: "no-store", signal: AbortSignal.timeout(4500)
    });
    if (!response.ok) throw new Error("Shared templates could not be loaded.");
    return response.json();
  }

  async function list() {
    return read("select=id,name,thumbnail&order=created_at.desc,id.desc");
  }

  async function get(id) {
    const match = publishedId.exec(id);
    if (!match) return null;
    const rows = await read("select=id,name,front_art,back_art,thumbnail&id=eq." + match[1]);
    return rows[0] || null;
  }

  function template(row) {
    const frontArt = row.front_art || row.thumbnail;
    if (!publishedId.test("published-" + row.id) || typeof row.name !== "string" ||
        !jpeg.test(frontArt) || (row.back_art && !jpeg.test(row.back_art))) return null;
    const image = (data) => data ? '<image x="415" y="-25" width="310" height="450" preserveAspectRatio="xMidYMid slice" href="' + data + '"/>' : "";
    const field = (key, y, width, size, heading = false, lines = 1) =>
      '<text data-field="' + key + '" data-max-width="' + width + '" data-min-size="' + (heading ? 25 : 21) +
      '" data-lines="' + lines + '" x="44" y="' + y + '" text-anchor="start" font-family="' +
      (heading ? "Archivo" : "Inter") + '" font-size="' + size + '" font-weight="' +
      (heading ? 800 : 500) + '" letter-spacing="0" fill="var(--ink)">' + copy[key] + '</text>';
    const svg = (body) => '<svg xmlns="http://www.w3.org/2000/svg" width="3.75in" height="2.25in" viewBox="-25 -25 750 450">' +
      '<rect x="-25" y="-25" width="750" height="450" fill="var(--bg)"/>' +
      '<rect x="415" y="-25" width="310" height="450" fill="var(--soft)"/>' + body + '</svg>';
    const back = (qr) => svg(image(row.back_art) +
      '<path d="M44 149H395" stroke="var(--accent-2)" stroke-width="2"/>' +
      (qr ? '<rect x="424" y="82" width="244" height="244" rx="6" fill="var(--accent)"/>' +
        '<rect data-slot="qr" x="440" y="98" width="212" height="212" fill="var(--on-accent)"/>' : "") +
      field("header", 120, 350, 32, true, 2) + field("email", 198, 350, 23) +
      field("phone", 245, 350, 23) + field("website", 292, 350, 23));
    return { id: "published-" + row.id, name: row.name, style: "Published artwork",
      description: "Uploaded artwork with editable card details.",
      suits: "professional networking", fonts: [["Archivo",800,"normal"],["Inter",500,"normal"]],
      colourways, pending: !row.front_art, moveWhenEmpty: { title: { affiliation: 267 } },
      front: svg(image(frontArt) + '<path d="M44 91H139" stroke="var(--accent-2)" stroke-width="2"/>' +
        field("fullname", 200, 350, 47, true, 2) + field("title", 267, 350, 23) + field("affiliation", 305, 350, 22)),
      back: back(false), backQr: back(true) };
  }

  async function encode(file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 12 * 1024 * 1024) {
      throw new Error("Choose a PNG, JPEG, or WebP image under 12 MB.");
    }
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement("canvas");
      const write = (max, quality) => {
        const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas.getContext("2d", { alpha: false });
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", quality);
      };
      const initial = write(1600, .88);
      const artwork = initial.length <= 650000 ? initial : write(1280, .74);
      const thumbnail = write(240, .66);
      if (!jpeg.test(artwork) || artwork.length > 650000 || !jpeg.test(thumbnail) || thumbnail.length > 48000) {
        throw new Error("This image is too complex to publish. Try a smaller image.");
      }
      return { artwork, thumbnail };
    } finally { bitmap.close(); }
  }

  async function admin() {
    if (!window.supabase) return null;
    let existing;
    try { existing = localStorage.getItem(AUTH_STORAGE_KEY); } catch (err) { return null; }
    if (!existing) return null;
    const client = window.supabase.createClient(PUBLIC_API_URL.replace(/\/rest\/v1$/, ""), PUBLIC_API_KEY, {
      auth: { storageKey: AUTH_STORAGE_KEY, flowType: "pkce", detectSessionInUrl: false }
    });
    const result = await client.rpc("is_admin");
    return !result.error && result.data === true ? client : null;
  }

  async function publish(client, name, front, back) {
    const [f,b] = await Promise.all([encode(front), back ? encode(back) : null]);
    const result = await client.from(table).insert({
      name, front_art: f.artwork, back_art: b?.artwork || null, thumbnail: f.thumbnail
    }).select("id,name,front_art,back_art,thumbnail").single();
    if (result.error) throw new Error("The template could not be published. Check your admin access and the shared library setup.");
    return result.data;
  }

  async function remove(client, id) {
    const result = await client.from(table).delete().eq("id", id).select("id");
    if (result.error || result.data?.length !== 1) throw new Error("The template could not be deleted. It may have already been removed.");
  }

  window.CardStudioShared = { list, get, template, admin, publish, remove, publishedId };
})();
