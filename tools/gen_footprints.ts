/**
 * Build lib/cc1200_balloon.pretty: the footprints this design needs that the
 * stock KiCad libraries do not cover.
 *
 * Everything else uses a stock land pattern; see sheets/*.json for which.
 * Each generated footprint points at a 3D model in
 * lib/cc1200_balloon.3dshapes, built from models/*.scad by gen_3d.ts.
 */

const ROOT = `${import.meta.dir}/..`;
const OUT = `${ROOT}/lib/cc1200_balloon.pretty`;
const MODEL_DIR = "${KIPRJMOD}/lib/cc1200_balloon.3dshapes";

const FOREST_FP = "/home/tmpk/forest/Forest-Sensor-Platform/buck-forest.pretty/WIO-E5.kicad_mod";
const KICAD_FP = "/usr/share/kicad/footprints";

function uuid(seed: string): string {
  const h = new Bun.CryptoHasher("sha1").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const n = (v: number) => Number(v.toFixed(4)).toString();

interface PadSpec {
  number: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** SMD pads default to the front copper stack; through-hole needs a drill. */
  drill?: number;
  shape?: "rect" | "roundrect" | "oval" | "circle";
}

function smdPad(p: PadSpec, seed: string): string {
  const shape = p.shape ?? "roundrect";
  const extra = shape === "roundrect" ? "\n\t\t(roundrect_rratio 0.25)" : "";
  return `\t(pad "${p.number}" smd ${shape}
\t\t(at ${n(p.x)} ${n(p.y)})
\t\t(size ${n(p.w)} ${n(p.h)})
\t\t(layers "F.Cu" "F.Paste" "F.Mask")${extra}
\t\t(uuid "${uuid(seed + p.number)}")
\t)`;
}

function thtPad(p: PadSpec, seed: string): string {
  return `\t(pad "${p.number}" thru_hole ${p.shape ?? "circle"}
\t\t(at ${n(p.x)} ${n(p.y)})
\t\t(size ${n(p.w)} ${n(p.h)})
\t\t(drill ${n(p.drill!)})
\t\t(layers "*.Cu" "*.Mask")
\t\t(uuid "${uuid(seed + p.number)}")
\t)`;
}

function line(
  x1: number, y1: number, x2: number, y2: number,
  layer: string, width: number, seed: string,
): string {
  return `\t(fp_line
\t\t(start ${n(x1)} ${n(y1)})
\t\t(end ${n(x2)} ${n(y2)})
\t\t(stroke
\t\t\t(width ${width})
\t\t\t(type solid)
\t\t)
\t\t(layer "${layer}")
\t\t(uuid "${uuid(seed)}")
\t)`;
}

function box(
  x0: number, y0: number, x1: number, y1: number,
  layer: string, width: number, seed: string,
): string[] {
  return [
    line(x0, y0, x1, y0, layer, width, seed + "t"),
    line(x1, y0, x1, y1, layer, width, seed + "r"),
    line(x1, y1, x0, y1, layer, width, seed + "b"),
    line(x0, y1, x0, y0, layer, width, seed + "l"),
  ];
}

function text(kind: string, value: string, y: number, layer: string, seed: string): string {
  return `\t(property "${kind}" "${value}"
\t\t(at 0 ${n(y)} 0)
\t\t(unlocked yes)
\t\t(layer "${layer}")
\t\t(uuid "${uuid(seed + kind)}")
\t\t(effects
\t\t\t(font
\t\t\t\t(size 1 1)
\t\t\t\t(thickness 0.15)
\t\t\t)
\t\t)
\t)`;
}

function footprint(
  name: string, descr: string, tags: string, model: string, body: string[],
): string {
  const seed = `fp-${name}`;
  return [
    `(footprint "${name}"`,
    "\t(version 20240108)",
    '\t(generator "gen_footprints")',
    '\t(generator_version "1.0")',
    '\t(layer "F.Cu")',
    `\t(descr "${descr}")`,
    `\t(tags "${tags}")`,
    text("Reference", "REF**", -0.5, "F.SilkS", seed),
    text("Value", name, 1, "F.Fab", seed),
    "\t(attr smd)",
    ...body,
    // Bare solder pads have no body to model.
    ...(model
      ? [
          `\t(model "${MODEL_DIR}/${model}"`,
          "\t\t(offset (xyz 0 0 0))",
          "\t\t(scale (xyz 1 1 1))",
          "\t\t(rotate (xyz 0 0 0))",
          "\t)",
        ]
      : []),
    ")",
    "",
  ].join("\n");
}

// --- 1. Wio-E5 module ---------------------------------------------------
// Reused from the Forest sensor platform, which has the 28 castellated pads
// laid out already. Added here: a courtyard (the original has none) and the
// 3D model reference.
async function wioE5(): Promise<string> {
  let src = await Bun.file(FOREST_FP).text();
  const seed = "fp-WIO-E5";
  // Pads reach 6.5 / 7.15 mm out; 0.3 mm of courtyard beyond that.
  const crtyd = box(-6.8, -7.45, 6.8, 7.45, "F.CrtYd", 0.05, seed + "cy").join("\n");
  const model = `\t(model "${MODEL_DIR}/WIO-E5.wrl"
\t\t(offset (xyz 0 0 0))
\t\t(scale (xyz 1 1 1))
\t\t(rotate (xyz 0 0 0))
\t)`;
  src = src.replace(/\n\)\s*$/, `\n${crtyd}\n${model}\n)\n`);
  src = src.replace(
    /\t\(generator "pcbnew"\)/,
    '\t(generator "gen_footprints")\n\t(descr "Seeed Wio-E5 / LoRa-E5 module, 12x12x2.5mm, 28 castellated pads")\n\t(tags "LoRa STM32WLE5 module")',
  );
  return src;
}

