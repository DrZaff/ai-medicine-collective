/* Signature Card Studio: designed templates (batch 1 of 4: Folio, Turnleaf,
   Signal Rail, Index Press, Switchback). Designed by ChatGPT to the
   Collective's round-2 brief; drawn by card-studio.js.

   Each template is a front, a back and a back with a QR slot, as SVG on the
   card grid with bleed (viewBox -25 -25 750 450; the card is 0,0 to 700,400).
   Personal text is <text data-field=...> with data-max-width, data-min-size
   and data-lines; y is the LAST baseline when a field wraps. Shapes marked
   data-with="title" disappear when the title is empty. Colours are the six
   tokens --bg, --ink, --accent, --accent-2, --soft and --on-accent, set per
   colourway. `moveWhenEmpty` says which line moves up when a field is empty:
   { title: { affiliation: 301 } } means "no title: affiliation to y=301".
   `fonts` lists every face the template uses, so it can be loaded for
   measuring and embedded in the downloaded file. */

window.CARD_TEMPLATES = [
  {
    id: "folio",
    name: "Folio",
    style: "Editorial luxury",
    description: "A large serif name, an italic role line and a small copper square, like a book imprint.",
    suits: "Specialist physicians, consultants and academic faculty",
    fonts: [["Fraunces", 600, "normal"], ["Fraunces", 500, "italic"], ["Inter", 500, "normal"]],
    moveWhenEmpty: { title: { affiliation: 301 } },
    colourways: [
      { name: "Porcelain", bg: "#FCF5E9", ink: "#241A20", accent: "#652C40", "accent-2": "#AD7956", soft: "#EEE0D0", "on-accent": "#FFF9F0" },
      { name: "Mist", bg: "#F3F7F6", ink: "#172D32", accent: "#26535A", "accent-2": "#789B95", soft: "#D9E8E4", "on-accent": "#F7FCFB" },
      { name: "Lilac Paper", bg: "#F8F3FA", ink: "#2B2035", accent: "#573B6B", "accent-2": "#A389B3", soft: "#EDE0F1", "on-accent": "#FFF9FF" }
    ],
    front: `<svg xmlns="http://www.w3.org/2000/svg" width="3.75in" height="2.25in" viewBox="-25 -25 750 450">
  <rect x="-25" y="-25" width="750" height="450" fill="var(--bg)"/>
  <rect x="-25" y="-25" width="750" height="33" fill="var(--accent)"/>
  <path d="M52 258H648" fill="none" stroke="var(--accent-2)" stroke-width="1.5" data-with="title"/>
  <rect x="632" y="54" width="16" height="16" fill="var(--accent-2)"/>
  <text data-field="name" data-max-width="596" data-min-size="32" data-lines="2" x="52" y="188" text-anchor="start" font-family="Fraunces" font-size="55" font-weight="600" letter-spacing="-1.6" fill="var(--ink)">Alexandria Montgomery</text>
  <text data-field="credentials" data-max-width="590" data-min-size="20" data-lines="1" x="53" y="229" text-anchor="start" font-family="Inter" font-size="22" font-weight="500" letter-spacing="2" fill="var(--ink)">MD, PhD</text>
  <text data-field="title" data-max-width="596" data-min-size="22" data-lines="1" x="52" y="301" text-anchor="start" font-family="Fraunces" font-size="28" font-weight="500" letter-spacing="0" fill="var(--ink)" font-style="italic">Internal Medicine Physician</text>
  <text data-field="affiliation" data-max-width="596" data-min-size="20" data-lines="1" x="53" y="337" text-anchor="start" font-family="Inter" font-size="22" font-weight="500" letter-spacing="0.2" fill="var(--ink)">Riverside Health Partners</text>
</svg>`,
    back: `<svg xmlns="http://www.w3.org/2000/svg" width="3.75in" height="2.25in" viewBox="-25 -25 750 450">
  <rect x="-25" y="-25" width="750" height="450" fill="var(--accent)"/>
  <path d="M52 145H648" fill="none" stroke="var(--accent-2)" stroke-width="1.5"/>
  <rect x="632" y="315" width="16" height="16" fill="var(--accent-2)"/>
  <text data-field="header" data-max-width="590" data-min-size="24" data-lines="2" x="52" y="117" text-anchor="start" font-family="Fraunces" font-size="38" font-weight="600" letter-spacing="-0.4" fill="var(--on-accent)">Riverside Health Partners</text>
  <text data-field="email" data-max-width="590" data-min-size="22" data-lines="1" x="52" y="204" text-anchor="start" font-family="Inter" font-size="24" font-weight="500" letter-spacing="0" fill="var(--on-accent)">a.montgomery@example.com</text>
  <text data-field="phone" data-max-width="590" data-min-size="22" data-lines="1" x="52" y="251" text-anchor="start" font-family="Inter" font-size="24" font-weight="500" letter-spacing="0" fill="var(--on-accent)">(202) 555-0142</text>
  <text data-field="website" data-max-width="590" data-min-size="22" data-lines="1" x="52" y="298" text-anchor="start" font-family="Inter" font-size="24" font-weight="500" letter-spacing="0" fill="var(--on-accent)">example.com/montgomery</text>
</svg>`,
    backQr: `<svg xmlns="http://www.w3.org/2000/svg" width="3.75in" height="2.25in" viewBox="-25 -25 750 450">
  <rect x="-25" y="-25" width="750" height="450" fill="var(--accent)"/>
  <path d="M52 151H409" fill="none" stroke="var(--accent-2)" stroke-width="1.5"/>
  <rect x="441" y="91" width="234" height="234" fill="var(--accent-2)"/>
  <rect data-slot="qr" x="453" y="103" width="210" height="210" fill="var(--on-accent)"/>
  <text data-field="header" data-max-width="357" data-min-size="23" data-lines="2" x="52" y="125" text-anchor="start" font-family="Fraunces" font-size="32" font-weight="600" letter-spacing="-0.3" fill="var(--on-accent)">Riverside Health Partners</text>
  <text data-field="email" data-max-width="357" data-min-size="22" data-lines="1" x="52" y="202" text-anchor="start" font-family="Inter" font-size="23" font-weight="500" letter-spacing="0" fill="var(--on-accent)">a.montgomery@example.com</text>
  <text data-field="phone" data-max-width="357" data-min-size="22" data-lines="1" x="52" y="245" text-anchor="start" font-family="Inter" font-size="23" font-weight="500" letter-spacing="0" fill="var(--on-accent)">(202) 555-0142</text>
  <text data-field="website" data-max-width="357" data-min-size="22" data-lines="1" x="52" y="288" text-anchor="start" font-family="Inter" font-size="23" font-weight="500" letter-spacing="0" fill="var(--on-accent)">example.com/montgomery</text>
</svg>`
  },

  {
    id: "turnleaf",
    name: "Turnleaf",
    style: "Editorial luxury",
    description: "A curved paper margin balances a low, right-aligned serif name; on the back it cradles the QR code.",
    suits: "Boutique practices and academic specialists",
    fonts: [["Cormorant Garamond", 600, "normal"], ["Cormorant Garamond", 600, "italic"], ["Inter", 500, "normal"]],
    moveWhenEmpty: {},
    colourways: [
      { name: "Parchment", bg: "#FAF3E5", ink: "#2D2118", accent: "#66361F", "accent-2": "#9C704D", soft: "#EDDFC9", "on-accent": "#FFFAEF" },
      { name: "Shell", bg: "#FFF4F1", ink: "#382127", accent: "#77384D", "accent-2": "#BB7784", soft: "#F3DBDA", "on-accent": "#FFF8F8" },
      { name: "Birch", bg: "#F4F5E9", ink: "#242C20", accent: "#42553B", "accent-2": "#8B976F", soft: "#E2E6D1", "on-accent": "#F9FCEF" }
    ],
    front: `<svg xmlns="http://www.w3.org/2000/svg" width="3.75in" height="2.25in" viewBox="-25 -25 750 450">
  <rect x="-25" y="-25" width="750" height="450" fill="var(--bg)"/>
  <path d="M-25 -25H128V290Q128 362 56 362H-25Z" fill="var(--soft)"/>
  <path d="M-25 348H56Q114 348 114 290V-25" fill="none" stroke="var(--accent-2)" stroke-width="1.5"/>
  <path d="M524 104H650" fill="none" stroke="var(--accent-2)" stroke-width="1.5" data-with="title"/>
  <text data-field="title" data-max-width="505" data-min-size="22" data-lines="1" x="650" y="85" text-anchor="end" font-family="Cormorant Garamond" font-size="29" font-weight="600" letter-spacing="0" fill="var(--ink)" font-style="italic">Internal Medicine Physician</text>
  <text data-field="name" data-max-width="505" data-min-size="32" data-lines="2" x="650" y="258" text-anchor="end" font-family="Cormorant Garamond" font-size="60" font-weight="600" letter-spacing="-0.7" fill="var(--ink)">Alexandria Montgomery</text>
  <text data-field="credentials" data-max-width="505" data-min-size="20" data-lines="1" x="650" y="297" text-anchor="end" font-family="Inter" font-size="22" font-weight="500" letter-spacing="1.5" fill="var(--ink)">MD, PhD</text>
  <text data-field="affiliation" data-max-width="505" data-min-size="20" data-lines="1" x="650" y="343" text-anchor="end" font-family="Inter" font-size="23" font-weight="500" letter-spacing="0" fill="var(--ink)">Riverside Health Partners</text>
</svg>`,
    back: `<svg xmlns="http://www.w3.org/2000/svg" width="3.75in" height="2.25in" viewBox="-25 -25 750 450">
  <rect x="-25" y="-25" width="750" height="450" fill="var(--bg)"/>
  <path d="M-25 -25H82V302Q82 348 36 348H-25Z" fill="var(--soft)"/>
  <path d="M120 172H650" fill="none" stroke="var(--accent-2)" stroke-width="1.5"/>
  <text data-field="header" data-max-width="530" data-min-size="24" data-lines="2" x="650" y="144" text-anchor="end" font-family="Cormorant Garamond" font-size="42" font-weight="600" letter-spacing="0" fill="var(--ink)">Riverside Health Partners</text>
  <text data-field="email" data-max-width="530" data-min-size="22" data-lines="1" x="650" y="220" text-anchor="end" font-family="Inter" font-size="24" font-weight="500" letter-spacing="0" fill="var(--ink)">a.montgomery@example.com</text>
  <text data-field="phone" data-max-width="530" data-min-size="22" data-lines="1" x="650" y="266" text-anchor="end" font-family="Inter" font-size="24" font-weight="500" letter-spacing="0" fill="var(--ink)">(202) 555-0142</text>
  <text data-field="website" data-max-width="530" data-min-size="22" data-lines="1" x="650" y="312" text-anchor="end" font-family="Inter" font-size="24" font-weight="500" letter-spacing="0" fill="var(--ink)">example.com/montgomery</text>
</svg>`,
    backQr: `<svg xmlns="http://www.w3.org/2000/svg" width="3.75in" height="2.25in" viewBox="-25 -25 750 450">
  <rect x="-25" y="-25" width="750" height="450" fill="var(--bg)"/>
  <path d="M-25 -25H260V304Q260 345 219 345H-25Z" fill="var(--soft)"/>
  <path d="M283 158H650" fill="none" stroke="var(--accent-2)" stroke-width="1.5"/>
  <rect data-slot="qr" x="34" y="100" width="210" height="210" fill="var(--on-accent)"/>
  <text data-field="header" data-max-width="367" data-min-size="23" data-lines="2" x="650" y="130" text-anchor="end" font-family="Cormorant Garamond" font-size="36" font-weight="600" letter-spacing="0" fill="var(--ink)">Riverside Health Partners</text>
  <text data-field="email" data-max-width="367" data-min-size="22" data-lines="1" x="650" y="210" text-anchor="end" font-family="Inter" font-size="23" font-weight="500" letter-spacing="0" fill="var(--ink)">a.montgomery@example.com</text>
  <text data-field="phone" data-max-width="367" data-min-size="22" data-lines="1" x="650" y="254" text-anchor="end" font-family="Inter" font-size="23" font-weight="500" letter-spacing="0" fill="var(--ink)">(202) 555-0142</text>
  <text data-field="website" data-max-width="367" data-min-size="22" data-lines="1" x="650" y="298" text-anchor="end" font-family="Inter" font-size="23" font-weight="500" letter-spacing="0" fill="var(--ink)">example.com/montgomery</text>
</svg>`
  },

  {
    id: "signal-rail",
    name: "Signal Rail",
    style: "Swiss modernist",
    description: "Oversized initials fill a full-height colour rail, with the name and details on a strict left grid.",
    suits: "Clinical informatics, emergency medicine and digital-health teams",
    fonts: [["Space Grotesk", 700, "normal"], ["Space Grotesk", 500, "normal"], ["IBM Plex Mono", 500, "normal"]],
    moveWhenEmpty: { title: { affiliation: 278 } },
    colourways: [
      { name: "Ultramarine", bg: "#F6F8FF", ink: "#161E33", accent: "#2037A4", "accent-2": "#718DFF", soft: "#E0E6FF", "on-accent": "#FFFFFF" },
      { name: "Safety Orange", bg: "#FFF6ED", ink: "#2E211A", accent: "#8B2E0E", "accent-2": "#EE833A", soft: "#F4DEC8", "on-accent": "#FFF9F3" },
      { name: "Viridian", bg: "#EEF7F4", ink: "#102B26", accent: "#0B5748", "accent-2": "#67A993", soft: "#D0E8DF", "on-accent": "#FAFFFC" }
    ],
    front: `<svg xmlns="http://www.w3.org/2000/svg" width="3.75in" height="2.25in" viewBox="-25 -25 750 450">
  <rect x="-25" y="-25" width="750" height="450" fill="var(--bg)"/>
  <rect x="488" y="-25" width="237" height="450" fill="var(--accent)"/>
  <rect x="488" y="0" width="12" height="400" fill="var(--accent-2)"/>
  <path d="M43 68H117M43 332H457" fill="none" stroke="var(--ink)" stroke-width="2"/>
  <text data-field="name" data-max-width="415" data-min-size="31" data-lines="2" x="43" y="197" text-anchor="start" font-family="Space Grotesk" font-size="46" font-weight="700" letter-spacing="-1" fill="var(--ink)">Alexandria Montgomery</text>
  <text data-field="credentials" data-max-width="412" data-min-size="20" data-lines="1" x="44" y="233" text-anchor="start" font-family="IBM Plex Mono" font-size="22" font-weight="500" letter-spacing="0" fill="var(--ink)">MD, PhD</text>
  <text data-field="title" data-max-width="415" data-min-size="21" data-lines="1" x="43" y="278" text-anchor="start" font-family="Space Grotesk" font-size="23" font-weight="500" letter-spacing="0" fill="var(--ink)">Internal Medicine Physician</text>
  <text data-field="affiliation" data-max-width="415" data-min-size="20" data-lines="1" x="43" y="310" text-anchor="start" font-family="Space Grotesk" font-size="22" font-weight="500" letter-spacing="0" fill="var(--ink)">Riverside Health Partners</text>
  <text data-field="initials" data-max-width="150" data-min-size="56" data-lines="1" x="592" y="233" text-anchor="middle" font-family="Space Grotesk" font-size="98" font-weight="700" letter-spacing="-4" fill="var(--on-accent)">AM</text>
</svg>`,
    back: `<svg xmlns="http://www.w3.org/2000/svg" width="3.75in" height="2.25in" viewBox="-25 -25 750 450">
  <rect x="-25" y="-25" width="750" height="450" fill="var(--bg)"/>
  <rect x="488" y="-25" width="237" height="450" fill="var(--accent)"/>
  <rect x="488" y="0" width="12" height="400" fill="var(--accent-2)"/>
  <path d="M43 144H457M43 314H457" fill="none" stroke="var(--ink)" stroke-width="2"/>
  <text data-field="header" data-max-width="414" data-min-size="23" data-lines="2" x="43" y="116" text-anchor="start" font-family="Space Grotesk" font-size="33" font-weight="700" letter-spacing="-0.4" fill="var(--ink)">Riverside Health Partners</text>
  <text data-field="email" data-max-width="414" data-min-size="22" data-lines="1" x="43" y="191" text-anchor="start" font-family="IBM Plex Mono" font-size="22" font-weight="500" letter-spacing="0" fill="var(--ink)">a.montgomery@example.com</text>
  <text data-field="phone" data-max-width="414" data-min-size="22" data-lines="1" x="43" y="235" text-anchor="start" font-family="IBM Plex Mono" font-size="22" font-weight="500" letter-spacing="0" fill="var(--ink)">(202) 555-0142</text>
  <text data-field="website" data-max-width="414" data-min-size="22" data-lines="1" x="43" y="279" text-anchor="start" font-family="IBM Plex Mono" font-size="22" font-weight="500" letter-spacing="0" fill="var(--ink)">example.com/montgomery</text>
  <text data-field="initials" data-max-width="150" data-min-size="56" data-lines="1" x="592" y="233" text-anchor="middle" font-family="Space Grotesk" font-size="98" font-weight="700" letter-spacing="-4" fill="var(--on-accent)">AM</text>
</svg>`,
    backQr: `<svg xmlns="http://www.w3.org/2000/svg" width="3.75in" height="2.25in" viewBox="-25 -25 750 450">
  <rect x="-25" y="-25" width="750" height="450" fill="var(--bg)"/>
  <rect x="423" y="-25" width="302" height="450" fill="var(--accent)"/>
  <rect x="423" y="0" width="12" height="400" fill="var(--accent-2)"/>
  <path d="M43 145H395M43 315H395" fill="none" stroke="var(--ink)" stroke-width="2"/>
  <rect data-slot="qr" x="451" y="96" width="208" height="208" fill="var(--on-accent)"/>
  <text data-field="header" data-max-width="352" data-min-size="23" data-lines="2" x="43" y="117" text-anchor="start" font-family="Space Grotesk" font-size="32" font-weight="700" letter-spacing="-0.4" fill="var(--ink)">Riverside Health Partners</text>
  <text data-field="email" data-max-width="352" data-min-size="22" data-lines="1" x="43" y="193" text-anchor="start" font-family="IBM Plex Mono" font-size="22" font-weight="500" letter-spacing="0" fill="var(--ink)">a.montgomery@example.com</text>
  <text data-field="phone" data-max-width="352" data-min-size="22" data-lines="1" x="43" y="237" text-anchor="start" font-family="IBM Plex Mono" font-size="22" font-weight="500" letter-spacing="0" fill="var(--ink)">(202) 555-0142</text>
  <text data-field="website" data-max-width="352" data-min-size="22" data-lines="1" x="43" y="281" text-anchor="start" font-family="IBM Plex Mono" font-size="22" font-weight="500" letter-spacing="0" fill="var(--ink)">example.com/montgomery</text>
</svg>`
  },

  {
    id: "index-press",
    name: "Index Press",
    style: "Swiss modernist",
    description: "Heavy type in a solid masthead, three modular tabs below and a ruled contact grid on the back.",
    suits: "Researchers, program directors and conference speakers",
    fonts: [["Archivo", 800, "normal"], ["IBM Plex Sans", 600, "normal"], ["IBM Plex Sans", 500, "normal"]],
    moveWhenEmpty: { title: { affiliation: 281 } },
    colourways: [
      { name: "Signal Red", bg: "#FFF4EF", ink: "#25191B", accent: "#9B2337", "accent-2": "#EA7776", soft: "#F5DEDA", "on-accent": "#FFFFFF" },
      { name: "Iris", bg: "#F7F3FF", ink: "#251C37", accent: "#56398A", "accent-2": "#B49AE5", soft: "#EAE0FA", "on-accent": "#FFFFFF" },
      { name: "Blue Steel", bg: "#F0F6FA", ink: "#172633", accent: "#284E6B", "accent-2": "#78A2BC", soft: "#DDEAF1", "on-accent": "#FFFFFF" }
    ],
    front: `<svg xmlns="http://www.w3.org/2000/svg" width="3.75in" height="2.25in" viewBox="-25 -25 750 450">
  <rect x="-25" y="-25" width="750" height="450" fill="var(--bg)"/>
  <rect x="-25" y="-25" width="750" height="238" fill="var(--accent)"/>
  <path d="M487 246H535V375H487ZM551 246H599V375H551ZM615 246H663V375H615Z" fill="var(--soft)"/>
  <rect x="615" y="246" width="48" height="19" fill="var(--accent-2)"/>
  <text data-field="fullname" data-max-width="616" data-min-size="31" data-lines="2" x="42" y="161" text-anchor="start" font-family="Archivo" font-size="50" font-weight="800" letter-spacing="-1.2" fill="var(--on-accent)">Alexandria Montgomery, MD, PhD</text>
  <text data-field="title" data-max-width="410" data-min-size="22" data-lines="1" x="42" y="281" text-anchor="start" font-family="IBM Plex Sans" font-size="26" font-weight="600" letter-spacing="0" fill="var(--ink)">Internal Medicine Physician</text>
  <text data-field="affiliation" data-max-width="410" data-min-size="21" data-lines="1" x="42" y="327" text-anchor="start" font-family="IBM Plex Sans" font-size="23" font-weight="500" letter-spacing="0" fill="var(--ink)">Riverside Health Partners</text>
</svg>`,
    back: `<svg xmlns="http://www.w3.org/2000/svg" width="3.75in" height="2.25in" viewBox="-25 -25 750 450">
  <rect x="-25" y="-25" width="750" height="450" fill="var(--bg)"/>
  <rect x="-25" y="-25" width="750" height="174" fill="var(--accent)"/>
  <path d="M42 186H658M42 243H658M42 300H658M42 357H658" fill="none" stroke="var(--accent-2)" stroke-width="1.5"/>
  <text data-field="header" data-max-width="616" data-min-size="24" data-lines="2" x="42" y="118" text-anchor="start" font-family="Archivo" font-size="37" font-weight="800" letter-spacing="-0.7" fill="var(--on-accent)">Riverside Health Partners</text>
  <text data-field="email" data-max-width="616" data-min-size="22" data-lines="1" x="658" y="223" text-anchor="end" font-family="IBM Plex Sans" font-size="24" font-weight="500" letter-spacing="0" fill="var(--ink)">a.montgomery@example.com</text>
  <text data-field="phone" data-max-width="616" data-min-size="22" data-lines="1" x="658" y="280" text-anchor="end" font-family="IBM Plex Sans" font-size="24" font-weight="500" letter-spacing="0" fill="var(--ink)">(202) 555-0142</text>
  <text data-field="website" data-max-width="616" data-min-size="22" data-lines="1" x="658" y="337" text-anchor="end" font-family="IBM Plex Sans" font-size="24" font-weight="500" letter-spacing="0" fill="var(--ink)">example.com/montgomery</text>
</svg>`,
    backQr: `<svg xmlns="http://www.w3.org/2000/svg" width="3.75in" height="2.25in" viewBox="-25 -25 750 450">
  <rect x="-25" y="-25" width="750" height="450" fill="var(--bg)"/>
  <rect x="-25" y="-25" width="750" height="174" fill="var(--accent)"/>
  <rect x="429" y="-25" width="296" height="450" fill="var(--soft)"/>
  <path d="M42 186H400M42 243H400M42 300H400M42 357H400" fill="none" stroke="var(--accent-2)" stroke-width="1.5"/>
  <rect data-slot="qr" x="454" y="95" width="210" height="210" fill="var(--on-accent)"/>
  <text data-field="header" data-max-width="358" data-min-size="23" data-lines="2" x="42" y="118" text-anchor="start" font-family="Archivo" font-size="32" font-weight="800" letter-spacing="-0.5" fill="var(--on-accent)">Riverside Health Partners</text>
  <text data-field="email" data-max-width="358" data-min-size="22" data-lines="1" x="42" y="223" text-anchor="start" font-family="IBM Plex Sans" font-size="23" font-weight="500" letter-spacing="0" fill="var(--ink)">a.montgomery@example.com</text>
  <text data-field="phone" data-max-width="358" data-min-size="22" data-lines="1" x="42" y="280" text-anchor="start" font-family="IBM Plex Sans" font-size="23" font-weight="500" letter-spacing="0" fill="var(--ink)">(202) 555-0142</text>
  <text data-field="website" data-max-width="358" data-min-size="22" data-lines="1" x="42" y="337" text-anchor="start" font-family="IBM Plex Sans" font-size="23" font-weight="500" letter-spacing="0" fill="var(--ink)">example.com/montgomery</text>
</svg>`
  },

  {
    id: "switchback",
    name: "Switchback",
    style: "Colour block",
    description: "Three interlocking fields meet at a stepped seam, with a broad serif name across the upper field.",
    suits: "Primary care, private practice and clinician-founders",
    fonts: [["DM Serif Display", 400, "normal"], ["Manrope", 700, "normal"], ["Manrope", 500, "normal"]],
    moveWhenEmpty: { title: { affiliation: 299 } },
    colourways: [
      { name: "Papaya Ink", bg: "#FFF4E7", ink: "#322018", accent: "#713318", "accent-2": "#F1A36C", soft: "#F3DECB", "on-accent": "#FFF8F0" },
      { name: "Lagoon", bg: "#EEF9F7", ink: "#133136", accent: "#17545C", "accent-2": "#7ACDC1", soft: "#D7EEEB", "on-accent": "#F4FFFD" },
      { name: "Berry", bg: "#FDF0F4", ink: "#38202E", accent: "#6F2D52", "accent-2": "#DF93B4", soft: "#F3DCE6", "on-accent": "#FFF8FC" }
    ],
    front: `<svg xmlns="http://www.w3.org/2000/svg" width="3.75in" height="2.25in" viewBox="-25 -25 750 450">
  <rect x="-25" y="-25" width="750" height="450" fill="var(--bg)"/>
  <path d="M-25 -25H725V200H412V235H-25Z" fill="var(--accent)"/>
  <path d="M412 200H725V425H412V364H725V259H412Z" fill="var(--soft)"/>
  <rect x="-25" y="235" width="437" height="9" fill="var(--accent-2)"/>
  <text data-field="fullname" data-max-width="600" data-min-size="30" data-lines="2" x="46" y="167" text-anchor="start" font-family="DM Serif Display" font-size="48" font-weight="400" letter-spacing="-0.6" fill="var(--on-accent)">Alexandria Montgomery, MD, PhD</text>
  <text data-field="title" data-max-width="343" data-min-size="22" data-lines="1" x="46" y="299" text-anchor="start" font-family="Manrope" font-size="24" font-weight="700" letter-spacing="-0.2" fill="var(--ink)">Internal Medicine Physician</text>
  <text data-field="affiliation" data-max-width="343" data-min-size="21" data-lines="1" x="46" y="340" text-anchor="start" font-family="Manrope" font-size="23" font-weight="500" letter-spacing="0" fill="var(--ink)">Riverside Health Partners</text>
</svg>`,
    back: `<svg xmlns="http://www.w3.org/2000/svg" width="3.75in" height="2.25in" viewBox="-25 -25 750 450">
  <rect x="-25" y="-25" width="750" height="450" fill="var(--bg)"/>
  <path d="M-25 -25H725V172H291V151H-25Z" fill="var(--accent)"/>
  <rect x="-25" y="151" width="316" height="9" fill="var(--accent-2)"/>
  <path d="M-25 160H237V425H-25Z" fill="var(--soft)"/>
  <text data-field="header" data-max-width="603" data-min-size="24" data-lines="2" x="46" y="116" text-anchor="start" font-family="DM Serif Display" font-size="36" font-weight="400" letter-spacing="-0.4" fill="var(--on-accent)">Riverside Health Partners</text>
  <text data-field="email" data-max-width="370" data-min-size="22" data-lines="1" x="280" y="226" text-anchor="start" font-family="Manrope" font-size="24" font-weight="500" letter-spacing="0" fill="var(--ink)">a.montgomery@example.com</text>
  <text data-field="phone" data-max-width="370" data-min-size="22" data-lines="1" x="280" y="272" text-anchor="start" font-family="Manrope" font-size="24" font-weight="500" letter-spacing="0" fill="var(--ink)">(202) 555-0142</text>
  <text data-field="website" data-max-width="370" data-min-size="22" data-lines="1" x="280" y="318" text-anchor="start" font-family="Manrope" font-size="24" font-weight="500" letter-spacing="0" fill="var(--ink)">example.com/montgomery</text>
</svg>`,
    backQr: `<svg xmlns="http://www.w3.org/2000/svg" width="3.75in" height="2.25in" viewBox="-25 -25 750 450">
  <rect x="-25" y="-25" width="750" height="450" fill="var(--bg)"/>
  <path d="M-25 -25H725V155H418V176H-25Z" fill="var(--accent)"/>
  <path d="M418 155H725V425H418Z" fill="var(--soft)"/>
  <rect x="-25" y="176" width="443" height="9" fill="var(--accent-2)"/>
  <rect data-slot="qr" x="454" y="104" width="210" height="210" fill="var(--on-accent)"/>
  <text data-field="header" data-max-width="355" data-min-size="23" data-lines="2" x="46" y="121" text-anchor="start" font-family="DM Serif Display" font-size="32" font-weight="400" letter-spacing="-0.4" fill="var(--on-accent)">Riverside Health Partners</text>
  <text data-field="email" data-max-width="355" data-min-size="22" data-lines="1" x="46" y="230" text-anchor="start" font-family="Manrope" font-size="23" font-weight="500" letter-spacing="0" fill="var(--ink)">a.montgomery@example.com</text>
  <text data-field="phone" data-max-width="355" data-min-size="22" data-lines="1" x="46" y="275" text-anchor="start" font-family="Manrope" font-size="23" font-weight="500" letter-spacing="0" fill="var(--ink)">(202) 555-0142</text>
  <text data-field="website" data-max-width="355" data-min-size="22" data-lines="1" x="46" y="320" text-anchor="start" font-family="Manrope" font-size="23" font-weight="500" letter-spacing="0" fill="var(--ink)">example.com/montgomery</text>
</svg>`
  }
];

