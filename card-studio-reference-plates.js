/* Professional reference plates. Each source face has editable fields and
   coordinated standard and QR backs. Architectural artwork is generic. */
(() => {
  "use strict";

  const paint = (token) => token.startsWith("#") ? "url(" + token + ")" : "var(--" + token + ")";
  const rect = (x, y, w, h, token) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + paint(token) + '"/>';
  const path = (d, token, stroke = 0) => '<path d="' + d + '" ' +
    (stroke ? 'fill="none" stroke="' + paint(token) + '" stroke-width="' + stroke + '"' : 'fill="' + paint(token) + '"') + '/>';
  const ellipse = (x, y, rx, ry, token, stroke = 0) => '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" ' +
    (stroke ? 'fill="none" stroke="' + paint(token) + '" stroke-width="' + stroke + '"' : 'fill="' + paint(token) + '"') + '/>';
  const group = (art, transform, opacity = 1) => '<g transform="' + transform + '" opacity="' + opacity + '">' + art + '</g>';
  const stroke = (d, token = "accent-2", width = 1.4) => path(d, token, width);
  const full = (token) => rect(-25, -25, 750, 450, token);
  const frame = (x, y, w, h, token = "accent-2") => stroke("M"+x+" "+y+"h"+w+"v"+h+"h-"+w+"Z", token);
  const ramp = '<defs><linearGradient id="plate-sheen" x1="0%" y1="8%" x2="100%" y2="100%">' +
    '<stop offset="0" stop-color="var(--soft)" stop-opacity=".2"/><stop offset=".45" stop-color="var(--accent-2)" stop-opacity=".8"/>' +
    '<stop offset="1" stop-color="var(--accent)" stop-opacity=".95"/></linearGradient></defs>';
  const fan = (x, y, size = 1, flip = false) => group(stroke(Array.from({length: 22}, (_, i) =>
    "M"+(i*5)+" "+(178+i*6)+"C"+(106+i*3)+" "+(52+i*8)+" "+(184+i*3)+" "+(286-i*4)+" 392 "+(i*6)).join(""), "accent-2", 1.1),
    "translate("+x+" "+y+") scale("+(flip ? -size : size)+" "+size+")", .65);
  const arcs = (x, y, size = 1) => group(stroke(Array.from({length: 11}, (_, i) =>
    "M0 "+(20+i*15)+"Q"+(36+i*13)+" "+(22+i*10)+" "+(49+i*15)+" 0").join(""), "accent-2", 1.1), "translate("+x+" "+y+") scale("+size+")", .6);
  const signalWaves = () => stroke(Array.from({length: 23}, (_, i) => {
    const y = 340 + i * 4;
    return "M-25 "+y+"C121 "+(y-118+i*2)+" 243 "+(y+80-i*4)+" 408 "+(y+1)+"S579 "+(y-31)+" 725 "+(y-119+i*3);
  }).join(""), "accent-2", 1.05);
  const hex = (x, y, size = 1) => {
    const cells = [[0,0],[59,34],[0,68],[118,0],[118,68],[59,102],[118,136],[59,170],[118,204]];
    return group(stroke(cells.map(([a,b])=>"M"+(a-39)+" "+b+"l20 -34h39l20 34l-20 34h-39Z").join(""), "accent-2", 1.2) +
      cells.map(([a,b])=>ellipse(a+20,b-34,2.7,2.7,"accent-2")).join(""), "translate("+x+" "+y+") scale("+size+")", .63);
  };
  const dots = (x, y, size = 1, upright = false) => {
    let d = "";
    for (let row=0;row<17;row++) for(let col=0;col<27;col++){
      const px=col*12, py=Math.round(row*9+35*Math.sin(col/5+row/6));
      d+="M"+px+" "+py+"h.1";
    }
    return group('<path d="'+d+'" fill="none" stroke="var(--accent-2)" stroke-width="2.05" stroke-linecap="round"/>',
      "translate("+x+" "+y+") rotate("+(upright?-62:-20)+") scale("+size+")", .8);
  };
  const wave = (x,y,size=1) => group(
    path("M0 252Q106 231 155 174T399 10V274H0Z","soft")+
    path("M45 274Q166 244 213 184T399 67V274Z","accent-2")+
    path("M153 274Q247 244 278 184T399 116V274Z","accent"),"translate("+x+" "+y+") scale("+size+")");
  const hills = (x,y,size=1) => group(
    path("M0 201Q67 182 121 139T213 108Q267 119 302 70T398 27V244H0Z","soft")+
    path("M49 244Q137 209 196 170T280 144Q319 153 398 87V244Z","accent-2")+
    path("M133 244Q221 221 267 188T342 171L398 142V244Z","accent"),"translate("+x+" "+y+") scale("+size+")");
  const helix = (x,y,size=1) => {
    let left="",right="",bars="";
    for(let i=0;i<=60;i++){
      const offset=48*Math.sin(i*.166),y=i*7;
      left+=(i?"L":"M")+(62+offset).toFixed(1)+" "+y;
      right+=(i?"L":"M")+(62-offset).toFixed(1)+" "+y;
      if(i%3===0)bars+="M"+(62+offset).toFixed(1)+" "+y+"L"+(62-offset).toFixed(1)+" "+(y+11);
    }
    return group(stroke(bars,"soft",1.8)+stroke(left,"accent-2",4.6)+stroke(right,"accent-2",4.6),
      "translate("+x+" "+y+") rotate(18) scale("+size+")", .87);
  };
  const skyline = (x,y,size=1) => group(
    stroke("M0 154H390M16 154V109H48V154M48 154V88H73V154M73 154V112H99V154M99 154V72H124V154M124 154V94H151V154M151 154V58H176V154M176 154V81H204V154M204 154V49H234V154M234 154V35H254V154M244 35V13M254 154V66H278V154M278 154V108H306V154M306 154V86H332V154M332 154V69H357V154M357 154V107H388V154","accent",1.5)+
    stroke(Array.from({length:19},(_,i)=>"M"+(21+i*18)+" 119v25m5 -25v25").join(""),"accent",.8),
    "translate("+x+" "+y+") scale("+size+")",.68);
  const portico = (x,y,size=1,token="accent-2") => group(
    stroke("M0 89L163 9L326 89ZM17 86L163 21L309 86M0 93H326M12 102H314M14 202H312M7 211H319",token,2)+
    stroke(Array.from({length:8},(_,i)=>"M"+(35+i*35)+" 102v99m3 -99v99m7 -99v99m-15 0h20").join(""),token,1.25)+
    stroke("M148 65a15 15 0 1 0 30 0a15 15 0 1 0-30 0Z",token,1.2),
    "translate("+x+" "+y+") scale("+size+")");
  const tower = (x,y,size=1) => group(
    stroke("M1 152H329M25 152L165 100L304 152M41 152L165 109L287 152M138 108V84H192V108M146 84V57H184V84M141 57H189M151 55V37H179V55M147 37Q165 11 183 37M165 13V0M154 78V63M165 78V63M176 78V63M127 112H203","accent-2",2.4)+
    stroke("M152 141L165 122L178 141ZM83 151L165 122L247 151","accent-2",1),
    "translate("+x+" "+y+") scale("+size+")");
  const bridge = (x,y,size=1) => group(
    stroke("M-20 176H365M-20 190H365M51 187V77H89V187M248 187V49H292V187M43 78H97M242 50H300M52 71L70 50L88 71M251 43L270 21L290 43M51 101Q-3 151 -28 153M89 84Q160 157 248 60M292 52Q325 112 365 131","accent-2",2)+
    stroke(Array.from({length:18},(_,i)=>{const x=-10+i*21;return "M"+x+" "+(x<51?145-(x+10):x<248?Math.round(150-(x-166)**2/106):80+(x-280)*.55)+"V176";}).join(""),"soft",.9)+
    stroke("M-14 205Q65 200 143 208T359 204M31 217Q155 209 309 217","accent-2",1.2),
    "translate("+x+" "+y+") scale("+size+")");
  const contour = (x,y,size=1) => group(stroke(Array.from({length:16},(_,i)=>{
    const a=i*12;return "M"+a+" 339C"+(25+a)+" 266 "+(142+a)+" 297 "+(168+a)+" 223S"+(132+a)+" 119 "+(200+a)+" 73S"+(245+a)+" 42 "+(288+a)+" -28";
  }).join(""),"accent-2",1.2),"translate("+x+" "+y+") scale("+size+")",.74);
  const network = (x,y,size=1) => group(stroke("M14 184L102 88L178 128L211 36L310 71L274 216L178 128L107 259L274 216L328 278M102 88L211 36M211 36L274 216","accent-2",1.4)+
    [[14,184],[102,88],[178,128],[211,36],[310,71],[274,216],[107,259],[328,278]].map(([a,b])=>ellipse(a,b,3.4,3.4,"accent-2")).join(""),
    "translate("+x+" "+y+") scale("+size+")",.85);
  const facet = (mirror = false) => group(path("M-25 -25H243L-25 376Z","soft")+path("M-25 376L101 190L239 425H-25Z","accent")+
    stroke("M243 -25L-25 376","accent-2",2.1)+stroke(Array.from({length:10},(_,i)=>"M"+(i*18-18)+" 425L"+(112+i*5)+" "+(182+i*13)).join(""),"accent-2",.9),
    mirror ? "translate(700 0) scale(-1 1)" : "");
  const sash = () => path("M-25 425V414C172 338 375 397 521 345C628 307 691 232 725 152V425Z","accent")+
    stroke("M-25 417C172 339 377 396 523 345C629 306 692 228 725 150M259 425C452 355 578 389 725 249","accent-2",2);
  const prism = () => path("M498 425L725 113V425Z","soft")+path("M564 425L725 213V425Z","accent-2")+path("M630 425L725 293V425Z","accent");
  const eclipse = () => ellipse(753,446,276,284,"#plate-sheen")+ellipse(753,446,275,283,"accent-2",2)+ellipse(775,475,267,262,"bg")+ellipse(775,475,267,262,"accent-2",1);
  const label = (x,y,w,token) => path("M"+(x+14)+" "+y+"H"+(x+w-14)+"l14 20l-14 20H"+(x+14)+"l-14-20Z",token);
  const divider = (x,y,w,token = "accent-2") => stroke("M"+x+" "+y+"h"+w,token,1.4);
  const border = () => stroke("M42 24H658Q658 38 676 41V359Q658 362 658 376H42Q42 362 24 359V41Q42 38 42 24Z","accent-2",1.65);
  const pal = (name,bg,ink,accent,a2,soft,on) => ({name,bg,ink,accent,"accent-2":a2,soft,"on-accent":on});
  const families = {
    claret:[pal("Claret & Ivory","#FBF0DF","#3B2330","#642538","#C38F72","#E6CBBC","#FFF5E5"),pal("Navy & Brass","#F8F1E2","#25344D","#263F61","#B69765","#D4DEEA","#FFF6E9"),pal("Forest & Parchment","#F6EFDC","#28392F","#315343","#9F9B70","#D6DFCA","#FFF8E4")],
    blue:[pal("Clinical Cobalt","#F1F7FB","#182D49","#183E69","#429ED3","#C5DFEF","#F4FAFF"),pal("Clinical Teal","#EFF8F4","#173B3B","#205756","#56AA9E","#C1E4DD","#F4FFFA"),pal("Clinical Violet","#F4F1FB","#2D294D","#41376D","#8C85CE","#DED7F0","#FCF8FF")],
    dark:[pal("Copper & Charcoal","#1D2025","#FFF4E8","#392C34","#D38E66","#3D3335","#FFF5E8"),pal("Silver & Midnight","#172333","#F3F7FB","#26374B","#93B8D0","#2A3A48","#F8FCFF"),pal("Brass & Pine","#172822","#F8F3DD","#2D4237","#C6AD73","#2E3D34","#FFF8E3")],
    green:[pal("Emerald & Gold","#102D29","#F0F6E1","#234B3E","#91AE79","#294D45","#F8FBE8"),pal("Ink & Jade","#152B39","#EAF8F7","#28485C","#7DBBAD","#2C4657","#F4FCFC"),pal("Plum & Brass","#302138","#FFF1E9","#503750","#D8AD77","#4A3446","#FFF6EE")],
    ivory:[pal("Warm Ivory","#FAF1E4","#302A35","#73394B","#B8806E","#E5D3C9","#FFF7EB"),pal("Cool Ivory","#F1F3F2","#263641","#38546A","#819FAD","#D7E4E7","#F8FCFD"),pal("Clay Ivory","#F8E9DF","#412D39","#664355","#B98486","#E7CDD0","#FFF4EE")]
  };
  families.marine = [pal("Midnight Cyan","#102744","#F0FBFF","#143552","#4CBDEB","#284C6A","#F7FDFF"),...families.dark.slice(1)];
  families.ridge = [pal("Mist & Teal","#FAF2E5","#283943","#315963","#86ADB0","#D0DFDA","#FFF8EB"),...families.ivory.slice(1)];
  // The keys preserve the individual treatments in each supplied sheet.
  const plates = [
    ["crimson-convocation","Crimson Convocation","Academic heritage","claret","heritage","tower"],
    ["gilt-sash","Gilt Sash","Cream and claret","claret","sash","arc"],
    ["genomic-horizon","Genomic Horizon","Clinical double helix","blue","diagonal","helix"],
    ["copper-constellation","Copper Constellation","Graphite and copper","dark","center","network"],
    ["azure-wavefront","Azure Wavefront","Clinical signal waves","blue","waves","dots"],
    ["copper-facet","Copper Facet","Obsidian and copper","dark","facet","plaque"],
    ["copper-dune","Copper Dune","Metallic particle ribbons","dark","offset","dune"],
    ["ice-prism","Ice Prism","Geometric clinical stationery","blue","prism","prism"],
    ["crimson-colonnade","Crimson Colonnade","Academic architecture","claret","colonnade","portico"],
    ["cobalt-hex","Cobalt Hex","Molecular stationery","blue","darkHex","hex"],
    ["civic-ivory","Civic Ivory","Civic skyline","ivory","civic","skyline"],
    ["emerald-contours","Emerald Contours","Botanical green and linework","green","contour","contour"],
    ["eventide-arc","Eventide Arc","Navy orbital gradient","marine","eclipse","eclipse"],
    ["alpine-blue","Alpine Blue","Cool mountain silhouettes","blue","ridge","hills"],
    ["porcelain-contours","Porcelain Contours","Ivory topographic lines","ivory","lightContour","contour"],
    ["night-bridge","Night Bridge","Monochrome suspension bridge","dark","bridge","bridge"],
    ["clinical-blue-ribbon","Clinical Blue Ribbon","Molecular ribbon study","blue","ribbon","wave"],
    ["carmine-canopy","Carmine Canopy","Burgundy over cream","claret","canopy","arc"],
    ["copper-molecular","Copper Molecular","Copper molecular network","dark","copperHex","hex"],
    ["civic-sketch","Civic Sketch","Fine civic line drawing","ivory","sketch","skyline"],
    ["cyan-particle","Cyan Particle","Cyan particle braid","marine","particle","dots"],
    ["mist-ridge","Mist Ridge","Soft teal ridgelines","ridge","mist","hills"]
  ];

  const frontArt = {
    heritage: () => full("accent")+border()+tower(220,33,.79)+divider(108,289,484),
    sash: () => sash()+arcs(-15,-15,1.08)+divider(251,240,198),
    diagonal: () => path("M-25 -25H156L-25 159ZM725 248V425H557Z","accent")+stroke("M155 -25L-25 154M725 237L546 425","accent-2",4)+hex(586,37,1.12)+fan(370,234,.95),
    center: () => stroke("M-25 165C78 48 116 10 266 -25M-25 102C92 49 154 12 332 -25M725 221C687 333 621 387 489 425M725 310C649 364 540 398 367 425","accent-2",1.2)+divider(155,247,390),
    waves: () => signalWaves()+divider(45,205,72),
    facet: () => facet()+divider(289,229,344),
    offset: () => fan(384,218,1.1)+dots(424,272,1.05),
    prism,
    colonnade: () => full("accent")+group(portico(0,0,1,"on-accent"),"translate(534 43) rotate(-12) scale(.93)",.53),
    darkHex: () => full("accent")+hex(593,54,1.12)+rect(32,91,3,156,"accent-2"),
    civic: () => skyline(389,258,.9)+rect(-25,383,750,42,"accent")+stroke("M32 78V208","accent-2",2),
    contour: () => contour(457,50,1.1)+divider(45,232,81),
    eclipse,
    ridge: () => hills(329,188,1.09)+rect(32,94,3,152,"accent-2"),
    lightContour: () => contour(456,106,1.1)+rect(32,92,3,137,"accent-2"),
    bridge: () => bridge(394,202,1.02)+divider(45,237,72),
    ribbon: () => hex(586,12,1.16)+wave(304,175,1.08)+divider(45,233,87),
    canopy: () => path("M-25 -25H725V218Q572 363 380 337T-25 379Z","accent")+arcs(545,-26,1.05)+arcs(555,358,.94),
    copperHex: () => hex(578,32,1.15)+network(511,131,.77)+fan(400,287,1.09),
    sketch: () => skyline(450,249,.79)+divider(45,260,89,"accent"),
    particle: () => full("accent")+dots(482,303,1.28,true)+rect(33,79,3,150,"accent-2"),
    mist: () => hills(327,185,1.08)+divider(45,253,96,"accent")
  };
  const backArt = {
    tower: () => portico(492,260,.84)+path("M-25 356Q159 400 435 425H-25Z","accent")+divider(44,150,369,"accent"),
    arc: () => arcs(-13,-15,1.16)+arcs(542,328,1)+divider(45,150,357),
    helix: () => helix(570,-31,1.06)+dots(373,332,.97)+divider(45,150,362),
    network: () => network(464,61,.9)+fan(453,293,.94)+divider(45,150,372),
    dots: () => dots(322,291,1.14)+divider(45,150,360),
    plaque: () => facet(true)+label(44,272,355,"accent")+divider(45,150,362),
    dune: () => dots(434,251,1.04)+fan(443,236,1.03)+divider(45,150,367),
    prism: () => prism()+divider(45,150,369),
    portico: () => portico(476,240,.86)+divider(45,150,363),
    hex: () => hex(580,48,1.08)+divider(45,150,360),
    skyline: () => skyline(469,250,.82)+divider(45,150,367),
    contour: () => contour(453,68,1.04)+divider(45,150,361),
    eclipse: () => eclipse()+divider(45,150,367),
    hills: () => hills(386,201,.92)+divider(45,150,360),
    bridge: () => bridge(455,199,.86)+divider(45,150,361),
    wave: () => wave(373,210,.93)+divider(45,150,365)
  };
  const formal = new Set(["heritage","sash","center","facet","colonnade","canopy"]);
  const darkFront = new Set(["heritage","colonnade","darkHex","canopy","particle"]);
  const darkBack = new Set(["sash","diagonal","waves","prism","ridge","ribbon","canopy","darkHex","particle","colonnade"]);
  const contactSample = {
    fullname:"Alexandria Montgomery, MD, PhD",title:"Internal Medicine Physician",
    affiliation:"Riverside Health Partners",header:"Riverside Health Partners",
    email:"a.montgomery@example.com",phone:"(202) 555-0142",website:"example.com/montgomery"
  };
  const svg = (body) => '<svg xmlns="http://www.w3.org/2000/svg" width="3.75in" height="2.25in" viewBox="-25 -25 750 450">'+ramp+body+'</svg>';
  const field = (key,x,y,width,size,anchor,font,weight,ink,lines=1,spacing=0) =>
    '<text data-field="'+key+'" data-max-width="'+width+'" data-min-size="'+(key==="fullname"?27:22)+'" data-lines="'+lines+
    '" x="'+x+'" y="'+y+'" text-anchor="'+anchor+'" font-family="'+font+'" font-weight="'+weight+'" font-size="'+size+
    '" letter-spacing="'+spacing+'" fill="var(--'+ink+')">'+contactSample[key]+'</text>';

  for(const [id,name,style,palette,frontKey,backKey] of plates){
    const serif=formal.has(frontKey), heading=serif?"Playfair Display":"Archivo",weight=serif?600:800;
    const centered=["heritage","sash","center"].includes(frontKey), inset=frontKey==="facet", stacked=frontKey==="center";
    const x=centered?350:inset?266:45, width=centered?616:inset?387:frontKey==="waves"?606:frontKey==="diagonal"?536:475;
    const y=frontKey==="heritage"?252:centered?190:frontKey==="waves"?173:183;
    const ty=frontKey==="heritage"?320:frontKey==="sash"?230:stacked?285:inset?277:frontKey==="waves"?241:253;
    const ay=ty+34;
    const ink=darkFront.has(frontKey)?"on-accent":"ink", anchor=centered?"middle":"start";
    const title=field("title",x,ty,width,24,anchor,"Inter",500,ink,inset?2:1,stacked?1.1:0);
    const front=svg(full("bg")+frontArt[frontKey]()+field("fullname",x,y,width,frontKey==="heritage"?51:47,anchor,heading,weight,ink,2,-.45)+title+
      field("affiliation",x,ay,width,22,anchor,"Inter",500,ink,1,stacked?.8:0));
    const invert=darkBack.has(frontKey), backInk=invert?"on-accent":"ink";
    const makeBack = (qr) => {
      const width=qr?347:frontKey==="facet"?352:430;
      const art=backArt[backKey]();
      // The QR face uses an opaque mount over the illustration and a clean text zone.
      const mount=qr?rect(422,80,243,243,invert?"bg":"soft")+frame(422,80,243,243)+
        '<rect data-slot="qr" x="438" y="96" width="211" height="211" fill="var(--on-accent)"/>':"";
      const positions=[198,244,297];
      return svg(full(invert?"accent":"bg")+art+mount+field("header",45,119,width,qr?32:36,"start",heading,weight,backInk,2,-.35)+
        ["email","phone","website"].map((key,i)=>field(key,45,positions[i],width,23,"start","Inter",500,
        frontKey==="facet"&&key==="website"&&!qr?"on-accent":backInk)).join(""));
    };
    window.CARD_TEMPLATES.push({id,name,style,description:"An editable adaptation from the professional card references.",
      suits:"Clinical practice, academic medicine, and professional networking",
      fonts:[[heading,weight,"normal"],["Inter",500,"normal"]],
      colourways:families[palette],moveWhenEmpty:{title:{affiliation:ty}},front,back:makeBack(false),backQr:makeBack(true)});
  }
})();