// --- 2. BMV080 mating connector -----------------------------------------
// KYOCERA AVX 046844713002846+, series 6844: 0.3 mm pitch, 13 positions,
// right-angle bottom contact. Land pattern from the series drawing: the
// contacts alternate between two rows 0.6 mm apart within a row, with the
// odd contacts in the deeper (0.8 mm) row. Per-position dimensions come
// from the drawing's table, where A = (N-1) x 0.3 is the contact span and
// C = A + 1.39 is the hold-down pad centre spacing.
function fpc13(): string {
  const N = 13;
  const pitch = 0.3;
  const A = (N - 1) * pitch; // 3.6
  const C = A + 1.39; // 4.99
  const seed = "fp-fpc13";
  const yOdd = -1.135; // centre of the 0.8 mm deep row
  const yEven = 1.235; // centre of the 0.6 mm deep row
  const pads: string[] = [];
  for (let i = 1; i <= N; i++) {
    const x = (i - (N + 1) / 2) * pitch;
    const odd = i % 2 === 1;
    pads.push(smdPad({ number: String(i), x, y: odd ? yOdd : yEven, w: 0.3, h: odd ? 0.8 : 0.6 }, seed));
  }
  // Mechanical hold-downs; bottom edge flush with the odd row, 0.95 deep.
  for (const [j, sx] of [[1, -1], [2, 1]] as const) {
    pads.push(
      smdPad({ number: "MP" + j, x: (sx * C) / 2, y: -1.535 + 0.95 / 2, w: 0.5, h: 0.95 }, seed),
    );
  }
  const bodyW = A + 1.9; // 5.5, from the drawing's B column
  const body = [
    ...pads,
    // Package body, from the top of the even row to just past the odd row.
    ...box(-bodyW / 2, -2.0, bodyW / 2, 2.0, "F.Fab", 0.1, seed + "fab"),
    ...box(-bodyW / 2 - 0.25, -2.25, bodyW / 2 + 0.25, 2.25, "F.CrtYd", 0.05, seed + "cy"),
    // Pin 1 marker, outboard of contact 1.
    line(-A / 2 - 0.45, -2.15, -A / 2 - 0.15, -2.15, "F.SilkS", 0.12, seed + "p1"),
  ];
  return footprint(
    "Kyocera_046844713002846_FPC-13_P0.30mm",
    "KYOCERA AVX 6844 series FPC/ZIF connector, 13 pos, 0.30mm pitch, right angle bottom contact; mates the Bosch BMV080 flex",
    "FPC ZIF 0.3mm 13 BMV080",
    "Kyocera_6844_FPC-13.wrl",
    body,
  );
}