// Where each face is hosted, for measuring and for embedding in downloads
window.CARD_FONT_FILES = {
  "Fraunces|600|normal": "fonts/cards/fraunces-600.woff2",
  "Fraunces|500|italic": "fonts/cards/fraunces-500-italic.woff2",
  "Inter|500|normal": "fonts/cards/inter-500.woff2",
  "Cormorant Garamond|600|normal": "fonts/cards/cormorant-garamond-600.woff2",
  "Cormorant Garamond|600|italic": "fonts/cards/cormorant-garamond-600-italic.woff2",
  "Space Grotesk|500|normal": "fonts/cards/space-grotesk-500.woff2",
  "Space Grotesk|700|normal": "fonts/cards/space-grotesk-700.woff2",
  "IBM Plex Mono|500|normal": "fonts/cards/ibm-plex-mono-500.woff2",
  "Archivo|800|normal": "fonts/cards/archivo-800.woff2",
  "IBM Plex Sans|500|normal": "fonts/cards/ibm-plex-sans-500.woff2",
  "IBM Plex Sans|600|normal": "fonts/cards/ibm-plex-sans-600.woff2",
  "DM Serif Display|400|normal": "fonts/cards/dm-serif-display-400.woff2",
  "Manrope|500|normal": "fonts/cards/manrope-500.woff2",
  "Manrope|700|normal": "fonts/cards/manrope-700.woff2"
};
