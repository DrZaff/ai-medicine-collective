/* Signature Card Studio: the design library.
   Designed with ChatGPT (2026-11-06) to a brief from the Collective; drawn by
   card-studio.js. Every card is a 700 x 400 SVG grid (3.5 x 2 in, 200 units
   per inch); safe bounds are 25 units inside the trim.

   Text tuples: [field, x, baselineY, textAnchor, fontSize, maxWidth]
   Shapes: ["rect", x, y, width, height, colour]
           ["line", x1, y1, x2, y2, colour, strokeWidth]
           ["frame", x, y, width, height, colour, strokeWidth]  (unfilled rectangle)
   Colours are palette tokens: "accent", "ink" or "background".
   The examples are made-up people with example.com addresses and 555 numbers. */

window.CARD_DESIGNS = {
  qrTemplates: {
    "Left Stack": {
      text: [["header", 40, 127, "start", 31, 380], ["email", 40, 190, "start", 23, 380], ["phone", 40, 229, "start", 23, 380], ["website", 40, 268, "start", 23, 380]],
      shapes: [["line", 40, 151, 420, 151, "accent", 2]]
    },
    "Centered Column": {
      text: [["header", 230, 130, "middle", 31, 380], ["email", 230, 186, "middle", 23, 380], ["phone", 230, 225, "middle", 23, 380], ["website", 230, 264, "middle", 23, 380]],
      shapes: [["line", 192, 291, 268, 291, "accent", 3]]
    },
    "Right Stack": {
      text: [["header", 410, 134, "end", 31, 370], ["email", 410, 190, "end", 23, 370], ["phone", 410, 229, "end", 23, 370], ["website", 410, 268, "end", 23, 370]],
      shapes: [["line", 426, 100, 426, 315, "accent", 2]]
    },
    "Lower Signature": {
      text: [["header", 40, 309, "start", 31, 380], ["email", 40, 130, "start", 23, 380], ["phone", 40, 169, "start", 23, 380], ["website", 40, 208, "start", 23, 380]],
      shapes: [["line", 40, 238, 420, 238, "accent", 2]]
    }
  },

  layouts: [
    { name: "Classic Stack", description: "A generous left-aligned name with two closely spaced supporting lines.", audience: "Conservative hospital and private practice",
      front: { text: [["name", 48, 170, "start", 52, 604], ["title", 48, 219, "start", 26, 604], ["affiliation", 48, 253, "start", 23, 604]], shapes: [] },
      back: { text: [["header", 48, 114, "start", 33, 604], ["email", 48, 181, "start", 25, 604], ["phone", 48, 222, "start", 25, 604], ["website", 48, 263, "start", 25, 604]], shapes: [], qr: "Left Stack" } },
    { name: "Centered Register", description: "All three lines share a center axis and form a compact, symmetrical group.", audience: "Academic medicine and specialist practice",
      front: { text: [["name", 350, 167, "middle", 49, 604], ["title", 350, 215, "middle", 26, 604], ["affiliation", 350, 248, "middle", 23, 604]], shapes: [] },
      back: { text: [["header", 350, 111, "middle", 33, 604], ["email", 350, 179, "middle", 24, 604], ["phone", 350, 220, "middle", 24, 604], ["website", 350, 261, "middle", 24, 604]], shapes: [["line", 312, 294, 388, 294, "accent", 3]], qr: "Centered Column" } },
    { name: "Right Margin", description: "An upper-right name and role sit above an affiliation anchored at the lower right.", audience: "Specialists and editorially minded clinicians",
      front: { text: [["name", 650, 128, "end", 50, 600], ["title", 650, 174, "end", 26, 600], ["affiliation", 650, 333, "end", 23, 600]], shapes: [["line", 572, 288, 650, 288, "accent", 3]] },
      back: { text: [["header", 650, 112, "end", 32, 600], ["email", 650, 182, "end", 24, 600], ["phone", 650, 222, "end", 24, 600], ["website", 650, 262, "end", 24, 600]], shapes: [], qr: "Right Stack" } },
    { name: "Baseline", description: "A low-set name and two supporting lines leave the upper half open.", audience: "Consultants and independent practice",
      front: { text: [["name", 48, 252, "start", 52, 604], ["title", 48, 300, "start", 25, 604], ["affiliation", 48, 333, "start", 23, 604]], shapes: [["line", 48, 357, 652, 357, "accent", 2]] },
      back: { text: [["header", 48, 330, "start", 34, 604], ["email", 48, 109, "start", 24, 604], ["phone", 48, 150, "start", 24, 604], ["website", 48, 191, "start", 24, 604]], shapes: [["line", 48, 248, 652, 248, "accent", 2]], qr: "Lower Signature" } },
    { name: "Affiliation First", description: "The affiliation gets a top line of its own, with the name and role grouped lower down.", audience: "Program directors and academic faculty",
      front: { text: [["name", 48, 250, "start", 49, 604], ["title", 48, 300, "start", 26, 604], ["affiliation", 48, 81, "start", 25, 604]], shapes: [["line", 48, 110, 652, 110, "accent", 2]] },
      back: { text: [["header", 48, 111, "start", 34, 604], ["email", 48, 185, "start", 24, 604], ["phone", 48, 231, "start", 24, 604], ["website", 48, 277, "start", 24, 604]], shapes: [["line", 48, 135, 652, 135, "accent", 2]], qr: "Left Stack" } },
    { name: "Role First", description: "The job title opens the card, followed by the name and a low affiliation line.", audience: "Emergency medicine and multidisciplinary teams",
      front: { text: [["name", 50, 220, "start", 50, 600], ["title", 50, 83, "start", 29, 600], ["affiliation", 50, 321, "start", 23, 600]], shapes: [["line", 50, 111, 130, 111, "accent", 4]] },
      back: { text: [["header", 50, 116, "start", 33, 600], ["email", 50, 175, "start", 25, 600], ["phone", 50, 228, "start", 24, 600], ["website", 50, 281, "start", 24, 600]], shapes: [], qr: "Left Stack" } },
    { name: "Two Columns", description: "A wide name column faces a narrower role and affiliation column across a vertical rule.", audience: "Research and clinical consulting",
      front: { text: [["name", 40, 202, "start", 44, 340], ["title", 419, 177, "start", 24, 241], ["affiliation", 419, 212, "start", 23, 241]], shapes: [["line", 399, 106, 399, 284, "accent", 2]] },
      back: { text: [["header", 40, 136, "start", 31, 340], ["email", 419, 172, "start", 23, 241], ["phone", 419, 212, "start", 23, 241], ["website", 419, 252, "start", 23, 241]], shapes: [["line", 399, 76, 399, 294, "accent", 2]], qr: "Left Stack" } },
    { name: "Facing Columns", description: "Right-aligned role and affiliation occupy the left column, while the name aligns to the far edge of the right column.", audience: "Interdisciplinary care and creative practices",
      front: { text: [["name", 654, 213, "end", 45, 340], ["title", 278, 172, "end", 25, 234], ["affiliation", 278, 209, "end", 23, 234]], shapes: [["line", 296, 146, 296, 253, "accent", 3]] },
      back: { text: [["header", 654, 138, "end", 32, 340], ["email", 278, 168, "end", 23, 234], ["phone", 278, 210, "end", 23, 234], ["website", 278, 252, "end", 23, 234]], shapes: [["line", 296, 93, 296, 274, "accent", 3]], qr: "Right Stack" } },
    { name: "Diagonal Reading", description: "The name begins at the upper left and the supporting stack finishes at the lower right.", audience: "Emergency physicians and design-forward clinicians",
      front: { text: [["name", 46, 135, "start", 51, 608], ["title", 654, 267, "end", 26, 440], ["affiliation", 654, 301, "end", 23, 440]], shapes: [["line", 46, 161, 128, 161, "accent", 4], ["line", 572, 328, 654, 328, "accent", 4]] },
      back: { text: [["header", 46, 110, "start", 32, 608], ["email", 654, 203, "end", 24, 608], ["phone", 654, 244, "end", 24, 608], ["website", 654, 285, "end", 24, 608]], shapes: [["line", 46, 136, 128, 136, "accent", 4]], qr: "Right Stack" } },
    { name: "Return Diagonal", description: "The name sits low on the right while the role and affiliation open at the upper left.", audience: "Digital health and independent clinicians",
      front: { text: [["name", 650, 329, "end", 51, 600], ["title", 50, 91, "start", 26, 520], ["affiliation", 50, 125, "start", 23, 520]], shapes: [["line", 50, 150, 132, 150, "accent", 4]] },
      back: { text: [["header", 650, 330, "end", 32, 600], ["email", 50, 109, "start", 24, 600], ["phone", 50, 150, "start", 24, 600], ["website", 50, 191, "start", 24, 600]], shapes: [["line", 568, 353, 650, 353, "accent", 4]], qr: "Lower Signature" } },
    { name: "Split Footer", description: "The name occupies the main field, with role and affiliation facing out across a divided footer.", audience: "Med-peds and dual-role clinicians",
      front: { text: [["name", 46, 186, "start", 51, 608], ["title", 46, 316, "start", 25, 288], ["affiliation", 654, 316, "end", 23, 288]], shapes: [["line", 46, 269, 654, 269, "accent", 2], ["line", 350, 288, 350, 335, "accent", 2]] },
      back: { text: [["header", 46, 124, "start", 34, 608], ["email", 46, 215, "start", 24, 288], ["phone", 654, 215, "end", 24, 288], ["website", 46, 297, "start", 24, 608]], shapes: [["line", 46, 254, 654, 254, "accent", 2]], qr: "Left Stack" } },
    { name: "Split Header", description: "Role and affiliation share a top band above a broad, low nameplate.", audience: "Leadership and academic programs",
      front: { text: [["name", 350, 274, "middle", 52, 608], ["title", 46, 82, "start", 25, 288], ["affiliation", 654, 82, "end", 23, 288]], shapes: [["line", 46, 112, 654, 112, "accent", 2]] },
      back: { text: [["header", 350, 270, "middle", 35, 608], ["email", 46, 86, "start", 23, 288], ["phone", 654, 86, "end", 23, 288], ["website", 350, 326, "middle", 23, 608]], shapes: [["line", 46, 116, 654, 116, "accent", 2]], qr: "Lower Signature" } },
    { name: "Common Axis", description: "The name and role start to the right of a shared axis while the affiliation ends to its left.", audience: "Researchers and design-conscious academics",
      front: { text: [["name", 292, 157, "start", 42, 363], ["title", 292, 205, "start", 25, 363], ["affiliation", 257, 294, "end", 23, 212]], shapes: [["line", 274, 82, 274, 318, "accent", 2]] },
      back: { text: [["header", 292, 125, "start", 30, 363], ["email", 292, 184, "start", 23, 363], ["phone", 292, 225, "start", 23, 363], ["website", 257, 294, "end", 23, 212]], shapes: [["line", 274, 74, 274, 318, "accent", 2]], qr: "Left Stack" } },
    { name: "Horizon", description: "The name stands alone above a full-width rule, with both supporting fields centered below.", audience: "Cardiology and established specialty practices",
      front: { text: [["name", 350, 154, "middle", 53, 610], ["title", 350, 236, "middle", 26, 610], ["affiliation", 350, 270, "middle", 23, 610]], shapes: [["line", 45, 184, 655, 184, "accent", 2]] },
      back: { text: [["header", 350, 128, "middle", 34, 610], ["email", 350, 206, "middle", 24, 610], ["phone", 350, 246, "middle", 24, 610], ["website", 350, 286, "middle", 24, 610]], shapes: [["line", 45, 155, 655, 155, "accent", 2]], qr: "Centered Column" } },
    { name: "Centered Nameplate", description: "A name framed between two rules occupies the middle, with the role above and the affiliation below.", audience: "Traditional faculty and program leadership",
      front: { text: [["name", 350, 219, "middle", 48, 558], ["title", 350, 78, "middle", 25, 590], ["affiliation", 350, 316, "middle", 23, 590]], shapes: [["line", 55, 120, 645, 120, "accent", 2], ["line", 55, 253, 645, 253, "accent", 2]] },
      back: { text: [["header", 350, 200, "middle", 34, 558], ["email", 350, 82, "middle", 24, 590], ["phone", 350, 300, "middle", 24, 590], ["website", 350, 338, "middle", 24, 590]], shapes: [["line", 55, 113, 645, 113, "accent", 2], ["line", 55, 234, 645, 234, "accent", 2]], qr: "Centered Column" } },
    { name: "Affiliation Plaque", description: "A large open name area sits above a separately framed affiliation line.", audience: "Pharmacy and community practice",
      front: { text: [["name", 49, 145, "start", 50, 602], ["title", 49, 194, "start", 25, 602], ["affiliation", 350, 319, "middle", 24, 558]], shapes: [["frame", 49, 271, 602, 76, "accent", 2]] },
      back: { text: [["header", 350, 319, "middle", 30, 558], ["email", 49, 105, "start", 24, 602], ["phone", 49, 149, "start", 24, 602], ["website", 49, 193, "start", 24, 602]], shapes: [["frame", 49, 241, 602, 106, "accent", 2]], qr: "Lower Signature" } },
    { name: "Credential Window", description: "An upper-left inset holds the name and role, with the affiliation set just outside it.", audience: "Nurse practitioners and private practice",
      front: { text: [["name", 64, 151, "start", 46, 517], ["title", 64, 196, "start", 25, 517], ["affiliation", 64, 311, "start", 23, 582]], shapes: [["frame", 43, 55, 562, 177, "accent", 2]] },
      back: { text: [["header", 64, 137, "start", 32, 517], ["email", 64, 192, "start", 23, 517], ["phone", 64, 231, "start", 23, 517], ["website", 64, 319, "start", 23, 582]], shapes: [["frame", 43, 55, 562, 211, "accent", 2]], qr: "Left Stack" } },
    { name: "Inset Ledger", description: "An inner frame reserves a wide gutter and separates a low affiliation line from the name and role.", audience: "Conservative hospital and training programs",
      front: { text: [["name", 76, 158, "start", 49, 548], ["title", 76, 209, "start", 25, 548], ["affiliation", 76, 324, "start", 23, 548]], shapes: [["frame", 34, 34, 632, 332, "accent", 2], ["line", 76, 274, 624, 274, "accent", 2]] },
      back: { text: [["header", 76, 120, "start", 33, 548], ["email", 76, 181, "start", 24, 548], ["phone", 76, 224, "start", 24, 548], ["website", 76, 324, "start", 24, 548]], shapes: [["frame", 34, 34, 632, 332, "accent", 2], ["line", 76, 274, 624, 274, "accent", 2]], qr: "Left Stack" } },
    { name: "Wide Gutter", description: "A full-height stripe and broad gutter push a flush-left stack into the right-hand field.", audience: "Startups and health technology",
      front: { text: [["name", 202, 172, "start", 47, 450], ["title", 202, 222, "start", 25, 450], ["affiliation", 202, 256, "start", 23, 450]], shapes: [["rect", 0, 0, 18, 400, "accent"], ["line", 171, 81, 171, 319, "accent", 2]] },
      back: { text: [["header", 202, 119, "start", 32, 450], ["email", 202, 181, "start", 24, 450], ["phone", 202, 224, "start", 24, 450], ["website", 202, 267, "start", 24, 450]], shapes: [["rect", 0, 0, 18, 400, "accent"], ["line", 171, 81, 171, 319, "accent", 2]], qr: "Left Stack" } },
    { name: "Three Tiers", description: "Name, role and affiliation each get a full-width row separated by thin rules.", audience: "Residency and hospital teams",
      front: { text: [["name", 47, 119, "start", 48, 606], ["title", 47, 229, "start", 28, 606], ["affiliation", 47, 328, "start", 24, 606]], shapes: [["line", 47, 151, 653, 151, "accent", 2], ["line", 47, 260, 653, 260, "accent", 2]] },
      back: { text: [["header", 47, 106, "start", 33, 606], ["email", 47, 191, "start", 23, 606], ["phone", 47, 232, "start", 23, 606], ["website", 47, 324, "start", 23, 606]], shapes: [["line", 47, 135, 653, 135, "accent", 2], ["line", 47, 262, 653, 262, "accent", 2]], qr: "Left Stack" } },
    { name: "Center Break", description: "A centered name bridges two supporting lines aligned to opposite edges.", audience: "Medical students and early-career clinicians",
      front: { text: [["name", 350, 215, "middle", 51, 606], ["title", 47, 77, "start", 25, 606], ["affiliation", 653, 334, "end", 23, 606]], shapes: [["line", 47, 103, 125, 103, "accent", 3], ["line", 575, 355, 653, 355, "accent", 3]] },
      back: { text: [["header", 350, 192, "middle", 34, 606], ["email", 47, 86, "start", 24, 606], ["phone", 653, 286, "end", 24, 606], ["website", 653, 329, "end", 24, 606]], shapes: [["line", 47, 109, 125, 109, "accent", 3], ["line", 575, 352, 653, 352, "accent", 3]], qr: "Centered Column" } },
    { name: "Side Index", description: "The name occupies a left-hand field, with the role high on the right and the affiliation low on the right.", audience: "Research leads and clinical informatics",
      front: { text: [["name", 42, 212, "start", 44, 335], ["title", 421, 111, "start", 24, 237], ["affiliation", 421, 312, "start", 23, 237]], shapes: [["line", 399, 77, 399, 334, "accent", 2], ["line", 421, 134, 658, 134, "accent", 2], ["line", 421, 282, 658, 282, "accent", 2]] },
      back: { text: [["header", 42, 212, "start", 31, 335], ["email", 421, 109, "start", 23, 237], ["phone", 421, 153, "start", 23, 237], ["website", 421, 312, "start", 23, 237]], shapes: [["line", 399, 77, 399, 334, "accent", 2], ["line", 421, 282, 658, 282, "accent", 2]], qr: "Left Stack" } },
    { name: "Low Center", description: "A high centered affiliation introduces a low centered name and role, with open space between.", audience: "Academic programs and fellowship trainees",
      front: { text: [["name", 350, 274, "middle", 51, 600], ["title", 350, 320, "middle", 25, 600], ["affiliation", 350, 77, "middle", 24, 600]], shapes: [["line", 295, 102, 405, 102, "accent", 3]] },
      back: { text: [["header", 350, 100, "middle", 33, 600], ["email", 350, 231, "middle", 24, 600], ["phone", 350, 272, "middle", 24, 600], ["website", 350, 313, "middle", 24, 600]], shapes: [["line", 295, 128, 405, 128, "accent", 3]], qr: "Centered Column" } },
    { name: "Hanging Indent", description: "A flush-left name introduces a deeply indented role and affiliation below.", audience: "Founders and independent practitioners",
      front: { text: [["name", 45, 137, "start", 52, 610], ["title", 244, 242, "start", 26, 411], ["affiliation", 244, 278, "start", 23, 411]], shapes: [["line", 45, 217, 217, 217, "accent", 3]] },
      back: { text: [["header", 45, 110, "start", 33, 610], ["email", 244, 192, "start", 24, 411], ["phone", 244, 234, "start", 24, 411], ["website", 244, 276, "start", 24, 411]], shapes: [["line", 45, 167, 217, 167, "accent", 3]], qr: "Left Stack" } }
  ],

  // Ink on background is at least 7:1 and accent on background at least 3:1
  // (WCAG relative luminance). Graphite and Slate Mono are greyscale.
  palettes: [
    { name: "Burgundy", background: "#FFF8F5", ink: "#302026", accent: "#852F49" },
    { name: "Midnight", background: "#111B2D", ink: "#F5F7FA", accent: "#86B7E9" },
    { name: "Forest", background: "#F3F7EF", ink: "#172B24", accent: "#386649" },
    { name: "Graphite", background: "#FFFFFF", ink: "#202020", accent: "#646464" },
    { name: "Cobalt", background: "#F4F7FF", ink: "#172540", accent: "#2855B8" },
    { name: "Slate Mono", background: "#F0F0F0", ink: "#151515", accent: "#585858" },
    { name: "Aubergine", background: "#FAF5FB", ink: "#2B2033", accent: "#704886" },
    { name: "Petrol", background: "#102C31", ink: "#F0FAF8", accent: "#63C8BA" },
    { name: "Clay", background: "#FFF4E9", ink: "#35251D", accent: "#A0482C" },
    { name: "Ochre", background: "#FCF7E8", ink: "#2E2718", accent: "#805A14" },
    { name: "Pine Night", background: "#142820", ink: "#F3F7EA", accent: "#A9C88A" },
    { name: "Ink Violet", background: "#221B34", ink: "#FAF5FF", accent: "#C2A4F3" }
  ],

  // Only fonts found on almost every computer, so a downloaded SVG looks the
  // same at the print shop
  fonts: [
    { name: "Clinical Sans", heading: "Arial, Helvetica, sans-serif", body: "Arial, Helvetica, sans-serif" },
    { name: "Editorial Serif", heading: "Georgia, 'Times New Roman', serif", body: "Arial, Helvetica, sans-serif" },
    { name: "Academic Serif", heading: "'Times New Roman', Georgia, serif", body: "Verdana, Arial, Helvetica, sans-serif" },
    { name: "Humanist Sans", heading: "'Trebuchet MS', Arial, Helvetica, sans-serif", body: "Verdana, Arial, Helvetica, sans-serif" },
    { name: "Literary Serif", heading: "Palatino, Garamond, Georgia, 'Times New Roman', serif", body: "Georgia, 'Times New Roman', serif" },
    { name: "Technical Mono", heading: "'Courier New', monospace", body: "Arial, Helvetica, sans-serif" }
  ],

  examples: [
    { layout: "Horizon", palette: "Burgundy", fonts: "Editorial Serif", name: "Elara Vennick", credentials: "MD, FACC", title: "Cardiologist", affiliation: "Alderwake Heart Clinic", email: "elara@example.com", phone: "(202) 555-0101", website: "example.com/elara" },
    { layout: "Three Tiers", palette: "Graphite", fonts: "Clinical Sans", name: "Ishan Merrowe", credentials: "MD", title: "Internal Medicine Resident", affiliation: "Stillfen Residency", email: "ishan@example.com", phone: "(202) 555-0102", website: "example.com/ishan" },
    { layout: "Role First", palette: "Midnight", fonts: "Clinical Sans", name: "Tessa Orlune", credentials: "DO", title: "Emergency Physician", affiliation: "Kestrelmere Emergency Group", email: "tessa@example.com", phone: "(202) 555-0103", website: "example.com/tessa" },
    { layout: "Affiliation Plaque", palette: "Forest", fonts: "Humanist Sans", name: "Marek Sablett", credentials: "PharmD", title: "Clinical Pharmacist", affiliation: "Juniperfold Pharmacy", email: "marek@example.com", phone: "(202) 555-0104", website: "example.com/marek" },
    { layout: "Credential Window", palette: "Clay", fonts: "Editorial Serif", name: "Nadia Fernwick", credentials: "DNP, FNP-C", title: "Family Nurse Practitioner", affiliation: "Mossbridge Care Studio", email: "nadia@example.com", phone: "(202) 555-0105", website: "example.com/nadia" },
    { layout: "Center Break", palette: "Cobalt", fonts: "Humanist Sans", name: "Soren Valehart", credentials: "", title: "Medical Student", affiliation: "", email: "soren@example.com", phone: "(202) 555-0106", website: "example.com/soren" },
    { layout: "Side Index", palette: "Slate Mono", fonts: "Academic Serif", name: "Liora Fenwright", credentials: "PhD", title: "Outcomes Researcher", affiliation: "Glassfern Methods Lab", email: "liora@example.com", phone: "(202) 555-0107", website: "example.com/liora" },
    { layout: "Hanging Indent", palette: "Petrol", fonts: "Technical Mono", name: "Riven Talwick", credentials: "", title: "Founder, Digital Health", affiliation: "Threadfen Digital Health", email: "riven@example.com", phone: "(202) 555-0108", website: "example.com/riven" },
    { layout: "Split Footer", palette: "Aubergine", fonts: "Humanist Sans", name: "Amara Lindenwright", credentials: "MD, FAAP", title: "Med-Peds Physician", affiliation: "Willowfen Dual Care", email: "amara@example.com", phone: "(202) 555-0109", website: "example.com/amara" },
    { layout: "Affiliation First", palette: "Ochre", fonts: "Literary Serif", name: "Celia Torven", credentials: "MD, MEd", title: "Program Director", affiliation: "Northmere Residency", email: "celia@example.com", phone: "(202) 555-0110", website: "example.com/celia" }
  ]
};