// --- 3. AT6558R QFN-40 --------------------------------------------------
// The stock QFN-40 5x5 P0.4 land patterns come with a 3.6 or 3.8 mm thermal
// land; the AT6558 data sheet gives D1/E1 = 3.30..3.50 mm, so the pad is
// resized to the 3.4 mm nominal rather than overhanging the die pad.
async function at6558(): Promise<string> {
  const stock = `${KICAD_FP}/Package_DFN_QFN.pretty/QFN-40-1EP_5x5mm_P0.4mm_EP3.6x3.6mm.kicad_mod`;
  let src = await Bun.file(stock).text();
  const name = "AT6558R_QFN-40-1EP_5x5mm_P0.4mm_EP3.4x3.4mm";
  src = src.replace(
    /^\(footprint "[^"]*"/,
    `(footprint "${name}"`,
  );
  src = src.replace(/\(generator "[^"]*"\)/, '(generator "gen_footprints")');
  src = src.replace(
    /\(descr "[^"]*"\)/,
    '(descr "QFN, 40 pin, 5x5mm body, 0.4mm pitch, 3.4x3.4mm thermal pad (ZHONGKEWEI AT6558R data sheet section 8.2)")',
  );
  // Thermal land: pad 41 is the only 3.6 x 3.6 pad in the file.
  const before = src;
  src = src.replace(/\(size 3\.6 3\.6\)/, "(size 3.4 3.4)");
  if (src === before) throw new Error("AT6558R: thermal pad 3.6x3.6 not found");
  src = src.replace(/\(property "Value" "[^"]*"/, `(property "Value" "${name}"`);
  src = src.replace(
    /\(model "[^"]*"/,
    `(model "${MODEL_DIR}/AT6558R_QFN-40_5x5mm.wrl"`,
  );
  return src;
}

// --- 4. AS3935 antenna coil ---------------------------------------------
// Bourns 78F101J-RC, 100 uH axial drum-core choke standing in for the
// Coilcraft MA5532-AE the AS3935 application note names. Body 2.79 mm dia
// x 7.11 mm long, 0.5 mm leads, mounted lying down on a 10.16 mm pitch.
function antennaCoil(): string {
  const seed = "fp-coil";
  const P = 10.16;
  const body = [
    thtPad({ number: "1", x: -P / 2, y: 0, w: 1.6, h: 1.6, drill: 0.8, shape: "circle" }, seed),
    thtPad({ number: "2", x: P / 2, y: 0, w: 1.6, h: 1.6, drill: 0.8, shape: "circle" }, seed),
    ...box(-3.6, -1.4, 3.6, 1.4, "F.Fab", 0.1, seed + "fab"),
    ...box(-3.7, -1.5, 3.7, 1.5, "F.SilkS", 0.12, seed + "silk"),
    line(-P / 2 + 0.9, 0, -3.7, 0, "F.SilkS", 0.12, seed + "lw"),
    line(P / 2 - 0.9, 0, 3.7, 0, "F.SilkS", 0.12, seed + "le"),
    ...box(-P / 2 - 1.05, -1.75, P / 2 + 1.05, 1.75, "F.CrtYd", 0.05, seed + "cy"),
  ];
  const fp = footprint(
    "L_Axial_D2.8mm_L7.2mm_P10.16mm_Horizontal",
    "Axial drum-core inductor, 2.8mm diameter x 7.2mm body, 10.16mm lead pitch, horizontal (Bourns 78F series)",
    "inductor axial THT 78F AS3935 antenna",
    "L_Axial_D2.8mm_L7.2mm.wrl",
    body,
  );
  return fp.replace('\t(attr smd)\n', "\t(attr through_hole)\n");
}

// --- 5. Solder pads in place of connectors ------------------------------
// The payload is mass-limited, so nothing mates: wires and coax pigtails
// solder straight to the board. Two SMA edge launches, a JST-PH header, a
// 1x06 pin header and a u.FL receptacle came to roughly 5 g between them.

/** Two pads for the battery leads. */
function batteryPads(): string {
  const seed = "fp-battpad";
  const pitch = 3.0;
  const body = [
    smdPad({ number: "1", x: -pitch / 2, y: 0, w: 1.6, h: 2.6 }, seed),
    smdPad({ number: "2", x: pitch / 2, y: 0, w: 1.6, h: 2.6 }, seed),
    ...box(-2.7, -1.7, 2.7, 1.7, "F.Fab", 0.1, seed + "fab"),
    ...box(-2.95, -1.95, 2.95, 1.95, "F.CrtYd", 0.05, seed + "cy"),
    // "+" over pad 1, "-" over pad 2
    line(-2.0, -2.3, -1.0, -2.3, "F.SilkS", 0.15, seed + "ph"),
    line(-1.5, -2.8, -1.5, -1.8, "F.SilkS", 0.15, seed + "pv"),
    line(1.0, -2.3, 2.0, -2.3, "F.SilkS", 0.15, seed + "m"),
  ];
  return footprint(
    "SolderPad_Wire_1x02_P3.0mm",
    "Two solder pads for battery leads, 3.0mm pitch, no connector",
    "solder pad wire battery",
    "",
    body,
  );
}

/**
 * Coax pigtail landing: centre conductor forward, braid on the rear pad,
 * ground either side. The side grounds sit 0.2 mm off the signal pad, close
 * enough to keep the transition coplanar at 1.6 GHz.
 */
function coaxPads(): string {
  const seed = "fp-coaxpad";
  const body = [
    smdPad({ number: "1", x: 0, y: 0, w: 1.2, h: 1.6 }, seed),
    smdPad({ number: "2", x: -1.6, y: 0, w: 1.6, h: 1.6 }, seed + "gl"),
    smdPad({ number: "2", x: 1.6, y: 0, w: 1.6, h: 1.6 }, seed + "gr"),
    smdPad({ number: "2", x: 0, y: 2.6, w: 3.6, h: 1.6 }, seed + "braid"),
    ...box(-2.4, -0.8, 2.4, 3.4, "F.Fab", 0.1, seed + "fab"),
    ...box(-2.65, -1.05, 2.65, 3.65, "F.CrtYd", 0.05, seed + "cy"),
  ];
  return footprint(
    "SolderPad_Coax_Pigtail",
    "Coax pigtail solder pads: centre conductor, coplanar grounds and a braid pad; replaces an SMA or u.FL connector",
    "solder pad coax pigtail RF antenna",
    "",
    body,
  );
}

/** Programming and console pads, probed or wire-soldered. */
function debugPads(): string {
  const seed = "fp-dbgpad";
  const pitch = 1.27;
  const n = 6;
  const body: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * pitch;
    body.push(smdPad({ number: String(i + 1), x, y: 0, w: 0.9, h: 1.8 }, seed));
  }
  const half = ((n - 1) / 2) * pitch + 0.7;
  body.push(
    ...box(-half, -1.1, half, 1.1, "F.Fab", 0.1, seed + "fab"),
    ...box(-half - 0.25, -1.35, half + 0.25, 1.35, "F.CrtYd", 0.05, seed + "cy"),
    // pin 1 marker
    line(-half, -1.4, -half + 0.6, -1.4, "F.SilkS", 0.15, seed + "p1"),
  );
  return footprint(
    "SolderPad_1x06_P1.27mm",
    "Row of six solder pads, 1.27mm pitch, for SWD and console; replaces a pin header",
    "solder pad SWD debug programming",
    "",
    body,
  );
}

/**
 * KEMET FC/FCS series supercapacitor, 10.7 mm can. Land pattern from the
 * series data sheet (S6011_FC): two 4.9 x 2.5 mm lands with 5.0 mm between
 * their inner edges.
 */
function superCap(): string {
  const seed = "fp-supercap";
  const gap = 5.0;
  const landW = 4.9;
  const centre = gap / 2 + landW / 2;
  const body = [
    smdPad({ number: "1", x: -centre, y: 0, w: landW, h: 2.5, shape: "rect" }, seed),
    smdPad({ number: "2", x: centre, y: 0, w: landW, h: 2.5, shape: "rect" }, seed),
    // can outline, 10.7 mm diameter
    `\t(fp_circle
\t\t(center 0 0)
\t\t(end 5.35 0)
\t\t(stroke
\t\t\t(width 0.1)
\t\t\t(type solid)
\t\t)
\t\t(fill no)
\t\t(layer "F.Fab")
\t\t(uuid "${uuid(seed + "can")}")
\t)`,
    ...box(-7.65, -5.6, 7.65, 5.6, "F.CrtYd", 0.05, seed + "cy"),
    line(-7.4, -3.0, -7.4, 3.0, "F.SilkS", 0.15, seed + "plus"),
    line(-8.0, 0, -6.8, 0, "F.SilkS", 0.15, seed + "plus2"),
  ];
  return footprint(
    "SuperCap_KEMET_FCS_D10.7mm",
    "KEMET FC/FCS series supercapacitor, 10.7mm diameter SMD can, 5.5mm high; pad 1 is positive",
    "supercapacitor EDLC backup KEMET",
    "SuperCap_KEMET_FCS_D10.7mm.wrl",
    body,
  );
}

// --- write --------------------------------------------------------------
const files: [string, string][] = [
  ["WIO-E5.kicad_mod", await wioE5()],
  ["Kyocera_046844713002846_FPC-13_P0.30mm.kicad_mod", fpc13()],
  ["AT6558R_QFN-40-1EP_5x5mm_P0.4mm_EP3.4x3.4mm.kicad_mod", await at6558()],
  ["L_Axial_D2.8mm_L7.2mm_P10.16mm_Horizontal.kicad_mod", antennaCoil()],
  ["SolderPad_Wire_1x02_P3.0mm.kicad_mod", batteryPads()],
  ["SolderPad_Coax_Pigtail.kicad_mod", coaxPads()],
  ["SolderPad_1x06_P1.27mm.kicad_mod", debugPads()],
  ["SuperCap_KEMET_FCS_D10.7mm.kicad_mod", superCap()],
];
for (const [name, src] of files) await Bun.write(`${OUT}/${name}`, src);
console.log(`  lib/cc1200_balloon.pretty: ${files.length} footprints`);
